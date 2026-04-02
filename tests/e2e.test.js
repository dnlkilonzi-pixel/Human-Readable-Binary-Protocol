'use strict';

/**
 * End-to-End Integration Tests
 *
 * Tests the full HRBP stack working together: RPC + middleware + observability + discovery.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { HRBPRpcServer } = require('../src/rpc/server');
const { HRBPRpcClient } = require('../src/rpc/client');
const { Tracer, InMemoryCollector } = require('../src/observability/tracing');
const { MetricsCollector } = require('../src/observability/metrics');
const { Logger } = require('../src/observability/logger');
const { ServiceRegistry } = require('../src/discovery/registry');
const { LoadBalancer } = require('../src/discovery/loadbalancer');
const { attachHealthCheck } = require('../src/discovery/health');

describe('End-to-End: RPC + Observability + Discovery', () => {
  let server, client, port;
  const collector = new InMemoryCollector();
  const tracer = new Tracer({ collector });
  const metrics = new MetricsCollector();
  const logEntries = [];
  const logger = new Logger({ level: 'debug', sink: { write: (e) => logEntries.push(e) } });

  before(() => new Promise((resolve) => {
    server = new HRBPRpcServer();

    // Observability middleware: tracing + metrics + logging
    server.use(async (envelope) => {
      const span = tracer.startSpan(envelope.method, { tags: { id: envelope.id } });
      envelope._span = span;
      logger.info('rpc:call', { method: envelope.method, id: envelope.id });
      return envelope;
    });

    server.handle('add', async ({ a, b }) => a + b);
    server.handle('echo', async (p) => p);
    attachHealthCheck(server, { serviceName: 'e2e-test' });

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

  it('RPC call works end-to-end with tracing', async () => {
    const result = await client.call('add', { a: 10, b: 20 });
    assert.equal(result, 30);

    // Tracing: span was created
    assert.ok(collector.spans.length >= 1);
    const span = collector.spans.find((s) => s.name === 'add');
    assert.ok(span, 'Should have a span for "add"');
  });

  it('metrics track calls', async () => {
    metrics.recordCall('add', 5, false);
    metrics.recordCall('add', 10, false);
    metrics.recordCall('echo', 3, true);
    const snap = metrics.snapshot();
    assert.equal(snap.totalCalls, 3);
    assert.equal(snap.methods.add.calls, 2);
    assert.equal(snap.methods.echo.errors, 1);
  });

  it('logger captures structured entries', () => {
    assert.ok(logEntries.length > 0);
    const entry = logEntries.find((e) => e.msg === 'rpc:call');
    assert.ok(entry);
    assert.equal(entry.method, 'add');
  });

  it('health check endpoint works', async () => {
    const health = await client.call('__health', {});
    assert.equal(health.status, 'healthy');
    assert.equal(health.service, 'e2e-test');
    assert.ok(health.uptime >= 0);
  });

  it('service discovery + load balancer integration', () => {
    const registry = new ServiceRegistry();
    registry.register({ name: 'e2e', host: '127.0.0.1', port, tags: ['test'] });
    registry.register({ name: 'e2e', host: '127.0.0.2', port: 8001, tags: ['test'] });

    const lb = new LoadBalancer({ strategy: 'round-robin' });
    const instances = registry.lookup('e2e');
    for (const inst of instances) {
      lb.addInstance({ host: inst.host, port: inst.port });
    }

    assert.equal(lb.size, 2);
    const pick1 = lb.pick();
    const pick2 = lb.pick();
    assert.notDeepEqual(pick1, pick2);
    registry.close();
  });

  it('multiple concurrent calls resolve correctly', async () => {
    const results = await Promise.all([
      client.call('add', { a: 1, b: 1 }),
      client.call('add', { a: 2, b: 2 }),
      client.call('echo', 'hello'),
      client.call('add', { a: 100, b: 200 }),
    ]);
    assert.equal(results[0], 2);
    assert.equal(results[1], 4);
    assert.equal(results[2], 'hello');
    assert.equal(results[3], 300);
  });
});
