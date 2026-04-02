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
| `H`      | 0x48 | *(version frame)*| 1-byte version + HRBP payload               |

Numbers that are integers fitting in `[-2^31, 2^31-1]` are encoded as `I`
(4-byte int32).  All other numbers use `F` (8-byte float64).

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

### Core

#### `encode(value) → Buffer`

Encodes any supported JavaScript value into an HRBP `Buffer`.

Supported types: `null`, `undefined`, `boolean`, `number`, `string`, `Buffer`,
`Array`, and plain `Object`.  Throws `TypeError` for unsupported types (e.g.
`function`, `Symbol`).

#### `decode(buffer) → value`

Decodes the first HRBP value from the start of `buffer` and returns the
corresponding JavaScript value.

Throws `RangeError` (or `IncompleteBufferError`) on a truncated or malformed buffer.

#### `decodeAll(buffer) → value[]`

Decodes all HRBP values packed sequentially in `buffer` and returns them as an
array.  Useful for framed stream protocols.

### Inspection

#### `inspect(buffer, [options]) → string`

Returns a multi-line human-readable text tree of the encoded buffer.

Options:
- `indent` (default `2`) — spaces per indentation level.

#### `hexDump(buffer, [options]) → string`

Returns an annotated hex dump showing offsets, hex bytes, and a printable ASCII
column (where HRBP type tags appear as their ASCII characters).

Options:
- `bytesPerRow` (default `16`) — bytes displayed per row.

---

## Schema Layer

Optionally validate values against a schema before encoding and after decoding,
adding type-safety and contract enforcement.

```js
const { validate, encodeWithSchema, decodeWithSchema } = require('./src/index');

const userSchema = {
  type: 'object',
  fields: { id: 'int', name: 'string' },
};

// Validation only
validate({ id: 1, name: 'Alice' }, userSchema); // passes silently
validate({ id: 1.5, name: 'Alice' }, userSchema); // throws TypeError

// Schema-aware encode / decode
const buf = encodeWithSchema({ id: 7, name: 'Bob' }, userSchema);
const user = decodeWithSchema(buf, userSchema);
// => { id: 7, name: 'Bob' }
```

**Supported schema types:**

| Schema | Matches |
|--------|---------|
| `'int'` | `Number.isInteger(value)` |
| `'float'` / `'number'` | any `number` |
| `'string'` | string |
| `'boolean'` | boolean |
| `'null'` | `null` |
| `'buffer'` | `Buffer` |
| `{ type: 'array', items: <schema> }` | Array whose elements each match `items` |
| `{ type: 'object', fields: { … }, required: […] }` | Object with validated fields |

### API

#### `validate(value, schema, [path])`
Throws `TypeError` if `value` does not conform to `schema`.

#### `encodeWithSchema(value, schema) → Buffer`
Validates then encodes.  Throws before touching the encoder if validation fails.

#### `decodeWithSchema(buffer, schema) → value`
Decodes then validates.  Throws after decoding if the result fails the schema.

---

## Versioning

Wrap any payload in a one-byte version header so future protocol changes can
be detected without breaking existing decoders.

Wire format: `[ 'H' (0x48) ] [ version byte ] [ HRBP payload ]`

```js
const { encodeVersioned, decodeVersioned, CURRENT_VERSION } = require('./src/index');

const buf = encodeVersioned({ event: 'login', userId: 42 });
// buf[0] === 0x48  ('H' — visible in hex dumps)
// buf[1] === 1     (version)

const { version, value } = decodeVersioned(buf);
// version => 1
// value   => { event: 'login', userId: 42 }
```

### API

#### `encodeVersioned(value, [version=1]) → Buffer`
Encodes `value` and prefixes the result with `H` + version byte.

#### `decodeVersioned(buffer) → { version, value }`
Validates the `H` header, rejects unsupported future versions, and decodes the payload.

#### `CURRENT_VERSION` / `MAX_SUPPORTED_VERSION`
Constants exported for external version negotiation.

---

## Compression

Optionally gzip the wire payload using Node.js's built-in `zlib` — no extra
dependencies.  Especially effective for:

- Network transmission of large or repetitive messages
- Log files that store thousands of HRBP frames

```js
const { encodeCompressed, decodeCompressed, compress, decompress } = require('./src/index');

// Encode + compress in one step
const buf = encodeCompressed({ tags: Array(100).fill('active') });
const value = decodeCompressed(buf);

// Low-level compress/decompress for raw buffers
const raw   = compress(Buffer.from('hello'));
const back  = decompress(raw);
```

### API

#### `encodeCompressed(value, [options]) → Buffer`
Encodes then gzip-compresses.  `options` are forwarded to `zlib.gzipSync`.

#### `decodeCompressed(buffer) → value`
Gunzip-decompresses then decodes.

#### `compress(buffer, [options]) → Buffer`
Raw gzip compression.

#### `decompress(buffer) → Buffer`
Raw gunzip decompression.

---

## Streaming / Incremental Decoder

Decode a continuous stream of HRBP values arriving in arbitrary chunks (e.g.
from a TCP socket).  Values may span multiple chunks; the decoder buffers
incomplete data and emits each complete value as soon as it is ready.

```js
const { StreamDecoder } = require('./src/index');
const net = require('net');

const decoder = new StreamDecoder();
decoder.on('data',  (value) => console.log('received:', value));
decoder.on('error', (err)   => console.error('stream error:', err));
decoder.on('end',   ()      => console.log('stream closed'));

const socket = net.createConnection(3000);
socket.on('data', (chunk) => decoder.write(chunk));
socket.on('end',  ()      => decoder.end());
```

### API

#### `decoder.write(chunk) → this`
Feed a `Buffer`, `Uint8Array`, or `string` chunk into the decoder.  Emits
`'data'` for every complete value found in the accumulated buffer.

#### `decoder.end() → this`
Signal end-of-stream.  Drains any remaining complete values, emits `'error'`
if unconsumed bytes remain, then emits `'end'`.

#### Events
| Event | Payload | Description |
|-------|---------|-------------|
| `'data'` | decoded value | Emitted for each complete HRBP value |
| `'error'` | `Error` | Emitted for malformed data or unconsumed bytes at end |
| `'end'` | — | Emitted after `end()` is called |

---

## Running Tests

```sh
npm test
```

The test suite (**164 tests**) uses Node.js's built-in `node:test` runner — no
extra dependencies required.

---

## Project Structure

```
src/
  types.js      – TAG constants and reverse TAG_NAME map
  encoder.js    – encode()  – JS value → Buffer
  decoder.js    – decode() / decodeAll() / decodeAt()  – Buffer → JS value
  inspector.js  – inspect() / hexDump()  – Buffer → human-readable string
  schema.js     – validate() / encodeWithSchema() / decodeWithSchema()
  versioned.js  – encodeVersioned() / decodeVersioned()
  compress.js   – compress() / decompress() / encodeCompressed() / decodeCompressed()
  stream.js     – StreamDecoder (incremental streaming decoder)
  index.js      – public API re-exports
tests/
  encoder.test.js
  decoder.test.js
  inspector.test.js
  schema.test.js
  versioned.test.js
  compress.test.js
  stream.test.js
```

