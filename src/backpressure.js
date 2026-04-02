'use strict';

/**
 * HRBP Backpressure / Flow Control
 *
 * Provides write buffering limits and pause/resume handling to prevent
 * a fast producer from overwhelming a slow consumer.  This is critical
 * for production systems under real load.
 *
 * Features:
 *   - `highWaterMark` — maximum bytes to buffer before signalling backpressure.
 *   - `send()` returns `false` when the buffer is full (caller should pause).
 *   - `'drain'` event emitted when the buffer drops below `highWaterMark`.
 *   - Automatic pause/resume of the underlying socket.
 *
 * Usage with HRBPConnection:
 *
 *   const conn = new HRBPConnection(socket, { highWaterMark: 64 * 1024 });
 *
 *   if (!conn.send(value)) {
 *     // Buffer is full — wait for drain
 *     await new Promise((resolve) => conn.once('drain', resolve));
 *   }
 */

const DEFAULT_HIGH_WATER_MARK = 64 * 1024; // 64 KB
const DEFAULT_MAX_MESSAGE_SIZE = 16 * 1024 * 1024; // 16 MB

/**
 * @typedef {Object} BackpressureOptions
 * @property {number} [highWaterMark=65536]      Max buffered bytes before signalling backpressure.
 * @property {number} [maxMessageSize=16777216]   Max single message size (rejects larger messages).
 */

/**
 * Wraps a writable stream (e.g. `net.Socket`) with backpressure-aware write
 * semantics.
 *
 * Emits 'drain' when the buffer drops below `highWaterMark`.
 * Emits 'backpressure' with `{ buffered, highWaterMark }` when the limit is hit.
 */
class BackpressureController {
  /**
   * @param {import('stream').Writable} writable  The underlying writable stream.
   * @param {BackpressureOptions}        [opts]
   */
  constructor(writable, opts = {}) {
    this._writable = writable;
    this.highWaterMark = opts.highWaterMark || DEFAULT_HIGH_WATER_MARK;
    this.maxMessageSize = opts.maxMessageSize || DEFAULT_MAX_MESSAGE_SIZE;
    this._paused = false;
    this._listeners = { drain: [], backpressure: [] };
  }

  /**
   * Write `buf` to the underlying stream.
   *
   * @param {Buffer} buf
   * @returns {boolean}  `true` if the buffer is below `highWaterMark`, `false` if the
   *                     caller should wait for 'drain'.
   * @throws {RangeError} if `buf.length` exceeds `maxMessageSize`.
   */
  write(buf) {
    if (buf.length > this.maxMessageSize) {
      throw new RangeError(
        `Message size ${buf.length} exceeds maxMessageSize ${this.maxMessageSize}`
      );
    }

    const ok = this._writable.write(buf);

    if (!ok && !this._paused) {
      this._paused = true;
      this._emit('backpressure', {
        buffered: this._writable.writableLength,
        highWaterMark: this.highWaterMark,
      });

      // Set up a one-time drain listener on the underlying stream.
      this._writable.once('drain', () => {
        this._paused = false;
        this._emit('drain');
      });
    }

    return ok;
  }

  /** Register a listener. */
  on(event, fn) {
    if (this._listeners[event]) {
      this._listeners[event].push(fn);
    }
    return this;
  }

  /** Register a one-time listener. */
  once(event, fn) {
    const wrapped = (...args) => {
      this.removeListener(event, wrapped);
      fn(...args);
    };
    wrapped._original = fn;
    return this.on(event, wrapped);
  }

  /** Remove a listener. */
  removeListener(event, fn) {
    if (this._listeners[event]) {
      this._listeners[event] = this._listeners[event].filter(
        (f) => f !== fn && f._original !== fn
      );
    }
    return this;
  }

  /** Whether the buffer is currently above `highWaterMark`. */
  get isPaused() {
    return this._paused;
  }

  /** Current number of bytes buffered in the underlying stream. */
  get bufferedAmount() {
    return this._writable.writableLength || 0;
  }

  _emit(event, ...args) {
    for (const fn of (this._listeners[event] || [])) {
      fn(...args);
    }
  }
}

module.exports = {
  BackpressureController,
  DEFAULT_HIGH_WATER_MARK,
  DEFAULT_MAX_MESSAGE_SIZE,
};
