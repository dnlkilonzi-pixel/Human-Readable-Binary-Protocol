'use strict';

/**
 * MessagePack ↔ HRBP interoperability bridge.
 *
 * Provides a lightweight two-way adapter between MessagePack-encoded data and
 * HRBP-encoded data via a plain JavaScript object as the intermediate form.
 *
 * ## Dependency
 *
 * This module does NOT hard-require a MessagePack library at package install
 * time.  You must provide a codec object that conforms to the `MsgpackCodec`
 * interface (see below).  Any of the following popular libraries work:
 *
 *   - `@msgpack/msgpack`   (recommended — tree-shakeable, WASM-free)
 *   - `msgpack-lite`
 *   - `msgpack5`
 *
 * ## Usage — with @msgpack/msgpack
 *
 *   const msgpack = require('@msgpack/msgpack');
 *   const { createMsgpackBridge } = require('human-readable-binary-protocol');
 *
 *   const bridge = createMsgpackBridge(msgpack);
 *
 *   // MessagePack Buffer → HRBP Buffer
 *   const mpBuf = msgpack.encode({ hello: 'world' });
 *   const hrbpBuf = bridge.msgpackToHRBP(mpBuf);
 *
 *   // HRBP Buffer → MessagePack Buffer
 *   const mpBuf2 = bridge.hrbpToMsgpack(hrbpBuf);
 *
 * ## Usage — without a runtime dependency (adapter-only mode)
 *
 * If you already have the decoded JS value you can convert directly:
 *
 *   const { msgpackValueToHRBP, hrbpToMsgpackValue } = require('human-readable-binary-protocol');
 *
 *   const hrbpBuf = msgpackValueToHRBP({ hello: 'world' });
 *   const value   = hrbpToMsgpackValue(hrbpBuf);
 */

const { encode } = require('../encoder');
const { decode } = require('../decoder');

// ---------------------------------------------------------------------------
// Codec-free helpers (JS value ↔ HRBP)
// ---------------------------------------------------------------------------

/**
 * Encode a plain JS value (already decoded from MessagePack) into HRBP.
 *
 * @param {*} value  Any value supported by the HRBP encoder.
 * @returns {Buffer}
 */
function msgpackValueToHRBP(value) {
  return encode(normaliseUint8Arrays(value));
}

/**
 * Decode an HRBP buffer into a plain JS value suitable for MessagePack
 * re-encoding.
 *
 * @param {Buffer} buffer
 * @returns {*}
 * @throws {TypeError}   If `buffer` is not a Buffer.
 * @throws {RangeError}  If the HRBP data is malformed.
 */
function hrbpToMsgpackValue(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError('hrbpToMsgpackValue: first argument must be a Buffer');
  }
  return decode(buffer);
}

// ---------------------------------------------------------------------------
// Full bridge (requires a msgpack codec at runtime)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} MsgpackCodec
 * @property {function(*): Buffer|Uint8Array} encode  Encodes a JS value.
 * @property {function(Buffer|Uint8Array): *} decode  Decodes a msgpack buffer.
 */

/**
 * Create a two-way bridge between MessagePack and HRBP.
 *
 * @param {MsgpackCodec} codec  A msgpack codec (e.g. `require('@msgpack/msgpack')`).
 * @returns {{ msgpackToHRBP: function(Buffer|Uint8Array): Buffer,
 *             hrbpToMsgpack: function(Buffer): Buffer|Uint8Array }}
 * @throws {TypeError}  If `codec` does not expose `encode` and `decode`.
 */
function createMsgpackBridge(codec) {
  if (!codec || typeof codec.encode !== 'function' || typeof codec.decode !== 'function') {
    throw new TypeError(
      'createMsgpackBridge: codec must expose encode(value) and decode(buffer) functions'
    );
  }

  /**
   * Convert a MessagePack-encoded buffer to HRBP.
   *
   * @param {Buffer|Uint8Array} mpBuffer
   * @returns {Buffer}
   */
  function msgpackToHRBP(mpBuffer) {
    let value;
    try {
      value = codec.decode(mpBuffer);
    } catch (err) {
      throw new RangeError(`msgpackToHRBP: failed to decode MessagePack data — ${err.message}`);
    }
    // Normalise Uint8Array payloads from msgpack into Node Buffers so HRBP
    // encodes them as BUFFER type rather than as an array of integers.
    value = normaliseUint8Arrays(value);
    return encode(value);
  }

  /**
   * Convert an HRBP-encoded buffer to MessagePack.
   *
   * @param {Buffer} hrbpBuffer
   * @returns {Buffer|Uint8Array}
   */
  function hrbpToMsgpack(hrbpBuffer) {
    if (!Buffer.isBuffer(hrbpBuffer)) {
      throw new TypeError('hrbpToMsgpack: first argument must be a Buffer');
    }
    const value = decode(hrbpBuffer);
    return codec.encode(value);
  }

  return { msgpackToHRBP, hrbpToMsgpack };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Recursively convert Uint8Array instances to Node.js Buffers so that the
 * HRBP encoder treats them as binary BUFFER values rather than arrays.
 */
function normaliseUint8Arrays(value) {
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  if (Array.isArray(value)) {
    return value.map(normaliseUint8Arrays);
  }
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = normaliseUint8Arrays(v);
    }
    return out;
  }
  return value;
}

module.exports = {
  msgpackValueToHRBP,
  hrbpToMsgpackValue,
  createMsgpackBridge,
};
