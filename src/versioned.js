'use strict';

/**
 * HRBP Versioning Layer
 *
 * Wraps any HRBP payload in a one-byte framing header so that future protocol
 * versions can be identified and handled without breaking decoders.
 *
 * Wire format of a versioned frame:
 *
 *   [ 'H' (0x48) ] [ version (1 byte) ] [ HRBP payload ... ]
 *
 * The 'H' tag is a printable ASCII character and remains visible in hex dumps,
 * consistent with the HRBP design philosophy.
 */

const { encode } = require('./encoder');
const { decode } = require('./decoder');
const { TAG } = require('./types');

/** Current protocol version written by encodeVersioned(). */
const CURRENT_VERSION = 1;

/** Maximum version number that this decoder supports. */
const MAX_SUPPORTED_VERSION = 1;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encode `value` and prefix the result with the HRBP version header.
 *
 * @param {*}      value
 * @param {number} [version=CURRENT_VERSION]  Version byte to embed (0–255).
 * @returns {Buffer}  [ H ] [ version ] [ encoded payload ]
 */
function encodeVersioned(value, version = CURRENT_VERSION) {
  if (!Number.isInteger(version) || version < 0 || version > 255) {
    throw new RangeError(`Version must be an integer in [0, 255], got ${version}`);
  }
  const payload = encode(value);
  const buf = Buffer.allocUnsafe(2 + payload.length);
  buf[0] = TAG.HEADER;   // 'H'
  buf[1] = version;
  payload.copy(buf, 2);
  return buf;
}

/**
 * Decode a versioned HRBP frame.
 *
 * @param {Buffer} buffer  Must start with the 'H' header byte.
 * @returns {{ version: number, value: * }}
 * @throws {RangeError}  If the buffer is too short or lacks the 'H' header.
 * @throws {RangeError}  If the version is newer than MAX_SUPPORTED_VERSION.
 */
function decodeVersioned(buffer) {
  if (buffer.length < 2) {
    throw new RangeError(
      `Versioned frame too short: need at least 2 bytes, got ${buffer.length}`
    );
  }
  if (buffer[0] !== TAG.HEADER) {
    throw new RangeError(
      `Expected HEADER tag 0x${TAG.HEADER.toString(16).toUpperCase()} ('H'), ` +
      `got 0x${buffer[0].toString(16).toUpperCase()}`
    );
  }
  const version = buffer[1];
  if (version > MAX_SUPPORTED_VERSION) {
    throw new RangeError(
      `Unsupported protocol version ${version}; maximum supported is ${MAX_SUPPORTED_VERSION}`
    );
  }
  const value = decode(buffer.slice(2));
  return { version, value };
}

module.exports = { encodeVersioned, decodeVersioned, CURRENT_VERSION, MAX_SUPPORTED_VERSION };
