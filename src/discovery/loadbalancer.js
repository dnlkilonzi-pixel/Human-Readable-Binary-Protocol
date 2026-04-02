'use strict';

/**
 * HRBP Client-Side Load Balancer
 *
 * Distributes RPC calls across multiple service instances returned by the
 * `ServiceRegistry`.  Supports pluggable strategies:
 *
 *   - `round-robin` (default) — even distribution
 *   - `random` — random selection
 *   - `least-pending` — pick the instance with the fewest in-flight calls
 *
 * Usage:
 *
 *   const lb = new LoadBalancer({ strategy: 'round-robin' });
 *   lb.addInstance({ host: '10.0.0.1', port: 7001 });
 *   lb.addInstance({ host: '10.0.0.2', port: 7001 });
 *
 *   const target = lb.pick(); // → { host, port }
 */

class LoadBalancer {
  /**
   * @param {Object} [opts]
   * @param {'round-robin'|'random'|'least-pending'} [opts.strategy='round-robin']
   */
  constructor(opts = {}) {
    this.strategy = opts.strategy || 'round-robin';
    /** @type {Array<{ host: string, port: number, pending: number }>} */
    this._instances = [];
    this._rrIndex = 0;
  }

  /**
   * Add a backend instance.
   *
   * @param {{ host: string, port: number }} instance
   * @returns {this}
   */
  addInstance(instance) {
    const existing = this._instances.find(
      (i) => i.host === instance.host && i.port === instance.port
    );
    if (!existing) {
      this._instances.push({ ...instance, pending: 0 });
    }
    return this;
  }

  /**
   * Remove a backend instance.
   *
   * @param {string} host
   * @param {number} port
   * @returns {this}
   */
  removeInstance(host, port) {
    this._instances = this._instances.filter(
      (i) => !(i.host === host && i.port === port)
    );
    return this;
  }

  /**
   * Replace all instances at once (e.g. after a registry refresh).
   *
   * @param {Array<{ host: string, port: number }>} instances
   * @returns {this}
   */
  setInstances(instances) {
    this._instances = instances.map((inst) => ({
      ...inst,
      pending: 0,
    }));
    this._rrIndex = 0;
    return this;
  }

  /**
   * Pick the next instance according to the strategy.
   *
   * @returns {{ host: string, port: number } | null}
   */
  pick() {
    if (this._instances.length === 0) return null;

    switch (this.strategy) {
      case 'round-robin': {
        const inst = this._instances[this._rrIndex % this._instances.length];
        this._rrIndex++;
        return inst;
      }

      case 'random': {
        const idx = Math.floor(Math.random() * this._instances.length);
        return this._instances[idx];
      }

      case 'least-pending': {
        let best = this._instances[0];
        for (const inst of this._instances) {
          if (inst.pending < best.pending) best = inst;
        }
        return best;
      }

      default:
        return this._instances[0];
    }
  }

  /**
   * Record that a call started on a specific instance (for least-pending).
   */
  markPending(host, port) {
    const inst = this._instances.find((i) => i.host === host && i.port === port);
    if (inst) inst.pending++;
  }

  /**
   * Record that a call completed on a specific instance (for least-pending).
   */
  markDone(host, port) {
    const inst = this._instances.find((i) => i.host === host && i.port === port);
    if (inst && inst.pending > 0) inst.pending--;
  }

  /** Number of registered instances. */
  get size() {
    return this._instances.length;
  }

  /** List all instances. */
  get instances() {
    return this._instances.map(({ host, port, pending }) => ({ host, port, pending }));
  }
}

module.exports = { LoadBalancer };
