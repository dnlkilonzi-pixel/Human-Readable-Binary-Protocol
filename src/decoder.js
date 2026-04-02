'use strict';

/**
 * HRBP Decoder / Parser
 *
 * Converts an HRBP-encoded Buffer back into JavaScript values.
 *
 * The top-level export `decode(buffer)` reads the first complete value
 * starting at offset 0.  Use `decodeAll(buffer)` to read a sequence of
 * top-level values from the same buffer.
 */

const { TAG, TAG_NAME } = require('./types');

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Decode the first HRBP value found at the beginning of `buffer`.
 *
 * @param {Buffer} buffer
 * @returns {*}  The decoded JavaScript value.
 */
function decode(buffer) {
  const { value } = decodeAt(buffer, 0);
  return value;
}

/**
 * Decode all HRBP values packed sequentially in `buffer`.
 *
 * @param {Buffer} buffer
 * @returns {Array}  Array of decoded JavaScript values.
 */
function decodeAll(buffer) {
  const results = [];
  let offset = 0;
  while (offset < buffer.length) {
    const { value, nextOffset } = decodeAt(buffer, offset);
    results.push(value);
    offset = nextOffset;
  }
  return results;
}

// ---------------------------------------------------------------------------
// Internal recursive decoder
// ---------------------------------------------------------------------------

/**
 * Decode one value starting at `offset` inside `buffer`.
 *
 * @param {Buffer} buffer
 * @param {number} offset
 * @returns {{ value: *, nextOffset: number }}
 */
function decodeAt(buffer, offset) {
  assertBounds(buffer, offset, 1);
  const tag = buffer[offset];
  offset += 1;

  switch (tag) {
    case TAG.NULL:
      return { value: null, nextOffset: offset };

    case TAG.TRUE:
      return { value: true, nextOffset: offset };

    case TAG.FALSE:
      return { value: false, nextOffset: offset };

    case TAG.INT32: {
      assertBounds(buffer, offset, 4);
      const value = buffer.readInt32BE(offset);
      return { value, nextOffset: offset + 4 };
    }

    case TAG.FLOAT: {
      assertBounds(buffer, offset, 8);
      const value = buffer.readDoubleBE(offset);
      return { value, nextOffset: offset + 8 };
    }

    case TAG.STRING: {
      assertBounds(buffer, offset, 4);
      const len = buffer.readUInt32BE(offset);
      offset += 4;
      assertBounds(buffer, offset, len);
      const value = buffer.toString('utf8', offset, offset + len);
      return { value, nextOffset: offset + len };
    }

    case TAG.BUFFER: {
      assertBounds(buffer, offset, 4);
      const len = buffer.readUInt32BE(offset);
      offset += 4;
      assertBounds(buffer, offset, len);
      const value = buffer.slice(offset, offset + len);
      return { value, nextOffset: offset + len };
    }

    case TAG.ARRAY: {
      assertBounds(buffer, offset, 4);
      const count = buffer.readUInt32BE(offset);
      offset += 4;
      const value = [];
      for (let i = 0; i < count; i++) {
        const result = decodeAt(buffer, offset);
        value.push(result.value);
        offset = result.nextOffset;
      }
      return { value, nextOffset: offset };
    }

    case TAG.OBJECT: {
      assertBounds(buffer, offset, 4);
      const count = buffer.readUInt32BE(offset);
      offset += 4;
      const value = {};
      for (let i = 0; i < count; i++) {
        // Key is always a STRING (tag S included)
        const keyResult = decodeAt(buffer, offset);
        if (typeof keyResult.value !== 'string') {
          throw new TypeError(
            `Object key must be a STRING, got tag 0x${buffer[offset].toString(16).toUpperCase()}`
          );
        }
        offset = keyResult.nextOffset;
        const valResult = decodeAt(buffer, offset);
        value[keyResult.value] = valResult.value;
        offset = valResult.nextOffset;
      }
      return { value, nextOffset: offset };
    }

    default:
      throw new RangeError(
        `Unknown HRBP type tag 0x${tag.toString(16).toUpperCase()} at offset ${offset - 1}`
      );
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function assertBounds(buffer, offset, needed) {
  if (offset + needed > buffer.length) {
    throw new RangeError(
      `Buffer too short: need ${needed} byte(s) at offset ${offset}, ` +
      `but buffer length is ${buffer.length}`
    );
  }
}

module.exports = { decode, decodeAll };
