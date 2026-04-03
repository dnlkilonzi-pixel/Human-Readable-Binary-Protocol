'use strict';

/**
 * HRBP TCP Framing
 *
 * TCP is a stream-oriented protocol with no concept of message boundaries.
 * This module implements a simple 4-byte length-prefix framing scheme:
 *
 *   [ uint32 length (4 bytes, big-endian) ] [ HRBP payload (length bytes) ]
 *
 * This lets a receiver reliably extract complete HRBP messages from an
 * arbitrary byte stream, even when packets are split or coalesced in transit.
 */

/**
 * Wrap an HRBP payload buffer in a length-prefixed frame.
 *
 * @param {Buffer} payload  Raw HRBP-encoded bytes.
 * @returns {Buffer}  4-byte big-endian length header + payload.
 */
function frameEncode(payload) {
  const frame = Buffer.allocUnsafe(4 + payload.length);
  frame.writeUInt32BE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

/**
 * Stateful frame decoder.  Feed arbitrary chunks via `push(chunk)`; completed
 * frames are returned from each call as an array of payload Buffers.
 *
 * Usage:
 *   const fd = new FrameDecoder();
 *   socket.on('data', (chunk) => {
 *     for (const payload of fd.push(chunk)) {
 *       // payload is one complete HRBP message
 *     }
 *   });
 */
class FrameDecoder {
  constructor() {
    this._buf = Buffer.alloc(0);
  }

  /**
   * Push a new chunk of bytes into the decoder.
   *
   * @param {Buffer} chunk
   * @returns {Buffer[]}  Zero or more complete HRBP payload buffers.
   */
  push(chunk) {
    this._buf = Buffer.concat([this._buf, chunk]);
    const frames = [];

    while (this._buf.length >= 4) {
      const payloadLen = this._buf.readUInt32BE(0);
      if (this._buf.length < 4 + payloadLen) {
        break; // wait for more bytes
      }
      frames.push(this._buf.slice(4, 4 + payloadLen));
      this._buf = this._buf.slice(4 + payloadLen);
    }

    return frames;
  }

  /** Reset internal buffer (e.g. after a connection drops). */
  reset() {
    this._buf = Buffer.alloc(0);
  }
}

module.exports = { frameEncode, FrameDecoder };
