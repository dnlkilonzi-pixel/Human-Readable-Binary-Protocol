'use strict';

/**
 * HRBP Metrics Collector
 *
 * Collects quantitative metrics for HRBP servers and clients: call counts,
 * error rates, latency histograms, bytes sent/received.
 *
 * Designed to be pluggable — use the built-in `InMemoryMetrics` for testing,
 * or implement the same interface to export to Prometheus, StatsD, etc.
 *
 * Usage:
 *
 *   const { MetricsCollector } = require('./observability/metrics');
 *
 *   const metrics = new MetricsCollector();
 *
 *   // Record an RPC call
 *   metrics.recordCall('add', 2.5, false);  // method, latencyMs, isError
 *
 *   // Get a snapshot
 *   console.log(metrics.snapshot());
 */

class MetricsCollector {
  constructor() {
    /** @type {Map<string, MethodMetrics>} */
    this._methods = new Map();
    this._global = {
      totalCalls: 0,
      totalErrors: 0,
      totalBytes: 0,
      startedAt: Date.now(),
    };
  }

  /**
   * Record an RPC call.
   *
   * @param {string}  method     RPC method name.
   * @param {number}  latencyMs  How long the call took.
   * @param {boolean} isError    Whether the call resulted in an error.
   */
  recordCall(method, latencyMs, isError = false) {
    this._global.totalCalls++;
    if (isError) this._global.totalErrors++;

    if (!this._methods.has(method)) {
      this._methods.set(method, {
        calls: 0,
        errors: 0,
        totalLatency: 0,
        minLatency: Infinity,
        maxLatency: 0,
      });
    }

    const m = this._methods.get(method);
    m.calls++;
    if (isError) m.errors++;
    m.totalLatency += latencyMs;
    if (latencyMs < m.minLatency) m.minLatency = latencyMs;
    if (latencyMs > m.maxLatency) m.maxLatency = latencyMs;
  }

  /**
   * Record bytes transferred.
   *
   * @param {number} bytes
   */
  recordBytes(bytes) {
    this._global.totalBytes += bytes;
  }

  /**
   * Get a snapshot of all collected metrics.
   *
   * @returns {Object}
   */
  snapshot() {
    const methods = {};
    for (const [name, m] of this._methods) {
      methods[name] = {
        calls: m.calls,
        errors: m.errors,
        errorRate: m.calls > 0 ? m.errors / m.calls : 0,
        avgLatencyMs: m.calls > 0 ? m.totalLatency / m.calls : 0,
        minLatencyMs: m.minLatency === Infinity ? 0 : m.minLatency,
        maxLatencyMs: m.maxLatency,
      };
    }

    return {
      uptime: Date.now() - this._global.startedAt,
      totalCalls: this._global.totalCalls,
      totalErrors: this._global.totalErrors,
      totalBytes: this._global.totalBytes,
      errorRate: this._global.totalCalls > 0
        ? this._global.totalErrors / this._global.totalCalls
        : 0,
      methods,
    };
  }

  /** Reset all counters. */
  reset() {
    this._methods.clear();
    this._global.totalCalls = 0;
    this._global.totalErrors = 0;
    this._global.totalBytes = 0;
    this._global.startedAt = Date.now();
  }
}

module.exports = { MetricsCollector };
