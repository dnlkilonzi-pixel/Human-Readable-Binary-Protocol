'use strict';

/**
 * Tests for the HRBP RPC layer (HRBPRpcServer + HRBPRpcClient).
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { HRBPRpcServer } = require('../src/rpc/server');
const { HRBPRpcClient } = require('../src/rpc/client');
const { makeCall, makeReply, makeError, encodeEnvelope, decodeEnvelope } = require('../src/rpc/protocol');
const { encode, decode } = require('../src/index');

// ---------------------------------------------------------------------------
// Protocol helper unit tests
// ---------------------------------------------------------------------------

describe('RPC protocol helpers', () => {
  it('makeCall produces the correct envelope shape', () => {
    const env = makeCall(1, 'getUser', { id: 42 });
    assert.deepEqual(env, { type: 'call', id: 1, method: 'getUser', params: { id: 42 } });
  });

  it('makeReply produces the correct envelope shape', () => {
    const env = makeReply(1, { name: 'Alice' });
    assert.deepEqual(env, { type: 'reply', id: 1, result: { name: 'Alice' } });
  });

  it('makeError produces the correct envelope shape', () => {
    const env = makeError(1, 'Not found');
    assert.deepEqual(env, { type: 'error', id: 1, message: 'Not found' });
  });

  it('encodeEnvelope / decodeEnvelope round-trips a call', () => {
    const call = makeCall(7, 'add', { a: 2, b: 3 });
    const buf = encodeEnvelope(call);
    assert.ok(Buffer.isBuffer(buf));
    const decoded = decodeEnvelope(buf);
    assert.deepEqual(decoded, call);
  });

  it('encodeEnvelope / decodeEnvelope round-trips a reply', () => {
    const reply = makeReply(7, 5);
    const buf = encodeEnvelope(reply);
    const decoded = decodeEnvelope(buf);
    assert.deepEqual(decoded, reply);
  });
});

// ---------------------------------------------------------------------------
// HRBPRpcServer + HRBPRpcClient integration tests
// ---------------------------------------------------------------------------

describe('HRBPRpcServer + HRBPRpcClient', () => {
  /** @type {HRBPRpcServer} */
  let server;
  /** @type {HRBPRpcClient} */
  let client;
  let port;

  before(() => new Promise((resolve, reject) => {
    server = new HRBPRpcServer();

    server.handle('add', async ({ a, b }) => a + b);
    server.handle('echo', async (params) => params);
    server.handle('getUser', async ({ id }) => ({ id, name: 'Alice' }));
    server.handle('throws', async () => { throw new Error('handler failed'); });

    server.listen(0, '127.0.0.1', () => {
      port = server.address.port;

      client = new HRBPRpcClient();
      client.connect(port, '127.0.0.1', resolve);
    });
  }));

  after(() => new Promise((resolve) => {
    client.close();
    server.close(resolve);
  }));

  it('call() resolves with the handler result', async () => {
    const result = await client.call('add', { a: 3, b: 4 });
    assert.equal(result, 7);
  });

  it('call() with string params', async () => {
    const result = await client.call('echo', 'hello');
    assert.equal(result, 'hello');
  });

  it('call() round-trips a nested object', async () => {
    const user = await client.call('getUser', { id: 1 });
    assert.deepEqual(user, { id: 1, name: 'Alice' });
  });

  it('call() rejects when the handler throws', async () => {
    await assert.rejects(
      () => client.call('throws', null),
      (e) => {
        assert.ok(e instanceof Error);
        assert.match(e.message, /handler failed/);
        return true;
      }
    );
  });

  it('call() rejects for an unknown method', async () => {
    await assert.rejects(
      () => client.call('doesNotExist', null),
      (e) => {
        assert.ok(e instanceof Error);
        assert.match(e.message, /Unknown method/);
        return true;
      }
    );
  });

  it('multiple concurrent calls resolve independently', async () => {
    const [a, b, c] = await Promise.all([
      client.call('add', { a: 1, b: 1 }),
      client.call('add', { a: 10, b: 20 }),
      client.call('echo', [1, 2, 3]),
    ]);
    assert.equal(a, 2);
    assert.equal(b, 30);
    assert.deepEqual(c, [1, 2, 3]);
  });
});
