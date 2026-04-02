# Human-Readable Binary Protocol (HRBP)

A protocol that is **binary** (fast, compact) **and** human-readable / debuggable — combining the best of both worlds.

---

## The Problem

| Format | Speed | Readability |
|--------|-------|-------------|
| Pure binary (e.g. MessagePack) | ✅ Fast | ❌ Opaque hex dump |
| Pure text (e.g. JSON) | ❌ Slower | ✅ Readable |
| **HRBP** | ✅ Fast | ✅ Readable |

HRBP uses **printable ASCII characters as 1-byte type tags**.  The result is a
binary buffer where the *structure* is immediately visible in any hex dump,
without any special tooling.

---

## Wire Format

Every encoded value is a **type tag byte** followed by a type-specific payload:

| Tag char | Hex  | JS type          | Payload                                     |
|:--------:|------|------------------|---------------------------------------------|
| `I`      | 0x49 | integer number   | 4-byte big-endian int32                     |
| `F`      | 0x46 | float number     | 8-byte big-endian IEEE 754 float64          |
| `S`      | 0x53 | string           | 4-byte uint32 length + UTF-8 bytes          |
| `T`      | 0x54 | `true`           | *(no payload)*                              |
| `X`      | 0x58 | `false`          | *(no payload)*                              |
| `N`      | 0x4E | `null`           | *(no payload)*                              |
| `[`      | 0x5B | Array            | 4-byte uint32 element count + elements      |
| `{`      | 0x7B | Object           | 4-byte uint32 pair count + key-value pairs  |
| `B`      | 0x42 | Buffer           | 4-byte uint32 byte length + raw bytes       |

Numbers that are integers fitting in `[-2^31, 2^31-1]` are encoded as `I`
(4-byte int32).  All other numbers use `F` (8-byte float64).

Object keys are encoded as ordinary `S` (string) values, so the object layout
on the wire is:
```
{ [4-byte pair count] S[len][key1 bytes] [value1] S[len][key2 bytes] [value2] …
```

---

## Quick Start

```js
const { encode, decode, inspect, hexDump } = require('./src/index');

// Serialize a JavaScript value
const buf = encode({ name: 'Alice', age: 30, active: true });

// Deserialize back to JavaScript
const value = decode(buf);
// => { name: 'Alice', age: 30, active: true }

// Human-readable structural view
console.log(inspect(buf));
// { (3 pairs)
//   S(4) "name"
//     S(5) "Alice"
//   S(3) "age"
//     I 30
//   S(6) "active"
//     T true
// }

// Annotated hex dump (type tags appear as ASCII in the rightmost column)
console.log(hexDump(buf));
// 00000000  7b 00 00 00 03 53 00 00  00 04 6e 61 6d 65 53 00  |{....S....nameS.|
// 00000010  00 00 05 41 6c 69 63 65  53 00 00 00 03 61 67 65  |...AliceS....age|
// 00000020  49 00 00 00 1e 53 00 00  00 06 61 63 74 69 76 65  |I....S....active|
// 00000030  54                                                 |T|
```

---

## API

### `encode(value) → Buffer`

Encodes any supported JavaScript value into an HRBP `Buffer`.

Supported types: `null`, `undefined`, `boolean`, `number`, `string`, `Buffer`,
`Array`, and plain `Object`.  Throws `TypeError` for unsupported types (e.g.
`function`, `Symbol`).

### `decode(buffer) → value`

Decodes the first HRBP value from the start of `buffer` and returns the
corresponding JavaScript value.

Throws `RangeError` on a truncated or malformed buffer.

### `decodeAll(buffer) → value[]`

Decodes all HRBP values packed sequentially in `buffer` and returns them as an
array.  Useful for framed stream protocols.

### `inspect(buffer, [options]) → string`

Returns a multi-line human-readable text tree of the encoded buffer.

Options:
- `indent` (default `2`) — spaces per indentation level.

### `hexDump(buffer, [options]) → string`

Returns an annotated hex dump showing offsets, hex bytes, and a printable ASCII
column (where HRBP type tags appear as their ASCII characters).

Options:
- `bytesPerRow` (default `16`) — bytes displayed per row.

---

## Running Tests

```sh
npm test
```

The test suite (72 tests) uses Node.js's built-in `node:test` runner — no
extra dependencies required.

---

## Project Structure

```
src/
  types.js      – TAG constants and reverse TAG_NAME map
  encoder.js    – encode()  – JS value → Buffer
  decoder.js    – decode() / decodeAll()  – Buffer → JS value
  inspector.js  – inspect() / hexDump()  – Buffer → human-readable string
  index.js      – public API re-exports
tests/
  encoder.test.js
  decoder.test.js
  inspector.test.js
```
