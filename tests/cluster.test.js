'use strict';

/**
 * Tests for HRBP Cluster Coordinator and Consistent Hashing
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ConsistentHash, ClusterCoordinator } = require('../src/cluster');

// ---------------------------------------------------------------------------
// ConsistentHash
// ---------------------------------------------------------------------------

describe('ConsistentHash', () => {
  it('returns null when ring is empty', () => {
    const ch = new ConsistentHash();
    assert.equal(ch.getNode('key'), null);
  });

  it('routes to the only node when one exists', () => {
    const ch = new ConsistentHash();
    ch.addNode('node-1');
    assert.equal(ch.getNode('any-key'), 'node-1');
    assert.equal(ch.getNode('another-key'), 'node-1');
  });

  it('distributes keys across multiple nodes', () => {
    const ch = new ConsistentHash(100);
    ch.addNode('a');
    ch.addNode('b');
    ch.addNode('c');

    const counts = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 300; i++) {
      const node = ch.getNode(`key-${i}`);
      counts[node]++;
    }

    // Each node should get some keys (rough check)
    assert.ok(counts.a > 20, `node a got ${counts.a} keys`);
    assert.ok(counts.b > 20, `node b got ${counts.b} keys`);
    assert.ok(counts.c > 20, `node c got ${counts.c} keys`);
  });

  it('is deterministic — same key always maps to same node', () => {
    const ch = new ConsistentHash();
    ch.addNode('x');
    ch.addNode('y');
    const first = ch.getNode('test-key');
    for (let i = 0; i < 10; i++) {
      assert.equal(ch.getNode('test-key'), first);
    }
  });

  it('removeNode redistributes keys', () => {
    const ch = new ConsistentHash();
    ch.addNode('a');
    ch.addNode('b');
    const before = ch.getNode('key-42');
    ch.removeNode(before === 'a' ? 'b' : 'a');
    // After removing the OTHER node, key-42 might stay or move to the remaining node
    const after = ch.getNode('key-42');
    assert.ok(after === 'a' || after === 'b');
  });

  it('addNode is idempotent', () => {
    const ch = new ConsistentHash();
    ch.addNode('a');
    ch.addNode('a');
    assert.equal(ch.size, 1);
  });

  it('size tracks distinct nodes', () => {
    const ch = new ConsistentHash();
    assert.equal(ch.size, 0);
    ch.addNode('a');
    assert.equal(ch.size, 1);
    ch.addNode('b');
    assert.equal(ch.size, 2);
    ch.removeNode('a');
    assert.equal(ch.size, 1);
  });

  it('nodeIds lists all nodes', () => {
    const ch = new ConsistentHash();
    ch.addNode('x');
    ch.addNode('y');
    assert.deepEqual(ch.nodeIds.sort(), ['x', 'y']);
  });

  it('getNodes returns multiple distinct nodes', () => {
    const ch = new ConsistentHash();
    ch.addNode('a');
    ch.addNode('b');
    ch.addNode('c');
    const nodes = ch.getNodes('key', 2);
    assert.equal(nodes.length, 2);
    assert.notEqual(nodes[0], nodes[1]);
  });

  it('getNodes returns at most N nodes', () => {
    const ch = new ConsistentHash();
    ch.addNode('a');
    ch.addNode('b');
    const nodes = ch.getNodes('key', 5);
    assert.equal(nodes.length, 2); // only 2 nodes exist
  });

  it('getNodes returns empty array for empty ring', () => {
    const ch = new ConsistentHash();
    assert.deepEqual(ch.getNodes('key', 3), []);
  });
});

// ---------------------------------------------------------------------------
// ClusterCoordinator
// ---------------------------------------------------------------------------

describe('ClusterCoordinator', () => {
  it('adds and routes to nodes', () => {
    const cluster = new ClusterCoordinator({ nodeId: 'me' });
    cluster.addNode({ id: 'n1', host: '10.0.0.1', port: 7001 });
    cluster.addNode({ id: 'n2', host: '10.0.0.2', port: 7001 });
    const target = cluster.route('user:42');
    assert.ok(target);
    assert.ok(['n1', 'n2'].includes(target.id));
    cluster.close();
  });

  it('returns null for empty cluster', () => {
    const cluster = new ClusterCoordinator({ nodeId: 'me' });
    assert.equal(cluster.route('key'), null);
    cluster.close();
  });

  it('removeNode works', () => {
    const cluster = new ClusterCoordinator({ nodeId: 'me' });
    cluster.addNode({ id: 'n1', host: '10.0.0.1', port: 7001 });
    assert.equal(cluster.size, 1);
    cluster.removeNode('n1');
    assert.equal(cluster.size, 0);
    cluster.close();
  });

  it('heartbeat updates lastSeen', () => {
    const cluster = new ClusterCoordinator({ nodeId: 'me' });
    cluster.addNode({ id: 'n1', host: '10.0.0.1', port: 7001 });
    const ok = cluster.heartbeat('n1');
    assert.equal(ok, true);
    assert.equal(cluster.heartbeat('nonexistent'), false);
    cluster.close();
  });

  it('getStaleNodes finds nodes past TTL', async () => {
    const cluster = new ClusterCoordinator({ nodeId: 'me' });
    cluster.addNode({ id: 'n1', host: '10.0.0.1', port: 7001 });
    await new Promise((r) => setTimeout(r, 50));
    const stale = cluster.getStaleNodes(10); // 10ms TTL
    assert.equal(stale.length, 1);
    assert.equal(stale[0].id, 'n1');
    cluster.close();
  });

  it('evictStale removes stale nodes', async () => {
    const cluster = new ClusterCoordinator({ nodeId: 'me' });
    cluster.addNode({ id: 'n1', host: '10.0.0.1', port: 7001 });
    cluster.addNode({ id: 'n2', host: '10.0.0.2', port: 7001 });
    await new Promise((r) => setTimeout(r, 50));
    cluster.heartbeat('n2'); // keep n2 alive
    const evicted = cluster.evictStale(10);
    assert.equal(evicted, 1);
    assert.equal(cluster.size, 1);
    cluster.close();
  });

  it('routeWithRegion prefers same-region nodes', () => {
    const cluster = new ClusterCoordinator({ nodeId: 'me', region: 'us-east' });
    cluster.addNode({ id: 'n1', host: '10.0.0.1', port: 7001, region: 'us-east' });
    cluster.addNode({ id: 'n2', host: '10.0.0.2', port: 7001, region: 'eu-west' });

    // Try many keys — at least some should prefer us-east
    let sameRegionCount = 0;
    for (let i = 0; i < 50; i++) {
      const target = cluster.routeWithRegion(`key-${i}`, 'us-east', 2);
      if (target && target.region === 'us-east') sameRegionCount++;
    }
    assert.ok(sameRegionCount > 0, 'Should prefer same-region nodes');
    cluster.close();
  });

  it('getNodesByRegion filters correctly', () => {
    const cluster = new ClusterCoordinator({ nodeId: 'me' });
    cluster.addNode({ id: 'n1', host: '10.0.0.1', port: 7001, region: 'us' });
    cluster.addNode({ id: 'n2', host: '10.0.0.2', port: 7001, region: 'eu' });
    cluster.addNode({ id: 'n3', host: '10.0.0.3', port: 7001, region: 'us' });
    const usNodes = cluster.getNodesByRegion('us');
    assert.equal(usNodes.length, 2);
    cluster.close();
  });

  it('emits node:add and node:remove events', () => {
    const cluster = new ClusterCoordinator({ nodeId: 'me' });
    const events = [];
    cluster.on('node:add', (n) => events.push(['add', n.id]));
    cluster.on('node:remove', (n) => events.push(['remove', n.id]));
    cluster.addNode({ id: 'n1', host: '10.0.0.1', port: 7001 });
    cluster.removeNode('n1');
    assert.deepEqual(events, [['add', 'n1'], ['remove', 'n1']]);
    cluster.close();
  });

  it('nodes getter returns all nodes', () => {
    const cluster = new ClusterCoordinator({ nodeId: 'me' });
    cluster.addNode({ id: 'a', host: '1', port: 1 });
    cluster.addNode({ id: 'b', host: '2', port: 2 });
    assert.equal(cluster.nodes.length, 2);
    cluster.close();
  });
});
