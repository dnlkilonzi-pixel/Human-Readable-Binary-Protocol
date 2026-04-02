'use strict';

/**
 * HRBP Cluster Coordinator
 *
 * Provides horizontal scaling primitives for multi-node HRBP deployments:
 *
 *   - Consistent hashing for deterministic request routing
 *   - Cluster membership management via heartbeats
 *   - Multi-region awareness (region tags for locality-aware routing)
 *   - Coordinated state sharing between nodes
 *
 * Usage:
 *
 *   const { ClusterCoordinator, ConsistentHash } = require('./cluster');
 *
 *   const cluster = new ClusterCoordinator({
 *     nodeId: 'node-1',
 *     region: 'us-east-1',
 *   });
 *
 *   cluster.addNode({ id: 'node-2', host: '10.0.0.2', port: 7001, region: 'us-east-1' });
 *   cluster.addNode({ id: 'node-3', host: '10.0.0.3', port: 7001, region: 'eu-west-1' });
 *
 *   const target = cluster.route('user:42');  // → deterministic node
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');

// ---------------------------------------------------------------------------
// Consistent Hash Ring
// ---------------------------------------------------------------------------

class ConsistentHash {
  /**
   * @param {number} [replicas=150]  Virtual nodes per real node.
   */
  constructor(replicas = 150) {
    this._replicas = replicas;
    this._ring = [];     // sorted array of { hash, nodeId }
    this._nodes = new Map(); // nodeId → node info
  }

  /**
   * Add a node to the hash ring.
   *
   * @param {string} nodeId
   * @param {Object} [info]  Arbitrary metadata stored alongside the node.
   */
  addNode(nodeId, info = {}) {
    if (this._nodes.has(nodeId)) return;
    this._nodes.set(nodeId, info);
    for (let i = 0; i < this._replicas; i++) {
      const hash = this._hash(`${nodeId}:${i}`);
      this._ring.push({ hash, nodeId });
    }
    this._ring.sort((a, b) => a.hash - b.hash);
  }

  /**
   * Remove a node from the hash ring.
   *
   * @param {string} nodeId
   */
  removeNode(nodeId) {
    this._nodes.delete(nodeId);
    this._ring = this._ring.filter((v) => v.nodeId !== nodeId);
  }

  /**
   * Look up the node responsible for `key`.
   *
   * @param {string} key
   * @returns {string|null}  The nodeId, or null if the ring is empty.
   */
  getNode(key) {
    if (this._ring.length === 0) return null;
    const hash = this._hash(key);

    // Binary search for the first virtual node >= hash.
    let lo = 0, hi = this._ring.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this._ring[mid].hash < hash) lo = mid + 1;
      else hi = mid;
    }

    // Wrap around to the first node if hash exceeds all entries.
    const idx = lo < this._ring.length ? lo : 0;
    return this._ring[idx].nodeId;
  }

  /**
   * Get the N closest nodes (for replication).
   *
   * @param {string} key
   * @param {number} n
   * @returns {string[]}  Up to n distinct nodeIds.
   */
  getNodes(key, n) {
    if (this._ring.length === 0) return [];
    const hash = this._hash(key);
    const result = [];
    const seen = new Set();

    let lo = 0, hi = this._ring.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this._ring[mid].hash < hash) lo = mid + 1;
      else hi = mid;
    }

    for (let i = 0; i < this._ring.length && result.length < n; i++) {
      const idx = (lo + i) % this._ring.length;
      const nodeId = this._ring[idx].nodeId;
      if (!seen.has(nodeId)) {
        seen.add(nodeId);
        result.push(nodeId);
      }
    }

    return result;
  }

  /** Number of distinct nodes in the ring. */
  get size() {
    return this._nodes.size;
  }

  /** All registered node IDs. */
  get nodeIds() {
    return [...this._nodes.keys()];
  }

  _hash(str) {
    const h = crypto.createHash('md5').update(str).digest();
    return h.readUInt32BE(0);
  }
}

// ---------------------------------------------------------------------------
// Cluster Coordinator
// ---------------------------------------------------------------------------

