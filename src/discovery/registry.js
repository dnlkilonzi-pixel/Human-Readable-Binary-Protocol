'use strict';

/**
 * HRBP Service Registry
 *
 * In-memory service registry for multi-node HRBP deployments.  Nodes register
 * themselves with name, host, port, and metadata; clients query the registry
 * to discover available instances.
 *
 * Features:
 *   - Register / deregister service instances
 *   - TTL-based health expiry (instances must re-register periodically)
 *   - Multiple instances per service name (for load balancing)
 *   - Tag-based filtering
 *
 * Usage:
 *
 *   const { ServiceRegistry } = require('./discovery/registry');
 *
 *   const registry = new ServiceRegistry();
 *
 *   registry.register({
 *     name: 'user-service',
 *     host: '10.0.0.1',
 *     port: 7001,
 *     tags: ['v1', 'primary'],
 *     ttl: 30000,  // ms — must re-register within 30s
 *   });
 *
 *   const instances = registry.lookup('user-service');
 *   // [{ name, host, port, tags, registeredAt, expiresAt }]
 */

const { EventEmitter } = require('events');

const DEFAULT_TTL = 30000; // 30 seconds
const SWEEP_INTERVAL = 5000; // check for expired entries every 5s

/**
 * @typedef {Object} ServiceInstance
 * @property {string}   name
 * @property {string}   host
 * @property {number}   port
 * @property {string[]} [tags]
 * @property {number}   [ttl]
 * @property {Object}   [metadata]
 */

class ServiceRegistry extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, Map<string, ServiceEntry>>}  name → (instanceId → entry) */
    this._services = new Map();
    this._sweepTimer = setInterval(() => this._sweep(), SWEEP_INTERVAL);
    // Allow the process to exit even if the timer is running.
    if (this._sweepTimer.unref) this._sweepTimer.unref();
  }

  /**
   * Register a service instance.
   *
   * @param {ServiceInstance} instance
   * @returns {string}  The instance ID (for deregistration).
   */
  register(instance) {
    const { name, host, port, tags = [], ttl = DEFAULT_TTL, metadata = {} } = instance;
    if (!name || !host || !port) {
      throw new Error('ServiceRegistry: name, host, and port are required');
    }

    const id = `${host}:${port}`;
    const now = Date.now();

    if (!this._services.has(name)) {
      this._services.set(name, new Map());
    }

    const entry = {
      id,
      name,
      host,
      port,
      tags,
      metadata,
      ttl,
      registeredAt: now,
      expiresAt: now + ttl,
    };

    this._services.get(name).set(id, entry);
    this.emit('register', entry);
    return id;
  }

  /**
   * Deregister a specific instance.
   *
   * @param {string} name       Service name.
   * @param {string} instanceId  `host:port`
   * @returns {boolean}  Whether the instance was found and removed.
   */
  deregister(name, instanceId) {
    const instances = this._services.get(name);
    if (!instances) return false;
    const entry = instances.get(instanceId);
    if (!entry) return false;
    instances.delete(instanceId);
    if (instances.size === 0) this._services.delete(name);
    this.emit('deregister', entry);
    return true;
  }

  /**
   * Look up all healthy instances of a service.
   *
   * @param {string}   name
   * @param {Object}   [filter]
   * @param {string[]} [filter.tags]  Only return instances with ALL of these tags.
   * @returns {Array}  Healthy entries matching the criteria.
   */
  lookup(name, filter = {}) {
    const instances = this._services.get(name);
    if (!instances) return [];

    const now = Date.now();
    const results = [];

    for (const entry of instances.values()) {
      if (entry.expiresAt < now) continue; // expired
      if (filter.tags && !filter.tags.every((t) => entry.tags.includes(t))) continue;
      results.push({ ...entry });
    }

    return results;
  }

  /**
   * List all registered service names.
   *
   * @returns {string[]}
   */
  listServices() {
    return [...this._services.keys()];
  }

  /**
   * Heartbeat / re-register — reset the TTL for an existing instance.
   *
   * @param {string} name
   * @param {string} instanceId
   * @returns {boolean}
   */
  heartbeat(name, instanceId) {
    const instances = this._services.get(name);
    if (!instances) return false;
    const entry = instances.get(instanceId);
    if (!entry) return false;
    entry.expiresAt = Date.now() + entry.ttl;
    return true;
  }

  /** Stop the background sweep timer. */
  close() {
    clearInterval(this._sweepTimer);
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  _sweep() {
    const now = Date.now();
    for (const [name, instances] of this._services) {
      for (const [id, entry] of instances) {
        if (entry.expiresAt < now) {
          instances.delete(id);
          this.emit('expire', entry);
        }
      }
      if (instances.size === 0) this._services.delete(name);
    }
  }
}

module.exports = { ServiceRegistry };
