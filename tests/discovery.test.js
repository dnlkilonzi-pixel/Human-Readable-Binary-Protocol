'use strict';

/**
 * Tests for HRBP Service Discovery: Registry, Load Balancer, Health Check
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ServiceRegistry } = require('../src/discovery/registry');
const { LoadBalancer } = require('../src/discovery/loadbalancer');
const { attachHealthCheck } = require('../src/discovery/health');

// ---------------------------------------------------------------------------
// ServiceRegistry
// ---------------------------------------------------------------------------

describe('ServiceRegistry', () => {
  it('registers and looks up an instance', () => {
    const reg = new ServiceRegistry();
    reg.register({ name: 'svc-a', host: '10.0.0.1', port: 7001 });
    const instances = reg.lookup('svc-a');
    assert.equal(instances.length, 1);
    assert.equal(instances[0].host, '10.0.0.1');
    assert.equal(instances[0].port, 7001);
    reg.close();
  });

  it('throws for missing fields', () => {
    const reg = new ServiceRegistry();
    assert.throws(() => reg.register({ name: 'svc' }), /required/);
    reg.close();
  });

  it('supports multiple instances per service', () => {
    const reg = new ServiceRegistry();
    reg.register({ name: 'svc', host: '10.0.0.1', port: 7001 });
    reg.register({ name: 'svc', host: '10.0.0.2', port: 7001 });
    assert.equal(reg.lookup('svc').length, 2);
    reg.close();
  });

  it('deregisters an instance', () => {
    const reg = new ServiceRegistry();
    const id = reg.register({ name: 'svc', host: '10.0.0.1', port: 7001 });
    assert.equal(reg.lookup('svc').length, 1);
    const removed = reg.deregister('svc', id);
    assert.equal(removed, true);
    assert.equal(reg.lookup('svc').length, 0);
    reg.close();
  });

  it('deregister returns false for unknown instance', () => {
    const reg = new ServiceRegistry();
    assert.equal(reg.deregister('svc', 'x:1'), false);
    reg.close();
  });

  it('heartbeat resets TTL', () => {
    const reg = new ServiceRegistry();
    const id = reg.register({ name: 'svc', host: '10.0.0.1', port: 7001, ttl: 10000 });
    const ok = reg.heartbeat('svc', id);
    assert.equal(ok, true);
    reg.close();
  });

  it('heartbeat returns false for unknown instance', () => {
    const reg = new ServiceRegistry();
    assert.equal(reg.heartbeat('svc', 'x:1'), false);
    reg.close();
  });

  it('listServices returns all registered names', () => {
    const reg = new ServiceRegistry();
    reg.register({ name: 'a', host: '1.2.3.4', port: 1 });
    reg.register({ name: 'b', host: '1.2.3.4', port: 2 });
    const names = reg.listServices();
    assert.deepEqual(names.sort(), ['a', 'b']);
    reg.close();
  });

  it('filters by tags', () => {
    const reg = new ServiceRegistry();
    reg.register({ name: 'svc', host: '10.0.0.1', port: 7001, tags: ['v1', 'prod'] });
    reg.register({ name: 'svc', host: '10.0.0.2', port: 7001, tags: ['v2', 'staging'] });
    const prod = reg.lookup('svc', { tags: ['prod'] });
    assert.equal(prod.length, 1);
    assert.equal(prod[0].host, '10.0.0.1');
    reg.close();
  });

  it('expired instances are excluded from lookup', () => {
    const reg = new ServiceRegistry();
    reg.register({ name: 'svc', host: '10.0.0.1', port: 7001, ttl: 1 }); // 1ms TTL

    // Wait for expiry
    return new Promise((resolve) => {
      setTimeout(() => {
        const instances = reg.lookup('svc');
        assert.equal(instances.length, 0);
        reg.close();
        resolve();
      }, 50);
    });
  });

  it('emits register event', (_, done) => {
    const reg = new ServiceRegistry();
    reg.on('register', (entry) => {
      assert.equal(entry.name, 'svc');
      reg.close();
      done();
    });
    reg.register({ name: 'svc', host: '1.2.3.4', port: 1 });
  });

  it('emits deregister event', (_, done) => {
    const reg = new ServiceRegistry();
    reg.on('deregister', (entry) => {
      assert.equal(entry.name, 'svc');
      reg.close();
      done();
    });
    const id = reg.register({ name: 'svc', host: '1.2.3.4', port: 1 });
    reg.deregister('svc', id);
  });

  it('returns empty for unknown service', () => {
    const reg = new ServiceRegistry();
    assert.deepEqual(reg.lookup('unknown'), []);
    reg.close();
  });
});

// ---------------------------------------------------------------------------
// LoadBalancer
// ---------------------------------------------------------------------------

describe('LoadBalancer', () => {
  it('round-robin distributes evenly', () => {
    const lb = new LoadBalancer({ strategy: 'round-robin' });
    lb.addInstance({ host: 'a', port: 1 });
    lb.addInstance({ host: 'b', port: 2 });
    lb.addInstance({ host: 'c', port: 3 });

    const picks = [];
    for (let i = 0; i < 6; i++) {
      picks.push(lb.pick().host);
    }
    assert.deepEqual(picks, ['a', 'b', 'c', 'a', 'b', 'c']);
  });

  it('random returns a valid instance', () => {
    const lb = new LoadBalancer({ strategy: 'random' });
    lb.addInstance({ host: 'a', port: 1 });
    lb.addInstance({ host: 'b', port: 2 });
    const pick = lb.pick();
    assert.ok(['a', 'b'].includes(pick.host));
  });

  it('least-pending picks the instance with fewest pending calls', () => {
    const lb = new LoadBalancer({ strategy: 'least-pending' });
    lb.addInstance({ host: 'a', port: 1 });
    lb.addInstance({ host: 'b', port: 2 });
    lb.markPending('a', 1);
    lb.markPending('a', 1);
    lb.markPending('b', 2);
    const pick = lb.pick();
    assert.equal(pick.host, 'b'); // 1 pending vs 2
  });

  it('markDone decrements pending count', () => {
    const lb = new LoadBalancer({ strategy: 'least-pending' });
    lb.addInstance({ host: 'a', port: 1 });
    lb.markPending('a', 1);
    lb.markPending('a', 1);
    lb.markDone('a', 1);
    assert.equal(lb.instances[0].pending, 1);
  });

  it('returns null when no instances', () => {
    const lb = new LoadBalancer();
    assert.equal(lb.pick(), null);
  });

  it('addInstance ignores duplicates', () => {
    const lb = new LoadBalancer();
    lb.addInstance({ host: 'a', port: 1 });
    lb.addInstance({ host: 'a', port: 1 });
    assert.equal(lb.size, 1);
  });

  it('removeInstance removes correctly', () => {
    const lb = new LoadBalancer();
    lb.addInstance({ host: 'a', port: 1 });
    lb.addInstance({ host: 'b', port: 2 });
    lb.removeInstance('a', 1);
    assert.equal(lb.size, 1);
    assert.equal(lb.instances[0].host, 'b');
  });

  it('setInstances replaces all', () => {
    const lb = new LoadBalancer();
    lb.addInstance({ host: 'a', port: 1 });
    lb.setInstances([{ host: 'x', port: 9 }, { host: 'y', port: 8 }]);
    assert.equal(lb.size, 2);
    assert.equal(lb.instances[0].host, 'x');
  });
});

// ---------------------------------------------------------------------------
// Health Check
// ---------------------------------------------------------------------------

describe('attachHealthCheck', () => {
  it('registers a __health handler that returns status info', async () => {
    // Minimal mock of HRBPRpcServer
    const handlers = new Map();
    const mockServer = {
      handle(name, fn) { handlers.set(name, fn); },
    };

    attachHealthCheck(mockServer, { serviceName: 'test-svc' });
    assert.ok(handlers.has('__health'));

    const result = await handlers.get('__health')();
    assert.equal(result.status, 'healthy');
    assert.equal(result.service, 'test-svc');
    assert.equal(typeof result.uptime, 'number');
    assert.equal(typeof result.timestamp, 'number');
    assert.equal(typeof result.hostname, 'string');
    assert.equal(typeof result.pid, 'number');
  });

  it('runs custom checks and reports degraded', async () => {
    const handlers = new Map();
    const mockServer = {
      handle(name, fn) { handlers.set(name, fn); },
    };

    attachHealthCheck(mockServer, {
      serviceName: 'test-svc',
      checks: {
        db: async () => true,
        cache: async () => false,
      },
    });

    const result = await handlers.get('__health')();
    assert.equal(result.status, 'degraded');
    assert.equal(result.checks.db, true);
    assert.equal(result.checks.cache, false);
  });

  it('reports unhealthy when all checks fail', async () => {
    const handlers = new Map();
    const mockServer = {
      handle(name, fn) { handlers.set(name, fn); },
    };

    attachHealthCheck(mockServer, {
      serviceName: 'test-svc',
      checks: {
        db: async () => { throw new Error('down'); },
        cache: async () => false,
      },
    });

    const result = await handlers.get('__health')();
    assert.equal(result.status, 'unhealthy');
  });
});
