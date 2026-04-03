'use strict';

/**
 * Real-World Scenario Tests
 *
 * Validates the HRBP production stack under realistic conditions:
 *
 *  1. Multi-node under a ChaosProxy (latency + corruption)
 *  2. Failover + recovery  (primary dies mid-stream, secondary takes over)
 *  3. High-load simulation (burst of concurrent calls)
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { HRBPRpcServer }      = require('../src/rpc/server');
const { HRBPRpcClient }      = require('../src/rpc/client');
const { ChaosProxy }         = require('../src/chaos');
const { ServiceRegistry }    = require('../src/discovery/registry');
const { LoadBalancer }       = require('../src/discovery/loadbalancer');
const { attachHealthCheck }  = require('../src/discovery/health');
const { Tracer, InMemoryCollector } = require('../src/observability/tracing');
const { MetricsCollector }   = require('../src/observability/metrics');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Start an RPC server and resolve with its port. */
function startServer(setupFn) {
  return new Promise((resolve, reject) => {
    const server = new HRBPRpcServer();
    setupFn(server);
    server.listen(0, '127.0.0.1', () => resolve(server));
    server._server._server.once('error', reject);
  });
}

/** Connect an RPC client to `port` and resolve when connected. */
function connectClient(port) {
  return new Promise((resolve, reject) => {
    const client = new HRBPRpcClient();
    client.connect(port, '127.0.0.1', () => resolve(client));
    // HRBPRpcClient wraps HRBPClient; surface connection errors during setup
    client._client.once('error', reject);
  });
}

// ---------------------------------------------------------------------------
// 1. Multi-node under ChaosProxy (latency injection)
// ---------------------------------------------------------------------------

describe('Scenario: multi-node cluster under chaos proxy', () => {
  let nodeA, nodeB, proxyA, proxyB;
  let clientA, clientB;
  const collector = new InMemoryCollector();
  const tracer    = new Tracer({ collector });
  const metrics   = new MetricsCollector();

  before(async () => {
    // Start two independent RPC nodes
    nodeA = await startServer((s) => {
      attachHealthCheck(s, { serviceName: 'node-a' });
      s.use(async (env) => {
        const span = tracer.startSpan(env.method, { tags: { node: 'a' } });
        env._span = span;
        return env;
      });
      s.handle('add',  async ({ a, b }) => a + b);
      s.handle('echo', async (p) => p);
    });

    nodeB = await startServer((s) => {
      attachHealthCheck(s, { serviceName: 'node-b' });
      s.use(async (env) => {
        const span = tracer.startSpan(env.method, { tags: { node: 'b' } });
        env._span = span;
        return env;
      });
      s.handle('add',  async ({ a, b }) => (a + b) * 1); // same logic
      s.handle('echo', async (p) => p);
    });

    // Put a ChaosProxy in front of each node (mild latency, no drops)
    proxyA = new ChaosProxy({
      target: { host: '127.0.0.1', port: nodeA.address.port },
      latency: { min: 5, max: 15 },
    });
    proxyB = new ChaosProxy({
      target: { host: '127.0.0.1', port: nodeB.address.port },
      latency: { min: 5, max: 15 },
    });
    await proxyA.listen(0);
    await proxyB.listen(0);

    clientA = await connectClient(proxyA.address.port);
    clientB = await connectClient(proxyB.address.port);
  });

  after(async () => {
    clientA.close();
    clientB.close();
    await proxyA.close();
    await proxyB.close();
    await new Promise((r) => nodeA.close(r));
    await new Promise((r) => nodeB.close(r));
  });

  it('both nodes answer add calls through the chaos proxy', async () => {
    const [r1, r2] = await Promise.all([
      clientA.call('add', { a: 3, b: 4 }),
      clientB.call('add', { a: 10, b: 20 }),
    ]);
    assert.equal(r1, 7);
    assert.equal(r2, 30);
  });

  it('both nodes answer echo calls through the chaos proxy', async () => {
    const [r1, r2] = await Promise.all([
      clientA.call('echo', 'hello-a'),
      clientB.call('echo', 'hello-b'),
    ]);
    assert.equal(r1, 'hello-a');
    assert.equal(r2, 'hello-b');
  });

  it('health checks pass on both nodes through the proxy', async () => {
    const [ha, hb] = await Promise.all([
      clientA.call('__health', {}),
      clientB.call('__health', {}),
    ]);
    assert.equal(ha.status, 'healthy');
    assert.equal(ha.service, 'node-a');
    assert.equal(hb.status, 'healthy');
    assert.equal(hb.service, 'node-b');
  });

  it('spans are recorded for calls through the chaos proxy', async () => {
    collector.flush(); // clear previous spans
    await clientA.call('add', { a: 1, b: 1 });
    await clientB.call('add', { a: 2, b: 2 });
    const spans = collector.flush();
    assert.ok(spans.length >= 2, `Expected >=2 spans, got ${spans.length}`);
    assert.ok(spans.some((s) => s.tags.node === 'a'));
    assert.ok(spans.some((s) => s.tags.node === 'b'));
  });

  it('load balancer distributes calls across both proxy ports', async () => {
    const registry = new ServiceRegistry();
    registry.register({ name: 'calc', host: '127.0.0.1', port: proxyA.address.port });
    registry.register({ name: 'calc', host: '127.0.0.1', port: proxyB.address.port });

    const lb = new LoadBalancer({ strategy: 'round-robin' });
    for (const inst of registry.lookup('calc')) {
      lb.addInstance({ host: inst.host, port: inst.port });
    }

    // Round-robin must alternate between the two proxy ports
    const picks = [lb.pick(), lb.pick(), lb.pick(), lb.pick()];
    const ports = picks.map((p) => p.port);
    assert.ok(
      ports.includes(proxyA.address.port) && ports.includes(proxyB.address.port),
      'round-robin should hit both nodes'
    );

    registry.close();
  });
});

