'use strict';

/**
 * HRBP (Human-Readable Binary Protocol) type tags.
 *
 * Each tag is a single printable ASCII byte, making binary dumps visually
 * interpretable without any tooling.
 *
 * Wire format per value:
 *   [1-byte type tag] [payload bytes (type-specific)]
 *
 * | Tag | Hex  | JS type   | Payload                                      |
 * |-----|------|-----------|----------------------------------------------|
 * |  I  | 0x49 | number    | 4-byte big-endian int32                      |
 * |  F  | 0x46 | number    | 8-byte IEEE 754 float64 (big-endian)         |
 * |  S  | 0x53 | string    | 4-byte uint32 length + UTF-8 bytes           |
 * |  T  | 0x54 | true      | (no payload)                                 |
 * |  X  | 0x58 | false     | (no payload)                                 |
 * |  N  | 0x4E | null      | (no payload)                                 |
 * |  [  | 0x5B | Array     | 4-byte uint32 element count + elements       |
 * |  {  | 0x7B | Object    | 4-byte uint32 pair count + key-value pairs   |
 * |  B  | 0x42 | Buffer    | 4-byte uint32 byte length + raw bytes        |
 * |  H  | 0x48 | (header)  | 1-byte protocol version (versioned frames)   |
 */
const TAG = Object.freeze({
  INT32:  0x49, // 'I'
  FLOAT:  0x46, // 'F'
  STRING: 0x53, // 'S'
  TRUE:   0x54, // 'T'
  FALSE:  0x58, // 'X'
  NULL:   0x4E, // 'N'
  ARRAY:  0x5B, // '['
  OBJECT: 0x7B, // '{'
  BUFFER: 0x42, // 'B'
  HEADER: 0x48, // 'H'
});

/** Reverse map: byte value → tag name (for error messages and inspection). */
const TAG_NAME = Object.freeze(
  Object.fromEntries(Object.entries(TAG).map(([name, byte]) => [byte, name]))
);

module.exports = { TAG, TAG_NAME };
