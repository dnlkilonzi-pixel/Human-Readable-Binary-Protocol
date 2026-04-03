'use strict';

/**
 * HRBP Compression Layer
 *
 * Provides optional gzip compression on top of the HRBP wire format using
 * Node.js's built-in `zlib` module.  No external dependencies are required.
 *
 * Use-cases:
 *   - Reducing bandwidth over network connections
 *   - Shrinking log files that store many HRBP frames
 *   - Any scenario where repeated structure or strings dominate the payload
 *
 * The synchronous API mirrors the rest of the HRBP library for consistency.
 */

const zlib = require('zlib');
const { encode } = require('./encoder');
const { decode } = require('./decoder');

// Default gzip options — level 6 balances speed vs. size.
const DEFAULT_OPTIONS = { level: zlib.constants.Z_DEFAULT_COMPRESSION };

// ---------------------------------------------------------------------------
// Low-level compress / decompress
// ---------------------------------------------------------------------------

/**
 * Gzip-compress a Buffer.
 *
 * @param {Buffer} buffer
 * @param {object} [options]  Options forwarded to `zlib.gzipSync`.
 * @returns {Buffer}
 */
function compress(buffer, options = DEFAULT_OPTIONS) {
  return zlib.gzipSync(buffer, options);
}

/**
 * Gunzip-decompress a Buffer produced by {@link compress}.
 *
 * @param {Buffer} buffer
 * @returns {Buffer}
 */
function decompress(buffer) {
  return zlib.gunzipSync(buffer);
}

// ---------------------------------------------------------------------------
// Convenience encode / decode wrappers
// ---------------------------------------------------------------------------

/**
 * Encode a JavaScript value and then gzip-compress the result.
 *
 * @param {*}      value
 * @param {object} [options]  Options forwarded to `zlib.gzipSync`.
 * @returns {Buffer}  Compressed HRBP payload.
 */
function encodeCompressed(value, options = DEFAULT_OPTIONS) {
  return compress(encode(value), options);
}

/**
 * Decompress a buffer produced by {@link encodeCompressed} and decode it.
 *
 * @param {Buffer} buffer  Gzip-compressed HRBP payload.
 * @returns {*}  The decoded JavaScript value.
 */
function decodeCompressed(buffer) {
  return decode(decompress(buffer));
}

module.exports = { compress, decompress, encodeCompressed, decodeCompressed };
