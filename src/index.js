'use strict';

/**
 * Human-Readable Binary Protocol (HRBP)
 *
 * A protocol that is simultaneously binary (fast, compact) and
 * human-readable/debuggable.
 *
 * Quick start:
 *
 *   const { encode, decode, inspect, hexDump } = require('human-readable-binary-protocol');
 *
 *   const buf = encode({ name: 'Alice', age: 30, active: true });
 *   // buf is a compact Buffer — but ASCII type tags ('S', 'I', 'T') are
 *   // visible in any hex dump.
 *
 *   const value = decode(buf);
 *   // value => { name: 'Alice', age: 30, active: true }
 *
 *   console.log(inspect(buf));
 *   // { (3 pairs)
 *   //   S(4) "name"
 *   //     S(5) "Alice"
 *   //   S(3) "age"
 *   //     I 30
 *   //   S(6) "active"
 *   //     T true
 *   // }
 *
 *   console.log(hexDump(buf));
 *   // 00000000  7b 00 00 00 03 53 00 00  00 04 6e 61 6d 65 53 00  |{....S....nameS.|
 *   // ...
 */

const { encode } = require('./encoder');
const { decode, decodeAll, IncompleteBufferError } = require('./decoder');
const { inspect, hexDump } = require('./inspector');
const { TAG, TAG_NAME } = require('./types');
const { validate, encodeWithSchema, decodeWithSchema } = require('./schema');
const { encodeVersioned, decodeVersioned, CURRENT_VERSION, MAX_SUPPORTED_VERSION } = require('./versioned');
const { compress, decompress, encodeCompressed, decodeCompressed } = require('./compress');
const { StreamDecoder } = require('./stream');

module.exports = {
  // Core
  encode, decode, decodeAll,
  // Inspection
  inspect, hexDump,
  // Constants
  TAG, TAG_NAME,
  // Schema layer
  validate, encodeWithSchema, decodeWithSchema,
  // Versioning
  encodeVersioned, decodeVersioned, CURRENT_VERSION, MAX_SUPPORTED_VERSION,
  // Compression
  compress, decompress, encodeCompressed, decodeCompressed,
  // Streaming
  StreamDecoder,
  // Error types
  IncompleteBufferError,
};
