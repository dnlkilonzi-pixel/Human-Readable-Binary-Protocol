'use strict';

/**
 * Tests for HRBP Observability: Tracing, Metrics, Logger
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { Tracer, InMemoryCollector } = require('../src/observability/tracing');
const { MetricsCollector } = require('../src/observability/metrics');
const { Logger, LEVELS } = require('../src/observability/logger');

// ---------------------------------------------------------------------------
// Tracer
// ---------------------------------------------------------------------------

describe('Tracer', () => {
  it('creates a span with generated IDs', () => {
    const tracer = new Tracer();
    const span = tracer.startSpan('test-op');
    assert.equal(span.name, 'test-op');
    assert.equal(typeof span.traceId, 'string');
    assert.equal(typeof span.spanId, 'string');
    assert.equal(span.traceId.length, 16);
    assert.equal(span.spanId.length, 16);
    assert.equal(span.status, 'ok');
    assert.equal(span.parentSpanId, null);
  });

  it('accepts explicit traceId and parentSpanId', () => {
    const tracer = new Tracer();
    const span = tracer.startSpan('child', {
      traceId: 'trace-abc',
      parentSpanId: 'parent-123',
    });
    assert.equal(span.traceId, 'trace-abc');
    assert.equal(span.parentSpanId, 'parent-123');
  });

  it('setTag adds key-value tags', () => {
    const tracer = new Tracer();
    const span = tracer.startSpan('op');
    span.setTag('method', 'add');
    span.setTag('userId', 42);
    assert.equal(span.tags.method, 'add');
    assert.equal(span.tags.userId, 42);
  });

  it('setError marks span as error', () => {
    const tracer = new Tracer();
    const span = tracer.startSpan('op');
    span.setError(new Error('boom'));
    assert.equal(span.status, 'error');
    assert.equal(span.tags.error, 'boom');
  });

  it('setError handles string errors', () => {
    const tracer = new Tracer();
    const span = tracer.startSpan('op');
    span.setError('string error');
    assert.equal(span.tags.error, 'string error');
  });

  it('finish sets endTime and duration, reports to collector', () => {
    const collector = new InMemoryCollector();
    const tracer = new Tracer({ collector });
    const span = tracer.startSpan('op');
    span.finish();
    assert.ok(span.endTime >= span.startTime);
    assert.equal(typeof span.duration, 'number');
    assert.ok(span.duration >= 0);
    assert.equal(collector.spans.length, 1);
  });

  it('toJSON returns serializable representation', () => {
    const tracer = new Tracer();
    const span = tracer.startSpan('op', { tags: { k: 'v' } });
    span.finish();
    const json = span.toJSON();
    assert.equal(json.name, 'op');
    assert.equal(json.tags.k, 'v');
    assert.equal(typeof json.duration, 'number');
  });
});

describe('InMemoryCollector', () => {
  it('stores and flushes spans', () => {
    const collector = new InMemoryCollector();
    const tracer = new Tracer({ collector });
    tracer.startSpan('a').finish();
    tracer.startSpan('b').finish();
    assert.equal(collector.spans.length, 2);
    const flushed = collector.flush();
    assert.equal(flushed.length, 2);
    assert.equal(collector.spans.length, 0);
  });
});

// ---------------------------------------------------------------------------
// MetricsCollector
// ---------------------------------------------------------------------------

describe('MetricsCollector', () => {
  it('records calls and computes snapshot', () => {
    const mc = new MetricsCollector();
    mc.recordCall('add', 5, false);
    mc.recordCall('add', 10, false);
    mc.recordCall('add', 15, true);
    const snap = mc.snapshot();
    assert.equal(snap.totalCalls, 3);
    assert.equal(snap.totalErrors, 1);
    assert.equal(snap.methods.add.calls, 3);
    assert.equal(snap.methods.add.errors, 1);
    assert.ok(Math.abs(snap.methods.add.avgLatencyMs - 10) < 0.01);
    assert.equal(snap.methods.add.minLatencyMs, 5);
    assert.equal(snap.methods.add.maxLatencyMs, 15);
  });

  it('tracks error rate', () => {
    const mc = new MetricsCollector();
    mc.recordCall('a', 1, true);
    mc.recordCall('a', 1, false);
    const snap = mc.snapshot();
    assert.ok(Math.abs(snap.errorRate - 0.5) < 0.01);
    assert.ok(Math.abs(snap.methods.a.errorRate - 0.5) < 0.01);
  });

  it('recordBytes tracks total bytes', () => {
    const mc = new MetricsCollector();
    mc.recordBytes(100);
    mc.recordBytes(200);
    assert.equal(mc.snapshot().totalBytes, 300);
  });

  it('reset clears all counters', () => {
    const mc = new MetricsCollector();
    mc.recordCall('x', 5, false);
    mc.recordBytes(100);
    mc.reset();
    const snap = mc.snapshot();
    assert.equal(snap.totalCalls, 0);
    assert.equal(snap.totalBytes, 0);
    assert.deepEqual(snap.methods, {});
  });

  it('uptime increases over time', async () => {
    const mc = new MetricsCollector();
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(mc.snapshot().uptime >= 15);
  });

  it('handles multiple methods independently', () => {
    const mc = new MetricsCollector();
    mc.recordCall('add', 5, false);
    mc.recordCall('sub', 10, true);
    const snap = mc.snapshot();
    assert.equal(snap.methods.add.calls, 1);
    assert.equal(snap.methods.sub.calls, 1);
    assert.equal(snap.methods.add.errors, 0);
    assert.equal(snap.methods.sub.errors, 1);
  });
});

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

describe('Logger', () => {
  it('exports LEVELS', () => {
    assert.equal(LEVELS.debug, 0);
    assert.equal(LEVELS.info, 1);
    assert.equal(LEVELS.warn, 2);
    assert.equal(LEVELS.error, 3);
  });

  it('logs to custom sink', () => {
    const entries = [];
    const sink = { write: (entry) => entries.push(entry) };
    const logger = new Logger({ level: 'debug', name: 'test', sink });

    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    assert.equal(entries.length, 4);
    assert.equal(entries[0].level, 'debug');
    assert.equal(entries[0].msg, 'd');
    assert.equal(entries[0].name, 'test');
    assert.ok(entries[0].ts);
  });

  it('respects log level filtering', () => {
    const entries = [];
    const sink = { write: (entry) => entries.push(entry) };
    const logger = new Logger({ level: 'warn', sink });

    logger.debug('skip');
    logger.info('skip');
    logger.warn('yes');
    logger.error('yes');

    assert.equal(entries.length, 2);
  });

  it('child() inherits fields', () => {
    const entries = [];
    const sink = { write: (entry) => entries.push(entry) };
    const parent = new Logger({ level: 'info', sink });
    const child = parent.child({ requestId: '123' });

    child.info('test');
    assert.equal(entries[0].requestId, '123');
  });

  it('child() merges data with default fields', () => {
    const entries = [];
    const sink = { write: (entry) => entries.push(entry) };
    const parent = new Logger({ level: 'info', sink });
    const child = parent.child({ component: 'auth' });

    child.info('login', { userId: 42 });
    assert.equal(entries[0].component, 'auth');
    assert.equal(entries[0].userId, 42);
  });
});
