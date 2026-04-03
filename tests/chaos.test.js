'use strict';

/**
 * Tests for HRBP Chaos Testing Framework
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { ChaosProxy, createFaultInjector, corruptBuffer } = require('../src/chaos');
const { HRBPServer } = require('../src/tcp/server');
const { HRBPClient } = require('../src/tcp/client');
const { HRBPRpcServer } = require('../src/rpc/server');
const { HRBPRpcClient } = require('../src/rpc/client');

// ---------------------------------------------------------------------------
// corruptBuffer
// ---------------------------------------------------------------------------

describe('corruptBuffer', () => {
  it('returns a buffer of the same length', () => {
    const buf = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    const corrupted = corruptBuffer(buf);
    assert.equal(corrupted.length, buf.length);
  });

  it('does not mutate the original buffer', () => {
    const buf = Buffer.from([0xAA, 0xBB, 0xCC]);
    const orig = Buffer.from(buf);
    corruptBuffer(buf);
    assert.deepEqual(buf, orig);
  });

  it('flips at least one bit', () => {
    // Run multiple times to be sure (probabilistic)
    let sawDifference = false;
    for (let i = 0; i < 20; i++) {
      const buf = Buffer.from([0xFF, 0xFF, 0xFF, 0xFF]);
      const corrupted = corruptBuffer(buf);
      if (!corrupted.equals(buf)) {
        sawDifference = true;
        break;
      }
    }
    assert.ok(sawDifference, 'corruptBuffer should flip at least one bit');
  });
});

// ---------------------------------------------------------------------------
// createFaultInjector
// ---------------------------------------------------------------------------

describe('createFaultInjector', () => {
  it('passes envelope through with no faults', async () => {
    const mw = createFaultInjector({});
    const env = { type: 'call', id: 1, method: 'x', params: {} };
    const result = await mw(env);
    assert.deepEqual(result, env);
  });

  it('returns null when timeout triggers', async () => {
    const mw = createFaultInjector({ timeoutRate: 1.0 });
    const result = await mw({ type: 'call', id: 1, method: 'x', params: {} });
    assert.equal(result, null);
  });

  it('throws when errorRate triggers', async () => {
    const mw = createFaultInjector({ errorRate: 1.0 });
    await assert.rejects(
      () => mw({ type: 'call', id: 1, method: 'x', params: {} }),
      /Injected fault/
    );
  });

  it('adds latency when configured', async () => {
    const mw = createFaultInjector({ latencyMs: 50 });
    const start = Date.now();
    await mw({ type: 'call', id: 1, method: 'x', params: {} });
    assert.ok(Date.now() - start >= 40, 'should add at least 40ms latency');
  });
});

// ---------------------------------------------------------------------------
// ChaosProxy — integration test
// ---------------------------------------------------------------------------

describe('ChaosProxy', () => {
  let echoServer;
  let echoPort;

  before(() => new Promise((resolve, reject) => {
    echoServer = new HRBPServer();
    echoServer.on('error', reject);
    echoServer.on('connection', (conn) => {
      conn.on('message', (v) => conn.send({ echo: v }));
    });
    echoServer.listen(0, '127.0.0.1', () => {
      echoPort = echoServer.address.port;
      resolve();
    });
  }));

  after(() => new Promise((r) => echoServer.close(r)));

  it('forwards traffic transparently (no faults)', async () => {
    const proxy = new ChaosProxy({
      target: { host: '127.0.0.1', port: echoPort },
    });
    await proxy.listen(0);
    const proxyPort = proxy.address.port;

    const result = await new Promise((resolve, reject) => {
      const client = new HRBPClient();
      client.on('error', reject);
      client.connect(proxyPort, '127.0.0.1', () => {
        client.on('message', (v) => {
          client.close();
          resolve(v);
        });
        client.send({ hello: 'world' });
      });
    });

    assert.deepEqual(result, { echo: { hello: 'world' } });
    await proxy.close();
  });

  it('tracks statistics', async () => {
    const proxy = new ChaosProxy({
      target: { host: '127.0.0.1', port: echoPort },
    });
    await proxy.listen(0);
    const proxyPort = proxy.address.port;

    await new Promise((resolve, reject) => {
      const client = new HRBPClient();
      client.on('error', reject);
      client.connect(proxyPort, '127.0.0.1', () => {
        client.on('message', () => {
          client.close();
          resolve();
        });
        client.send(42);
      });
    });

    const stats = proxy.stats;
    assert.ok(stats.forwarded >= 1 || stats.delayed >= 1);
    proxy.resetStats();
    assert.equal(proxy.stats.forwarded, 0);
    await proxy.close();
  });

  it('adds latency when configured', async () => {
    const proxy = new ChaosProxy({
      target: { host: '127.0.0.1', port: echoPort },
      latency: { min: 50, max: 100 },
    });
    await proxy.listen(0);
    const proxyPort = proxy.address.port;

    const start = Date.now();
    await new Promise((resolve, reject) => {
      const client = new HRBPClient();
      client.on('error', reject);
      client.connect(proxyPort, '127.0.0.1', () => {
        client.on('message', () => {
          client.close();
          resolve();
        });
        client.send('ping');
      });
    });
    const elapsed = Date.now() - start;

    // Should be at least 50ms (min latency, applied twice: c→s and s→c)
    assert.ok(elapsed >= 40, `Expected >=40ms, got ${elapsed}ms`);
    await proxy.close();
  });
});

// ---------------------------------------------------------------------------
// Fault injector middleware integration
// ---------------------------------------------------------------------------

describe('FaultInjector RPC integration', () => {
  let server, client, port;

  before(() => new Promise((resolve) => {
    server = new HRBPRpcServer();
    // Inject 100% error rate
    server.use(createFaultInjector({ errorRate: 1.0 }));
    server.handle('add', async ({ a, b }) => a + b);
    server.listen(0, '127.0.0.1', () => {
      port = server.address.port;
      client = new HRBPRpcClient();
      client.connect(port, '127.0.0.1', resolve);
    });
  }));

  after(() => new Promise((r) => {
    client.close();
    server.close(r);
  }));

  it('injected errors propagate to RPC client', async () => {
    await assert.rejects(
      () => client.call('add', { a: 1, b: 2 }),
      /Injected fault|rejected by middleware/
    );
  });
});
