'use strict';

/**
 * Tests for HRBP TCP framing, server, and client.
 *
 * Uses only Node built-ins (net module) — no external test helpers.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { frameEncode, FrameDecoder } = require('../src/framing');
const { HRBPServer } = require('../src/tcp/server');
const { HRBPClient } = require('../src/tcp/client');
const { encode } = require('../src/encoder');

// ---------------------------------------------------------------------------
// FrameDecoder unit tests
// ---------------------------------------------------------------------------

describe('frameEncode / FrameDecoder', () => {
  it('frameEncode prepends a 4-byte big-endian length', () => {
    const payload = Buffer.from([0x01, 0x02, 0x03]);
    const frame = frameEncode(payload);
    assert.equal(frame.length, 7);
    assert.equal(frame.readUInt32BE(0), 3);
    assert.deepEqual(frame.slice(4), payload);
  });

  it('FrameDecoder extracts a complete frame in one push', () => {
    const payload = encode({ hello: 'world' });
    const frame = frameEncode(payload);
    const fd = new FrameDecoder();
    const frames = fd.push(frame);
    assert.equal(frames.length, 1);
    assert.deepEqual(frames[0], payload);
  });

  it('FrameDecoder buffers a partial frame and completes on second push', () => {
    const payload = encode(42);
    const frame = frameEncode(payload);
    const fd = new FrameDecoder();

    const half = Math.floor(frame.length / 2);
    const part1 = fd.push(frame.slice(0, half));
    assert.equal(part1.length, 0); // incomplete

    const part2 = fd.push(frame.slice(half));
    assert.equal(part2.length, 1);
    assert.deepEqual(part2[0], payload);
  });

  it('FrameDecoder handles multiple frames in one push', () => {
    const p1 = encode(1);
    const p2 = encode('two');
    const combined = Buffer.concat([frameEncode(p1), frameEncode(p2)]);
    const fd = new FrameDecoder();
    const frames = fd.push(combined);
    assert.equal(frames.length, 2);
    assert.deepEqual(frames[0], p1);
    assert.deepEqual(frames[1], p2);
  });

  it('FrameDecoder handles byte-by-byte delivery', () => {
    const payload = encode({ x: 99 });
    const frame = frameEncode(payload);
    const fd = new FrameDecoder();
    let frames = [];
    for (const byte of frame) {
      frames = frames.concat(fd.push(Buffer.from([byte])));
    }
    assert.equal(frames.length, 1);
    assert.deepEqual(frames[0], payload);
  });

  it('FrameDecoder reset() clears internal buffer', () => {
    const payload = encode('hi');
    const frame = frameEncode(payload);
    const fd = new FrameDecoder();
    fd.push(frame.slice(0, 2)); // partial
    fd.reset();
    // After reset, the partial data should be gone.
    const frames = fd.push(frameEncode(encode('clean')));
    assert.equal(frames.length, 1);
  });
});

// ---------------------------------------------------------------------------
// HRBPServer + HRBPClient integration tests
// ---------------------------------------------------------------------------

describe('HRBPServer + HRBPClient', () => {
  /** @type {HRBPServer} */
  let server;
  let port;

  before(() => new Promise((resolve, reject) => {
    server = new HRBPServer();
    server.on('error', reject);

    // Simple echo server
    server.on('connection', (conn) => {
      conn.on('message', (value) => conn.send({ echo: value }));
    });

    server.listen(0, '127.0.0.1', () => {
      port = server.address.port;
      resolve();
    });
  }));

  after(() => new Promise((resolve) => server.close(resolve)));

  it('client can connect and send/receive a message', () => new Promise((resolve, reject) => {
    const client = new HRBPClient();
    client.on('error', reject);
    client.connect(port, '127.0.0.1', () => {
      client.on('message', (value) => {
        try {
          assert.deepEqual(value, { echo: { hello: 'world' } });
          client.close();
          resolve();
        } catch (e) {
          reject(e);
        }
      });
      client.send({ hello: 'world' });
    });
  }));

  it('can exchange multiple messages over one connection', () => new Promise((resolve, reject) => {
    const client = new HRBPClient();
    client.on('error', reject);
    const received = [];

    client.connect(port, '127.0.0.1', () => {
      client.on('message', (value) => {
        received.push(value.echo);
        if (received.length === 3) {
          try {
            assert.deepEqual(received, [1, 'two', true]);
            client.close();
            resolve();
          } catch (e) {
            reject(e);
          }
        }
      });
      client.send(1);
      client.send('two');
      client.send(true);
    });
  }));

  it('round-trips a nested object', () => new Promise((resolve, reject) => {
    const obj = { user: { id: 42, name: 'Alice', scores: [10, 20, 30] } };
    const client = new HRBPClient();
    client.on('error', reject);
    client.connect(port, '127.0.0.1', () => {
      client.on('message', (value) => {
        try {
          assert.deepEqual(value, { echo: obj });
          client.close();
          resolve();
        } catch (e) {
          reject(e);
        }
      });
      client.send(obj);
    });
  }));

  it('handles a large message without fragmentation issues', () => new Promise((resolve, reject) => {
    const bigArray = Array.from({ length: 500 }, (_, i) => i);
    const client = new HRBPClient();
    client.on('error', reject);
    client.connect(port, '127.0.0.1', () => {
      client.on('message', (value) => {
        try {
          assert.deepEqual(value, { echo: bigArray });
          client.close();
          resolve();
        } catch (e) {
          reject(e);
        }
      });
      client.send(bigArray);
    });
  }));
});