class ClusterCoordinator extends EventEmitter {
  /**
   * @param {Object} opts
   * @param {string} opts.nodeId   Unique ID for this node.
   * @param {string} [opts.region] Region tag for locality-aware routing.
   * @param {number} [opts.replicas=150]  Virtual nodes for consistent hashing.
   */
  constructor(opts = {}) {
    super();
    this.nodeId = opts.nodeId || `node-${Date.now()}`;
    this.region = opts.region || 'default';
    this._hash = new ConsistentHash(opts.replicas || 150);
    this._nodes = new Map(); // nodeId → { host, port, region, lastSeen, metadata }
    this._heartbeatInterval = null;
  }

  /**
   * Add a node to the cluster.
   *
   * @param {Object} node
   * @param {string} node.id
   * @param {string} node.host
   * @param {number} node.port
   * @param {string} [node.region='default']
   * @param {Object} [node.metadata={}]
   */
  addNode(node) {
    const { id, host, port, region = 'default', metadata = {} } = node;
    const entry = { id, host, port, region, metadata, lastSeen: Date.now() };
    this._nodes.set(id, entry);
    this._hash.addNode(id, entry);
    this.emit('node:add', entry);
  }

  /**
   * Remove a node from the cluster.
   *
   * @param {string} nodeId
   */
  removeNode(nodeId) {
    const entry = this._nodes.get(nodeId);
    this._nodes.delete(nodeId);
    this._hash.removeNode(nodeId);
    if (entry) this.emit('node:remove', entry);
  }

  /**
   * Record a heartbeat from a node.
   *
   * @param {string} nodeId
   * @returns {boolean}
   */
  heartbeat(nodeId) {
    const entry = this._nodes.get(nodeId);
    if (!entry) return false;
    entry.lastSeen = Date.now();
    return true;
  }

  /**
   * Route a key to the appropriate node using consistent hashing.
   *
   * @param {string} key
   * @returns {{ id: string, host: string, port: number, region: string }|null}
   */
  route(key) {
    const nodeId = this._hash.getNode(key);
    if (!nodeId) return null;
    return this._nodes.get(nodeId) || null;
  }

  /**
   * Route a key preferring nodes in the given region.
   *
   * @param {string} key
   * @param {string} preferredRegion
   * @param {number} [candidates=3]
   * @returns {{ id: string, host: string, port: number, region: string }|null}
   */
  routeWithRegion(key, preferredRegion, candidates = 3) {
    const nodeIds = this._hash.getNodes(key, candidates);
    if (nodeIds.length === 0) return null;

    // Prefer same-region node.
    for (const id of nodeIds) {
      const node = this._nodes.get(id);
      if (node && node.region === preferredRegion) return node;
    }

    // Fall back to the first candidate.
    return this._nodes.get(nodeIds[0]) || null;
  }

  /**
   * Get all nodes in a specific region.
   *
   * @param {string} region
   * @returns {Array}
   */
  getNodesByRegion(region) {
    return [...this._nodes.values()].filter((n) => n.region === region);
  }

  /**
   * Get nodes that haven't sent a heartbeat within `ttlMs`.
   *
   * @param {number} ttlMs  Heartbeat TTL in ms.
   * @returns {Array}  Stale node entries.
   */
  getStaleNodes(ttlMs = 30000) {
    const now = Date.now();
    return [...this._nodes.values()].filter((n) => now - n.lastSeen > ttlMs);
  }

  /**
   * Remove all nodes that haven't sent a heartbeat within `ttlMs`.
   *
   * @param {number} ttlMs
   * @returns {number}  Number of nodes removed.
   */
  evictStale(ttlMs = 30000) {
    const stale = this.getStaleNodes(ttlMs);
    for (const node of stale) {
      this.removeNode(node.id);
    }
    return stale.length;
  }

  /** Number of nodes in the cluster. */
  get size() {
    return this._nodes.size;
  }

  /** All registered nodes. */
  get nodes() {
    return [...this._nodes.values()];
  }

  /** Stop any background timers. */
  close() {
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
      this._heartbeatInterval = null;
    }
  }
}

module.exports = { ConsistentHash, ClusterCoordinator };
