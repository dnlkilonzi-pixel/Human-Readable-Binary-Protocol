'use strict';

/**
 * HRBP Streaming / Incremental Decoder
 *
 * Decodes a continuous stream of HRBP values arriving in arbitrary chunks
 * (e.g. from a TCP socket).  Values may be split across chunks; the decoder
 * buffers incomplete data and emits each complete value as soon as it arrives.
 *
 * Usage:
 *
 *   const { StreamDecoder } = require('./stream');
 *
 *   const decoder = new StreamDecoder();
 *
 *   decoder.on('data',  (value) => console.log('decoded:', value));
 *   decoder.on('error', (err)   => console.error('stream error:', err));
 *   decoder.on('end',   ()      => console.log('stream ended'));
 *
 *   socket.on('data', (chunk) => decoder.write(chunk));
 *   socket.on('end',  ()      => decoder.end());
 *
 * Events
 * ──────
 * 'data'  – emitted with each successfully decoded value.
 * 'error' – emitted when an unknown/invalid tag is encountered or when
 *            end() is called with unconsumed bytes in the buffer.
 * 'end'   – emitted by end() after all buffered data has been drained.
 */

const { EventEmitter } = require('events');
const { decodeAt, IncompleteBufferError } = require('./decoder');

class StreamDecoder extends EventEmitter {
  constructor() {
    super();
    this._buf = Buffer.alloc(0);
  }

  /**
   * Feed a new chunk of bytes into the decoder.
   *
   * @param {Buffer|Uint8Array|string} chunk
   * @returns {this}
   */
  write(chunk) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this._buf = Buffer.concat([this._buf, buf]);
    this._drain();
    return this;
  }

  /**
   * Signal that no more data will arrive.  Any remaining complete values are
   * drained and 'end' is emitted.  If unconsumed bytes remain in the buffer,
   * an 'error' is emitted before 'end'.
   *
   * @returns {this}
   */
  end() {
    this._drain();
    if (this._buf.length > 0) {
      this.emit(
        'error',
        new IncompleteBufferError(
          `Stream ended with ${this._buf.length} unconsumed byte(s)`
        )
      );
    }
    this.emit('end');
    return this;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  _drain() {
    let offset = 0;
    while (offset < this._buf.length) {
      try {
        const { value, nextOffset } = decodeAt(this._buf, offset);
        this.emit('data', value);
        offset = nextOffset;
      } catch (e) {
        if (e instanceof IncompleteBufferError) {
          // Not enough data yet — keep remaining bytes and wait for more.
          break;
        }
        // Malformed data (unknown tag, etc.) — emit error and stop.
        this.emit('error', e);
        // Discard the entire buffer to avoid re-processing bad data.
        this._buf = Buffer.alloc(0);
        return;
      }
    }
    // Discard fully consumed bytes from the front of the buffer.
    this._buf = offset > 0 ? this._buf.slice(offset) : this._buf;
  }
}

module.exports = { StreamDecoder };
