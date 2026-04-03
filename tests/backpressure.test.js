'use strict';

/**
 * Tests for HRBP Backpressure / Flow Control
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('stream');
const { BackpressureController, DEFAULT_HIGH_WATER_MARK, DEFAULT_MAX_MESSAGE_SIZE } = require('../src/backpressure');

describe('BackpressureController', () => {
  it('exposes default constants', () => {
    assert.equal(DEFAULT_HIGH_WATER_MARK, 64 * 1024);
    assert.equal(DEFAULT_MAX_MESSAGE_SIZE, 16 * 1024 * 1024);
  });

  it('write() returns true when stream is not full', () => {
    const stream = new PassThrough({ highWaterMark: 1024 });
    const bp = new BackpressureController(stream);
    const ok = bp.write(Buffer.alloc(10));
    assert.equal(ok, true);
    stream.destroy();
  });

  it('throws RangeError when message exceeds maxMessageSize', () => {
    const stream = new PassThrough();
    const bp = new BackpressureController(stream, { maxMessageSize: 100 });
    assert.throws(
      () => bp.write(Buffer.alloc(200)),
      (e) => e instanceof RangeError && /exceeds maxMessageSize/.test(e.message)
    );
    stream.destroy();
  });

  it('isPaused starts as false', () => {
    const stream = new PassThrough();
    const bp = new BackpressureController(stream);
    assert.equal(bp.isPaused, false);
    stream.destroy();
  });

  it('bufferedAmount returns the stream writableLength', () => {
    const stream = new PassThrough({ highWaterMark: 16 });
    const bp = new BackpressureController(stream);
    bp.write(Buffer.alloc(5));
    assert.equal(typeof bp.bufferedAmount, 'number');
    stream.destroy();
  });

  it('emits backpressure event when write returns false', (_, done) => {
    // Use a very low highWaterMark so the internal buffer fills quickly
    const stream = new PassThrough({ highWaterMark: 1 });

    // Pause the readable side so data accumulates
    stream.pause();

    const bp = new BackpressureController(stream);

    bp.on('backpressure', (info) => {
      assert.ok(info.buffered !== undefined);
      assert.ok(info.highWaterMark !== undefined);
      stream.destroy();
      done();
    });

    // Write enough to trigger backpressure
    for (let i = 0; i < 100; i++) {
      const ok = bp.write(Buffer.alloc(64));
      if (!ok) break;
    }
  });

  it('emits drain event after backpressure clears', (_, done) => {
    const stream = new PassThrough({ highWaterMark: 1 });
    stream.pause();
    const bp = new BackpressureController(stream);

    bp.on('drain', () => {
      assert.equal(bp.isPaused, false);
      stream.destroy();
      done();
    });

    // Fill the buffer
    for (let i = 0; i < 100; i++) {
      bp.write(Buffer.alloc(64));
    }

    // Resume reading to trigger drain
    stream.resume();
  });

  it('on/once/removeListener work correctly', () => {
    const stream = new PassThrough();
    const bp = new BackpressureController(stream);
    let called = 0;

    const fn = () => { called++; };
    bp.on('drain', fn);
    bp._emit('drain');
    assert.equal(called, 1);

    bp.removeListener('drain', fn);
    bp._emit('drain');
    assert.equal(called, 1); // should not fire again

    // once
    let onceCalled = 0;
    bp.once('drain', () => { onceCalled++; });
    bp._emit('drain');
    bp._emit('drain');
    assert.equal(onceCalled, 1);

    stream.destroy();
  });
});
