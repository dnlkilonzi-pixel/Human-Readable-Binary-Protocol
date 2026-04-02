'use strict';

/**
 * HRBP Encoder / Serializer
 *
 * Converts JavaScript values into the Human-Readable Binary Protocol wire
 * format.  The resulting Buffer can be sent over a socket, stored to disk, or
 * printed as a hex dump — and the printable ASCII type tags will remain
 * visible.
 *
 * Supported JS → HRBP mappings:
 *   null / undefined  →  NULL  (N)
 *   boolean true      →  TRUE  (T)
 *   boolean false     →  FALSE (X)
 *   integer number    →  INT32 (I)   – must fit in [-2^31, 2^31-1]
 *   float number      →  FLOAT (F)
 *   string            →  STRING (S)
 *   Buffer            →  BUFFER (B)
 *   Array             →  ARRAY ([)
 *   plain Object      →  OBJECT ({)
 */

const { TAG } = require('./types');

const INT32_MIN = -2147483648;
const INT32_MAX =  2147483647;

/**
 * Encode a single JavaScript value into an HRBP Buffer.
 *
 * @param {*} value
 * @returns {Buffer}
 */
function encode(value) {
  if (value === null || value === undefined) {
    return encodeNull();
  }
  if (typeof value === 'boolean') {
    return encodeBoolean(value);
  }
  if (typeof value === 'number') {
    return encodeNumber(value);
  }
  if (typeof value === 'string') {
    return encodeString(value);
  }
  if (Buffer.isBuffer(value)) {
    return encodeBuffer(value);
  }
  if (Array.isArray(value)) {
    return encodeArray(value);
  }
  if (typeof value === 'object') {
    return encodeObject(value);
  }
  throw new TypeError(`Cannot encode value of type "${typeof value}"`);
}

// ---------------------------------------------------------------------------
// Per-type helpers
// ---------------------------------------------------------------------------

function encodeNull() {
  return Buffer.from([TAG.NULL]);
}

function encodeBoolean(value) {
  return Buffer.from([value ? TAG.TRUE : TAG.FALSE]);
}

function encodeNumber(value) {
  if (Number.isInteger(value) && value >= INT32_MIN && value <= INT32_MAX) {
    const buf = Buffer.allocUnsafe(5);
    buf[0] = TAG.INT32;
    buf.writeInt32BE(value, 1);
    return buf;
  }
  // Fall back to float64 for non-integer numbers or integers outside int32 range.
  const buf = Buffer.allocUnsafe(9);
  buf[0] = TAG.FLOAT;
  buf.writeDoubleBE(value, 1);
  return buf;
}

function encodeString(value) {
  const strBytes = Buffer.from(value, 'utf8');
  const buf = Buffer.allocUnsafe(5 + strBytes.length);
  buf[0] = TAG.STRING;
  buf.writeUInt32BE(strBytes.length, 1);
  strBytes.copy(buf, 5);
  return buf;
}

function encodeBuffer(value) {
  const buf = Buffer.allocUnsafe(5 + value.length);
  buf[0] = TAG.BUFFER;
  buf.writeUInt32BE(value.length, 1);
  value.copy(buf, 5);
  return buf;
}

function encodeArray(value) {
  const encodedElements = value.map(encode);
  const totalPayload = encodedElements.reduce((sum, b) => sum + b.length, 0);

  // [TAG] [4-byte count] [elements...]
  const buf = Buffer.allocUnsafe(5 + totalPayload);
  buf[0] = TAG.ARRAY;
  buf.writeUInt32BE(value.length, 1);
  let offset = 5;
  for (const el of encodedElements) {
    el.copy(buf, offset);
    offset += el.length;
  }
  return buf;
}

function encodeObject(value) {
  const keys = Object.keys(value);
  const encodedPairs = keys.map((k) => Buffer.concat([encodeString(k), encode(value[k])]));
  const totalPayload = encodedPairs.reduce((sum, b) => sum + b.length, 0);

  // [TAG] [4-byte pair count] [key-value pairs...]
  const buf = Buffer.allocUnsafe(5 + totalPayload);
  buf[0] = TAG.OBJECT;
  buf.writeUInt32BE(keys.length, 1);
  let offset = 5;
  for (const pair of encodedPairs) {
    pair.copy(buf, offset);
    offset += pair.length;
  }
  return buf;
}

module.exports = { encode };
