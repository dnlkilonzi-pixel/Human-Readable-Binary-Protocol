'use strict';

/**
 * Protobuf ↔ HRBP (partial) interoperability bridge.
 *
 * ## Scope and limitations
 *
 * Protobuf uses a compiled schema (`.proto` file) to define message types,
 * whereas HRBP is self-describing.  A full, lossless bridge is therefore
 * impossible without schema information.
 *
 * This bridge implements a **plain-object conversion boundary**: it converts
 * between HRBP-encoded Buffers and the plain JavaScript objects that popular
 * Protobuf libraries (protobufjs, google-protobuf) expose after decoding.
 *
 * ### Supported conversions (via plain-object boundary)
 * | Protobuf type      | HRBP type | Notes                                    |
 * |--------------------|-----------|------------------------------------------|
 * | string             | STRING    | Lossless                                 |
 * | bool               | TRUE/FALSE| Lossless                                 |
 * | int32 / sint32     | INT32     | Lossless within [-2³¹, 2³¹−1]           |
 * | double / float     | FLOAT     | float loses precision vs HRBP float64    |
 * | bytes              | BUFFER    | Lossless (Uint8Array → Buffer)           |
 * | repeated fields    | ARRAY     | Lossless                                 |
 * | message (nested)   | OBJECT    | Keys are field names (strings)           |
 * | int64 / uint64     | FLOAT     | JS represents these as numbers; may lose |
 * |                    |           | precision for values > 2⁵³               |
 *
 * ### NOT supported
 * - Protobuf enums (values arrive as integers — encoded as INT32)
 * - `oneof` semantics are not preserved (just the set field is present)
 * - Unknown fields from the Protobuf wire are dropped before this bridge sees them
 * - Proto3 default-value omission (absent optional fields appear as undefined/null)
 *
 * ## Usage — with protobufjs
 *
 *   const protobuf = require('protobufjs');
 *   const { protobufValueToHRBP, hrbpToProtobufValue } = require('human-readable-binary-protocol');
 *
 *   const root = await protobuf.load('my_schema.proto');
 *   const MyMessage = root.lookupType('MyMessage');
 *
 *   // Protobuf-decoded object → HRBP
 *   const msg = MyMessage.decode(protoBytes);
 *   const hrbpBuf = protobufValueToHRBP(msg.toObject());
 *
 *   // HRBP → plain object (ready for MyMessage.fromObject)
 *   const obj = hrbpToProtobufValue(hrbpBuf);
 *   const msg2 = MyMessage.fromObject(obj);
 *
 * ## Usage — with google-protobuf (JS generated code)
 *
 *   const { MyMessage } = require('./my_message_pb');
 *   const { protobufValueToHRBP, hrbpToProtobufValue } = require('human-readable-binary-protocol');
 *
 *   const msg = MyMessage.deserializeBinary(protoBytes);
 *   const hrbpBuf = protobufValueToHRBP(msg.toObject());
 *
 *   const obj = hrbpToProtobufValue(hrbpBuf);
 *   // Reconstruct: const msg2 = MyMessage.fromObject(obj); (protobufjs) or
 *   // use your generated setters.
 */

const { encode } = require('../encoder');
const { decode } = require('../decoder');

// ---------------------------------------------------------------------------
// Value-level converters (no protobuf dependency required at import time)
// ---------------------------------------------------------------------------

/**
 * Convert a plain JS object (already decoded from a Protobuf message via
 * `.toObject()`) into an HRBP-encoded Buffer.
 *
 * Uint8Array instances (Protobuf `bytes` fields) are converted to Buffers so
 * they are encoded as HRBP BUFFER values rather than arrays.
 *
 * @param {*} value  The plain-object representation of a Protobuf message.
 * @returns {Buffer}
 */
function protobufValueToHRBP(value) {
  const normalised = normaliseProtobufValue(value);
  return encode(normalised);
}

/**
 * Convert an HRBP-encoded Buffer back into a plain JS object suitable for
 * passing to a Protobuf library's `fromObject()` method.
 *
 * Note: HRBP BUFFER values are returned as Node.js Buffer instances.  If your
 * Protobuf library expects Uint8Array for `bytes` fields, convert with
 * `new Uint8Array(buf)`.
 *
 * @param {Buffer} buffer  A valid HRBP-encoded buffer.
 * @returns {*}
 * @throws {TypeError}   If `buffer` is not a Buffer.
 * @throws {RangeError}  If the HRBP data is malformed.
 */
function hrbpToProtobufValue(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError('hrbpToProtobufValue: first argument must be a Buffer');
  }
  return decode(buffer);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Recursively normalise a Protobuf plain-object for HRBP encoding:
 *  - Uint8Array  →  Buffer  (so HRBP encodes as BUFFER, not ARRAY)
 *  - Long / bigint (from some protobuf libs)  →  Number (precision caveat)
 *  - Everything else passes through as-is.
 */
function normaliseProtobufValue(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  // Handle Long objects from protobufjs (they have a toNumber() method)
  if (
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof value.toNumber === 'function' &&
    typeof value.low === 'number' &&
    typeof value.high === 'number'
  ) {
    return value.toNumber();
  }
  if (typeof value === 'bigint') {
    // Precision caveat applies for values > 2^53
    return Number(value);
  }
  if (Array.isArray(value)) {
    return value.map(normaliseProtobufValue);
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = normaliseProtobufValue(v);
    }
    return out;
  }
  return value;
}

module.exports = {
  protobufValueToHRBP,
  hrbpToProtobufValue,
};
