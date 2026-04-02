'use strict';

/**
 * HRBP Tracing
 *
 * Provides distributed-tracing hooks for HRBP RPC calls.  Each call can carry
 * a `traceId` and `spanId` in the envelope metadata, enabling end-to-end
 * visibility across services.
 *
 * Pluggable: you bring your own trace collector (e.g. Jaeger, Zipkin, OTLP).
 * This module provides the in-process span lifecycle and a default no-op
 * collector.
 *
 * Usage:
 *
 *   const { Tracer } = require('./observability/tracing');
 *
 *   const tracer = new Tracer({ collector: myCollector });
 *
 *   const span = tracer.startSpan('add', { a: 1, b: 2 });
 *   // ... do work ...
 *   span.finish({ result: 3 });
 */

const crypto = require('crypto');

function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * @typedef {Object} Span
 * @property {string}  traceId
 * @property {string}  spanId
 * @property {string}  [parentSpanId]
 * @property {string}  name
 * @property {number}  startTime     Unix ms.
 * @property {number}  [endTime]
 * @property {number}  [duration]    ms.
 * @property {Object}  [tags]
 * @property {string}  [status]      'ok' | 'error'
 */

class SpanImpl {
  constructor(tracer, name, opts = {}) {
    this.traceId = opts.traceId || generateId();
    this.spanId = generateId();
    this.parentSpanId = opts.parentSpanId || null;
    this.name = name;
    this.startTime = Date.now();
    this.endTime = null;
    this.duration = null;
    this.tags = opts.tags || {};
    this.status = 'ok';
    this._tracer = tracer;
  }

  /** Add key-value tags to this span. */
  setTag(key, value) {
    this.tags[key] = value;
    return this;
  }

  /** Mark this span as an error. */
  setError(err) {
    this.status = 'error';
    this.tags.error = err instanceof Error ? err.message : String(err);
    return this;
  }

  /** Finish the span and send it to the collector. */
  finish() {
    this.endTime = Date.now();
    this.duration = this.endTime - this.startTime;
    this._tracer._report(this);
    return this;
  }

  /** Serializable representation for wire transmission. */
  toJSON() {
    return {
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      name: this.name,
      startTime: this.startTime,
      endTime: this.endTime,
      duration: this.duration,
      tags: this.tags,
      status: this.status,
    };
  }
}

/**
 * No-op collector — stores spans in memory.  Replace with your own
 * implementation to export to Jaeger, Zipkin, etc.
 */
class InMemoryCollector {
  constructor() {
    this.spans = [];
  }

  report(span) {
    this.spans.push(span.toJSON());
  }

  /** Get all collected spans and clear. */
  flush() {
    const result = [...this.spans];
    this.spans = [];
    return result;
  }
}

class Tracer {
  /**
   * @param {Object} [opts]
   * @param {{ report: Function }} [opts.collector]  Span collector instance.
   */
  constructor(opts = {}) {
    this.collector = opts.collector || new InMemoryCollector();
  }

  /**
   * Start a new span.
   *
   * @param {string} name      Operation name (e.g. RPC method).
   * @param {Object} [opts]
   * @param {string} [opts.traceId]       Continue an existing trace.
   * @param {string} [opts.parentSpanId]  Parent span for nesting.
   * @param {Object} [opts.tags]          Initial tags.
   * @returns {SpanImpl}
   */
  startSpan(name, opts = {}) {
    return new SpanImpl(this, name, opts);
  }

  _report(span) {
    this.collector.report(span);
  }
}

module.exports = { Tracer, InMemoryCollector, SpanImpl };
