'use strict';

/**
 * JSON ↔ HRBP interoperability bridge.
 *
 * Provides two-way conversion between JSON strings and HRBP-encoded Buffers.
 * This lets you move data between JSON-based systems and HRBP without
 * committing fully to the HRBP wire format.
 *
 * Usage:
 *
 *   const { jsonToHRBP, hrbpToJSON } = require('human-readable-binary-protocol');
 *
 *   const buf = jsonToHRBP('{"name":"Alice","age":30}');
 *   // buf is an HRBP-encoded Buffer
 *
 *   const json = hrbpToJSON(buf);
 *   // json => '{"name":"Alice","age":30}'
 *
 *   const pretty = hrbpToJSON(buf, true);
 *   // pretty => '{\n  "name": "Alice",\n  "age": 30\n}'
 */

const { encode } = require('../encoder');
const { decode } = require('../decoder');

/**
 * Convert a JSON string (or plain JS value) to an HRBP-encoded Buffer.
 *
 * @param {string|*} input  A JSON string or a JS value (object, array, primitive).
 *                          If a string is passed it is parsed as JSON first.
 * @returns {Buffer}  HRBP-encoded representation of the value.
 * @throws {SyntaxError}   If `input` is a string that is not valid JSON.
 * @throws {TypeError}     If the parsed value contains types that cannot be
 *                         encoded (e.g. functions after JSON parsing this won't
 *                         happen, but callers may pass arbitrary values).
 */
function jsonToHRBP(input) {
  let value;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch (err) {
      throw new SyntaxError(`jsonToHRBP: invalid JSON input — ${err.message}`);
    }
  } else {
    value = input;
  }
  return encode(value);
}

/**
 * Convert an HRBP-encoded Buffer to a JSON string.
 *
 * @param {Buffer} buffer  A valid HRBP-encoded buffer.
 * @param {boolean} [pretty=false]  When true, produces indented JSON output.
 * @returns {string}  JSON string representation.
 * @throws {RangeError}  If the buffer is malformed or truncated (propagated
 *                       from the HRBP decoder).
 * @throws {TypeError}   If `buffer` is not a Buffer.
 */
function hrbpToJSON(buffer, pretty = false) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError('hrbpToJSON: first argument must be a Buffer');
  }
  const value = decode(buffer);
  return pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
}

module.exports = { jsonToHRBP, hrbpToJSON };