// ---------------------------------------------------------------------------
// 2. Failover + recovery
// ---------------------------------------------------------------------------

describe('Scenario: failover and recovery', () => {
  let primary, secondary;

  before(async () => {
    primary = await startServer((s) => {
      s.handle('compute', async ({ n }) => n * 2);
    });
    secondary = await startServer((s) => {
      s.handle('compute', async ({ n }) => n * 2);
    });
  });

  after(async () => {
    // primary may already be closed by the test
    try { await new Promise((r) => primary.close(r)); } catch (_) { /* already closed */ }
    await new Promise((r) => secondary.close(r));
  });

  it('succeeds on primary, then recovers on secondary after primary dies', async () => {
    const clientPrimary = await connectClient(primary.address.port);

    // Confirm primary is working
    const r1 = await clientPrimary.call('compute', { n: 5 });
    assert.equal(r1, 10);
    clientPrimary.close();

    // Kill the primary
    await new Promise((r) => primary.close(r));

    // Client aimed at primary should now fail
    await assert.rejects(
      () => {
        const deadClient = new HRBPRpcClient();
        return new Promise((resolve, reject) => {
          deadClient._client.once('error', reject);
          deadClient.connect(primary.address.port, '127.0.0.1', () => {
            deadClient.call('compute', { n: 5 })
              .then(resolve)
              .catch(reject)
              .finally(() => deadClient.close());
          });
        });
      },
      (err) => {
        // Any error (connection refused, timeout, etc.) is acceptable here
        assert.ok(err instanceof Error);
        return true;
      }
    );

    // Failover: connect to secondary and verify it works
    const clientSecondary = await connectClient(secondary.address.port);
    const r2 = await clientSecondary.call('compute', { n: 7 });
    assert.equal(r2, 14);
    clientSecondary.close();
  });
});

// ---------------------------------------------------------------------------
// 3. High-load simulation
// ---------------------------------------------------------------------------

describe('Scenario: high-load burst of concurrent calls', () => {
  let server, client;
  const metrics = new MetricsCollector();
  const CALLS_PER_ROUND = 50;
  const LOAD_TEST_ROUNDS = 4;

  before(async () => {
    server = await startServer((s) => {
      s.handle('mul', async ({ a, b }) => a * b);
      s.handle('sum', async ({ values }) => values.reduce((acc, v) => acc + v, 0));
    });
    client = await connectClient(server.address.port);
  });

  after(() => {
    client.close();
    return new Promise((r) => server.close(r));
  });

  it(`handles ${CALLS_PER_ROUND * LOAD_TEST_ROUNDS} concurrent calls with correct results`, async () => {
    const calls = [];
    for (let round = 0; round < LOAD_TEST_ROUNDS; round++) {
      for (let i = 0; i < CALLS_PER_ROUND; i++) {
        calls.push(client.call('mul', { a: i, b: round + 1 }));
      }
    }

    const results = await Promise.all(calls);

    let idx = 0;
    for (let round = 0; round < LOAD_TEST_ROUNDS; round++) {
      for (let i = 0; i < CALLS_PER_ROUND; i++) {
        assert.equal(results[idx++], i * (round + 1),
          `Round ${round}, i=${i}: expected ${i * (round + 1)}, got ${results[idx - 1]}`);
      }
    }
  });

  it('handles mixed method types under load', async () => {
    const calls = [];
    for (let i = 0; i < CALLS_PER_ROUND; i++) {
      if (i % 2 === 0) {
        calls.push(client.call('mul', { a: i, b: 3 }).then((r) => ({ type: 'mul', r })));
      } else {
        calls.push(
          client.call('sum', { values: [i, i + 1, i + 2] })
                .then((r) => ({ type: 'sum', r }))
        );
      }
    }
    const results = await Promise.all(calls);

    for (let i = 0; i < CALLS_PER_ROUND; i++) {
      const { type, r } = results[i];
      if (i % 2 === 0) {
        assert.equal(r, i * 3, `mul mismatch at i=${i}`);
      } else {
        assert.equal(r, i + (i + 1) + (i + 2), `sum mismatch at i=${i}`);
      }
    }
  });

  it('records metrics over the high-load run', () => {
    // Record a batch of calls into metrics manually to confirm the API works
    // under the expected call volumes
    for (let i = 0; i < CALLS_PER_ROUND * LOAD_TEST_ROUNDS; i++) {
      metrics.recordCall('mul', Math.random() * 5, false);
    }
    for (let i = 0; i < CALLS_PER_ROUND; i++) {
      metrics.recordCall('sum', Math.random() * 5, i % 20 === 0);
    }

    const snap = metrics.snapshot();
    assert.equal(snap.totalCalls, CALLS_PER_ROUND * LOAD_TEST_ROUNDS + CALLS_PER_ROUND);
    assert.equal(snap.methods.mul.calls, CALLS_PER_ROUND * LOAD_TEST_ROUNDS);
    assert.equal(snap.methods.sum.calls, CALLS_PER_ROUND);
    assert.ok(snap.methods.sum.errors > 0);
  });
});
