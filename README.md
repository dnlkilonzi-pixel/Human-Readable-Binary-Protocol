<div align="center">

# 🔬 Human-Readable Binary Protocol (HRBP)

**A next-generation serialization protocol that is _binary-fast_ AND _human-readable_ — combining the best of both worlds.**

[![Tests](https://img.shields.io/badge/tests-164%20passing-brightgreen?style=flat-square&logo=node.js)](https://nodejs.org)
[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-brightgreen?style=flat-square&logo=node.js)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Language Ports](https://img.shields.io/badge/ports-JS%20%7C%20Python%20%7C%20C%20%7C%20Rust-orange?style=flat-square)](#-language-ports)
[![Author](https://img.shields.io/badge/author-Daniel%20Kimeu-blueviolet?style=flat-square)](https://github.com/dnlkilonzi-pixel)

> Created and maintained by **Daniel Kimeu** — building protocols that are _both_ debuggable _and_ fast.

</div>

---

## 📖 Table of Contents

- [The Problem HRBP Solves](#-the-problem-hrbp-solves)
- [How It Works](#-how-it-works)
- [Wire Format](#-wire-format)
- [Quick Start](#-quick-start)
- [Core API](#-core-api)
- [Inspection & Debugging](#-inspection--debugging)
- [Schema Validation](#-schema-validation)
- [Versioning](#-versioning)
- [Compression](#-compression)
- [Streaming Decoder](#-streaming--incremental-decoder)
- [TCP Transport](#-tcp-transport)
- [RPC Layer](#-rpc-layer)
- [CLI DevTools](#-cli-devtools)
- [Language Ports](#-language-ports)
- [Benchmarks](#-benchmarks)
- [Running Tests](#-running-tests)
- [Project Structure](#-project-structure)
- [Author](#-author)

---

## 🚨 The Problem HRBP Solves

Every serialization format today forces you to choose between **speed** and **debuggability**:

| Format | Speed | Wire Size | Human-Readable | Debuggable Without Tools |
|--------|:-----:|:---------:|:--------------:|:------------------------:|
| JSON | 🐢 Slower | ❌ Verbose | ✅ Yes | ✅ Yes |
| MessagePack | ✅ Fast | ✅ Compact | ❌ Opaque hex | ❌ Requires tooling |
| Protobuf | ✅ Fast | ✅ Compact | ❌ Opaque hex | ❌ Requires .proto schema |
| **HRBP** | ✅ Fast | ✅ Compact | ✅ **Yes** | ✅ **Yes** |

**HRBP** resolves this tension by using **printable ASCII characters as type-tag bytes**. Every hex dump of an HRBP buffer shows the protocol structure plainly — type tags like `I`, `S`, `{`, `[` appear as recognizable ASCII characters in any terminal, hex editor, or network sniffer — zero tooling required.

---

## 🧠 How It Works

Every HRBP value begins with a **single tag byte** chosen from printable ASCII characters. This means:

1. The raw binary buffer is inherently self-describing
2. A `xxd` or Wireshark hex view reveals the structure at a glance
3. No separate schema file or decoder is needed to understand the layout

```
                    ┌─────────────────────────────────────────────────────────┐
                    │            HRBP Wire Buffer (hex dump)                  │
                    │                                                         │
  Offset   Hex Bytes                                  ASCII Column            │
  ───────  ──────────────────────────────────────     ───────────             │
  00000000  7b 00 00 00 02 53 00 00  00 04 6e 61 6d 65  |{....S....name|      │
  0000000e  53 00 00 00 05 41 6c 69  63 65 49 00 00 00  |S....AliceI...|      │
  0000001e  1e                                          |.|                   │
                    │                                                         │
                    │   ↑            ↑                    ↑                   │
                    │   { = OBJECT   S = STRING           I = INT32           │
                    │   (0x7B)       (0x53)               (0x49)              │
                    └─────────────────────────────────────────────────────────┘
```

The type tags are chosen so they spell out recognizable characters in the ASCII column of any hex dump — **no special tools needed to understand what you're looking at**.

---

## 📐 Wire Format

Every encoded value is a **tag byte** followed by a type-specific payload.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         HRBP Value Layout                                │
│                                                                          │
│   ┌──────────┬────────────────────────────────────────────────────────┐  │
│   │ Tag Byte │                    Payload                             │  │
│   │ (1 byte) │             (type-dependent bytes)                     │  │
│   └──────────┴────────────────────────────────────────────────────────┘  │
│                                                                          │
│   Scalar types (NULL, TRUE, FALSE) → tag only, no payload                │
│   INT32   → tag + 4-byte signed big-endian integer                       │
│   FLOAT   → tag + 8-byte IEEE 754 big-endian double                      │
│   STRING  → tag + 4-byte length + UTF-8 bytes                            │
│   BUFFER  → tag + 4-byte length + raw bytes                              │
│   ARRAY   → tag + 4-byte count + N × HRBP values (recursive)            │
│   OBJECT  → tag + 4-byte pair count + N × (STRING key + HRBP value)     │
└──────────────────────────────────────────────────────────────────────────┘
```

### Type Tag Reference

| Tag Char | Hex  | JS Type           | Payload Layout                                       |
|:--------:|:----:|-------------------|------------------------------------------------------|
| `I`      | 0x49 | integer number    | 4 bytes — big-endian int32                           |
| `F`      | 0x46 | float number      | 8 bytes — big-endian IEEE 754 float64                |
| `S`      | 0x53 | string            | 4-byte uint32 length + UTF-8 bytes                   |
| `T`      | 0x54 | `true`            | *(no payload — 1 byte total)*                        |
| `X`      | 0x58 | `false`           | *(no payload — 1 byte total)*                        |
| `N`      | 0x4E | `null`            | *(no payload — 1 byte total)*                        |
| `[`      | 0x5B | Array             | 4-byte uint32 element count + encoded elements       |
| `{`      | 0x7B | Object            | 4-byte uint32 pair count + STRING key + value pairs  |
| `B`      | 0x42 | Buffer            | 4-byte uint32 byte length + raw bytes                |
| `H`      | 0x48 | *(version frame)* | 1-byte version + nested HRBP payload                 |

> **Integer vs Float:** Numbers in `[-2³¹, 2³¹-1]` that are integers encode as `I` (5 bytes). All others use `F` (9 bytes).

### Annotated Wire Example: `{ "name": "Alice", "age": 30 }`

```
7b                   {  ← OBJECT tag (0x7B)
00 00 00 02              2 key-value pairs

53                   S  ← STRING tag  (key: "name")
00 00 00 04              4 bytes
6e 61 6d 65          n a m e

53                   S  ← STRING tag  (value: "Alice")
00 00 00 05              5 bytes
41 6c 69 63 65       A l i c e

53                   S  ← STRING tag  (key: "age")
00 00 00 03              3 bytes
61 67 65             a g e

49                   I  ← INT32 tag
00 00 00 1e              30 (big-endian)

                         Total: 36 bytes
```

---

## ⚡ Quick Start

```sh
npm install human-readable-binary-protocol
```

```js
const { encode, decode, inspect, hexDump } = require('human-readable-binary-protocol');

// ── Serialize any JavaScript value ──────────────────────────────────────────
const buf = encode({ name: 'Alice', age: 30, active: true });

// ── Deserialize back to JavaScript ──────────────────────────────────────────
const value = decode(buf);
// => { name: 'Alice', age: 30, active: true }
```

### 🔍 Inspect — Human-Readable Structure Tree

```js
console.log(inspect(buf));
```

```
{ (3 pairs)
  S(4) "name"
    S(5) "Alice"
  S(3) "age"
    I 30
  S(6) "active"
    T true
}
```

### 🗂️ hexDump — Annotated Hex View

```js
console.log(hexDump(buf));
```

```
00000000  7b 00 00 00 03 53 00 00  00 04 6e 61 6d 65 53 00  |{....S....nameS.|
00000010  00 00 05 41 6c 69 63 65  53 00 00 00 03 61 67 65  |...AliceS....age|
00000020  49 00 00 00 1e 53 00 00  00 06 61 63 74 69 76 65  |I....S....active|
00000030  54                                                 |T|
```

> **Notice:** In the rightmost ASCII column, the type-tag bytes `{`, `S`, `I`, `T` are plainly visible — no special decoder required.

---

## 🔧 Core API

### `encode(value) → Buffer`

Encodes any supported JavaScript value into an HRBP `Buffer`.

**Supported types:** `null`, `undefined`, `boolean`, `number`, `string`, `Buffer`, `Array`, and plain `Object`.  
**Throws** `TypeError` for unsupported types (e.g. `function`, `Symbol`).

```js
encode(null)                         // => <Buffer 4e>  (N)
encode(true)                         // => <Buffer 54>  (T)
encode(42)                           // => <Buffer 49 00 00 00 2a>  (I)
encode(3.14)                         // => <Buffer 46 40 09 1e b8 51 eb 85 1f>  (F)
encode('hello')                      // => <Buffer 53 00 00 00 05 68 65 6c 6c 6f>  (S)
encode([1, 2, 3])                    // => nested HRBP array
encode({ x: 1 })                     // => nested HRBP object
```

### `decode(buffer) → value`

Decodes the first HRBP value from `buffer`.  
**Throws** `RangeError` / `IncompleteBufferError` on truncated or malformed input.

### `decodeAll(buffer) → value[]`

Decodes **all** HRBP values packed sequentially in `buffer` — useful for framed stream protocols and batch payloads.

```js
const buf = Buffer.concat([encode(1), encode('two'), encode([3])]);
decodeAll(buf);  // => [1, 'two', [3]]
```

---

## 🔍 Inspection & Debugging

### `inspect(buffer, [options]) → string`

Renders a multi-line indented tree of the HRBP structure — perfect for logging and debugging.

```js
inspect(encode({ users: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }] }));
```

```
{ (1 pairs)
  S(5) "users"
    [ (2 elements)
      { (2 pairs)
        S(2) "id"
          I 1
        S(4) "name"
          S(5) "Alice"
      }
      { (2 pairs)
        S(2) "id"
          I 2
        S(4) "name"
          S(3) "Bob"
      }
    ]
}
```

**Options:**
- `indent` *(default: `2`)* — spaces per indentation level

### `hexDump(buffer, [options]) → string`

Produces an annotated hex dump with offsets, hex bytes, and a printable ASCII column.

**Options:**
- `bytesPerRow` *(default: `16`)* — bytes displayed per row

```
00000000  7b 00 00 00 01 53 00 00  00 05 75 73 65 72 73 5b  |{....S....users[|
00000010  00 00 00 02 7b 00 00 00  02 53 00 00 00 02 69 64  |....{....S....id|
00000020  49 00 00 00 01 53 00 00  00 04 6e 61 6d 65 53 00  |I....S....nameS.|
00000030  00 00 05 41 6c 69 63 65  7b 00 00 00 02 53 00 00  |...Alice{....S..|
```

---

## 🛡️ Schema Validation

Add optional type-safety and contract enforcement — validates values _before_ encoding and _after_ decoding.

```js
const { validate, encodeWithSchema, decodeWithSchema } = require('human-readable-binary-protocol');

const userSchema = {
  type: 'object',
  fields: {
    id:    'int',
    name:  'string',
    score: 'float',
  },
  required: ['id', 'name'],
};

// ── Validation only ──────────────────────────────────────────────────────────
validate({ id: 1, name: 'Alice', score: 9.5 }, userSchema);  // ✅ passes silently
validate({ id: 1.5, name: 'Alice' }, userSchema);             // ❌ throws TypeError

// ── Schema-aware encode / decode ─────────────────────────────────────────────
const buf  = encodeWithSchema({ id: 7, name: 'Bob', score: 8.0 }, userSchema);
const user = decodeWithSchema(buf, userSchema);
// => { id: 7, name: 'Bob', score: 8.0 }
```

### Supported Schema Types

| Schema Descriptor | Valid When |
|-------------------|------------|
| `'int'` | `Number.isInteger(value)` |
| `'float'` / `'number'` | any `number` |
| `'string'` | string |
| `'boolean'` | boolean |
| `'null'` | `null` |
| `'buffer'` | `Buffer` instance |
| `{ type: 'array', items: <schema> }` | Array where every element matches `items` |
| `{ type: 'object', fields: { … }, required: […] }` | Object with validated fields (optional `required` list) |

### Schema API

| Function | Description |
|----------|-------------|
| `validate(value, schema, [path])` | Throws `TypeError` if `value` doesn't conform to `schema` |
| `encodeWithSchema(value, schema) → Buffer` | Validates, then encodes |
| `decodeWithSchema(buffer, schema) → value` | Decodes, then validates |

---

## 🔖 Versioning

Wrap any payload in a one-byte version header so future protocol changes can be detected without breaking existing decoders.

```
┌──────────────────────────────────────────────────────────┐
│              Versioned Frame Wire Layout                  │
│                                                          │
│   [ 0x48 'H' ] [ version (1 byte) ] [ HRBP payload … ]  │
│        ↑               ↑                   ↑             │
│   Version tag      Version=1          Any HRBP value     │
│  (visible in                                             │
│   hex dumps)                                             │
└──────────────────────────────────────────────────────────┘
```

```js
const {
  encodeVersioned, decodeVersioned,
  CURRENT_VERSION, MAX_SUPPORTED_VERSION
} = require('human-readable-binary-protocol');

const buf = encodeVersioned({ event: 'login', userId: 42 });
// buf[0] === 0x48  → 'H'  (visible in any hex dump)
// buf[1] === 0x01  → version 1

const { version, value } = decodeVersioned(buf);
// version => 1
// value   => { event: 'login', userId: 42 }

console.log(CURRENT_VERSION);       // 1
console.log(MAX_SUPPORTED_VERSION); // 1
```

### Versioning API

| Function | Description |
|----------|-------------|
| `encodeVersioned(value, [version=1]) → Buffer` | Encodes + prefixes with `H` + version byte |
| `decodeVersioned(buffer) → { version, value }` | Validates `H` header, rejects unsupported versions, decodes payload |
| `CURRENT_VERSION` | Current protocol version constant |
| `MAX_SUPPORTED_VERSION` | Maximum version this decoder accepts |

---

## 🗜️ Compression

Optionally gzip the wire payload using Node.js's built-in `zlib` — **zero extra dependencies**. Especially effective for:

- 🌐 Network transmission of large or repetitive messages
- 📁 Log files storing thousands of HRBP frames
- 📦 Caching repeated structured data

```js
const {
  encodeCompressed, decodeCompressed,
  compress, decompress
} = require('human-readable-binary-protocol');

// ── High-level: encode + compress in one step ────────────────────────────────
const buf   = encodeCompressed({ tags: Array(100).fill('active') });
const value = decodeCompressed(buf);
// => { tags: ['active', 'active', ... ] }

// ── Low-level: compress / decompress raw buffers ─────────────────────────────
const raw  = compress(Buffer.from('hello world'));
const back = decompress(raw);
// back.toString() => 'hello world'
```

### Compression API

| Function | Description |
|----------|-------------|
| `encodeCompressed(value, [options]) → Buffer` | Encodes then gzip-compresses; `options` forwarded to `zlib.gzipSync` |
| `decodeCompressed(buffer) → value` | Gunzip-decompresses then decodes |
| `compress(buffer, [options]) → Buffer` | Raw gzip compression |
| `decompress(buffer) → Buffer` | Raw gunzip decompression |

---

## 🌊 Streaming / Incremental Decoder

Decode a continuous stream of HRBP values arriving in **arbitrary chunks** — e.g. from a TCP socket. Values may span multiple chunks; the decoder buffers incomplete data and emits each complete value the moment it arrives.

```
┌───────────────────────────────────────────────────────────────────────────┐
│                      StreamDecoder Data Flow                              │
│                                                                           │
│  TCP Socket ──chunk──▶  decoder.write(chunk)                             │
│                                    │                                      │
│                         ┌──────────▼──────────┐                          │
│                         │   Internal Buffer   │                          │
│                         │  (accumulates data) │                          │
│                         └──────────┬──────────┘                          │
│                                    │                                      │
│                    ┌───────────────┼───────────────┐                     │
│                    ▼               ▼               ▼                     │
│              Complete           Partial          Error                   │
│              value ready        frame            in data                 │
│                    │            (wait)               │                   │
│                    ▼                                 ▼                   │
│             emit('data', val)              emit('error', err)            │
└───────────────────────────────────────────────────────────────────────────┘
```

```js
const { StreamDecoder } = require('human-readable-binary-protocol');
const net = require('net');

const decoder = new StreamDecoder();

decoder.on('data',  (value) => console.log('✅ received:', value));
decoder.on('error', (err)   => console.error('❌ stream error:', err));
decoder.on('end',   ()      => console.log('🔚 stream closed'));

// Connect to an HRBP server and pipe data through the decoder
const socket = net.createConnection(3000);
socket.on('data', (chunk) => decoder.write(chunk));
socket.on('end',  ()      => decoder.end());
```

### StreamDecoder API

| Method | Description |
|--------|-------------|
| `decoder.write(chunk) → this` | Feed a `Buffer`, `Uint8Array`, or `string` chunk; emits `'data'` for each complete value found |
| `decoder.end() → this` | Signal end-of-stream; drains remaining values, emits `'error'` on leftover bytes, then `'end'` |

### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `'data'` | decoded value | Emitted for each complete HRBP value decoded from the stream |
| `'error'` | `Error` | Emitted for malformed data or unconsumed bytes at end-of-stream |
| `'end'` | — | Emitted after `end()` finishes draining |

---

## 🔌 TCP Transport

HRBP includes a ready-to-use **TCP server/client** that handles 4-byte length-prefixed framing automatically — so you can send/receive complete HRBP messages over any stream without worrying about message boundaries.

```
┌──────────────────────────────────────────────────────────────────────┐
│                    TCP Framing Wire Layout                            │
│                                                                      │
│  [ uint32 payload-length (4 bytes, big-endian) ]                    │
│  [ HRBP payload          (payload-length bytes) ]                   │
│                                                                      │
│  The 4-byte header counts ONLY the payload — not itself.            │
└──────────────────────────────────────────────────────────────────────┘
```

```js
const { HRBPServer } = require('./src/tcp/server');
const { HRBPClient } = require('./src/tcp/client');

// ── Server ────────────────────────────────────────────────────────────────────
const server = new HRBPServer();

server.on('connection', (conn) => {
  conn.on('message', (msg) => {
    console.log('Server received:', msg);
    conn.send({ reply: 'pong', echo: msg });
  });
});

server.listen(3000, '127.0.0.1', () => console.log('🚀 HRBP server ready on :3000'));

// ── Client ────────────────────────────────────────────────────────────────────
const client = new HRBPClient();

client.on('message', (msg) => console.log('Client received:', msg));

client.connect(3000, '127.0.0.1', () => {
  client.send({ ping: true, timestamp: Date.now() });
});
```

---

## 📡 RPC Layer

The **HRBP RPC Layer** builds on top of TCP Transport to provide a full **call/response RPC** system — like a lightweight gRPC with a human-readable wire format.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      RPC Message Envelope Format                        │
│                                                                         │
│  CALL:   { type: "call",  id: <uint32>, method: <str>, params: <any> } │
│  REPLY:  { type: "reply", id: <uint32>, result: <any> }                │
│  ERROR:  { type: "error", id: <uint32>, message: <str> }               │
│                                                                         │
│  • id is monotonically increasing, chosen by the caller                │
│  • Reply/Error MUST use the same id as the corresponding Call          │
│  • Concurrent calls matched to responses by id                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### RPC Server

```js
const { HRBPRpcServer } = require('./src/rpc/server');

const rpc = new HRBPRpcServer();

// Middleware (runs before every handler)
rpc.use(async (envelope, conn) => {
  console.log(`→ ${envelope.method}(${JSON.stringify(envelope.params)})`);
  return envelope;  // pass through, or throw to reject
});

// Register handlers
rpc.handle('add',     async ({ a, b })  => a + b);
rpc.handle('getUser', async ({ id })    => ({ id, name: 'Alice', role: 'admin' }));
rpc.handle('echo',    async (params)    => params);

rpc.listen(7001, '127.0.0.1', () => console.log('🚀 RPC server ready on :7001'));
```

### RPC Client

```js
const { HRBPRpcClient } = require('./src/rpc/client');

const client = new HRBPRpcClient();

client.connect(7001, '127.0.0.1', async () => {
  const sum  = await client.call('add',     { a: 10, b: 32 });
  // => 42

  const user = await client.call('getUser', { id: 1 });
  // => { id: 1, name: 'Alice', role: 'admin' }

  console.log('sum:', sum, '| user:', user);
  client.close();
});
```

---

## 🖥️ CLI DevTools

HRBP ships with a **built-in CLI** (`hrbp`) for inspecting, decoding, and encoding HRBP binary files directly from the terminal.

```sh
# Install globally
npm install -g human-readable-binary-protocol

# Or run directly
npx hrbp --help
```

### Available Commands

| Command | Description |
|---------|-------------|
| `hrbp inspect  <file.bin>` | Pretty-print the HRBP structure as an indented tree |
| `hrbp hexdump  <file.bin>` | Print an annotated hex dump |
| `hrbp decode   <file.bin>` | Decode and output as pretty-printed JSON |
| `hrbp encode  --json '<json>'` | Encode a JSON value to HRBP binary (stdout) |
| `hrbp version` | Print the current protocol version |

> **Pipe-friendly:** Omit the file argument to read from **stdin**.

### CLI Usage Examples

```sh
# Encode a JSON payload to HRBP binary
hrbp encode --json '{"name":"Alice","age":30}' > message.bin

# Inspect the binary structure
hrbp inspect message.bin
```

```
{ (2 pairs)
  S(4) "name"
    S(5) "Alice"
  S(3) "age"
    I 30
}
```

```sh
# View the annotated hex dump
hrbp hexdump message.bin
```

```
00000000  7b 00 00 00 02 53 00 00  00 04 6e 61 6d 65 53 00  |{....S....nameS.|
00000010  00 00 05 41 6c 69 63 65  53 00 00 00 03 61 67 65  |...AliceS....age|
00000020  49 00 00 00 1e                                     |I....|
```

```sh
# Decode back to JSON
hrbp decode message.bin
```

```json
{
  "name": "Alice",
  "age": 30
}
```

```sh
# Pipe-friendly — chain with other tools
hrbp encode --json '{"event":"login"}' | hrbp inspect
hrbp encode --json '{"x":1}' | xxd
```

---

## 🌐 Language Ports

HRBP has reference implementations in four languages, making it a true **polyglot** protocol:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      HRBP Language Ecosystem                            │
│                                                                         │
│    JavaScript (Node.js)   Python         C              Rust            │
│    ─────────────────────  ──────────     ──────────     ──────────      │
│    src/index.js           ports/python/  ports/c/       ports/rust/     │
│    Full feature set       hrbp.py        hrbp.h         src/lib.rs      │
│                                          hrbp_test.c    Cargo.toml      │
└─────────────────────────────────────────────────────────────────────────┘
```

### 🐍 Python Port

```python
# ports/python/hrbp.py
import hrbp

data = {'name': 'Alice', 'age': 30, 'active': True}
buf  = hrbp.encode(data)
val  = hrbp.decode(buf)
# => {'name': 'Alice', 'age': 30, 'active': True}
```

### 🦀 Rust Port

```rust
// ports/rust/
use hrbp::{encode, decode};

let data = serde_json::json!({ "name": "Alice", "age": 30 });
let buf  = encode(&data).unwrap();
let val  = decode(&buf).unwrap();
```

### ⚙️ C Port

```c
// ports/c/hrbp.h
#include "hrbp.h"

uint8_t buf[1024];
size_t len = hrbp_encode_int(buf, 42);
int32_t value;
hrbp_decode_int(buf, &value);
```

All ports implement the same wire format defined in [SPEC.md](SPEC.md) and produce **fully interoperable binary payloads** — encode in Rust, decode in Python, inspect with the JS CLI.

---

## 📊 Benchmarks

> Generated by `npm run bench` | Node.js v24 | 50,000 iterations per measurement

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    HRBP vs JSON — Performance Comparison                │
│                                                                         │
│  Small flat object { name, age }                                        │
│  ┌──────────┬──────────┬────────────────┬──────────┬─────────┐         │
│  │  Codec   │  Phase   │    ops/sec     │  avg µs  │  bytes  │         │
│  ├──────────┼──────────┼────────────────┼──────────┼─────────┤         │
│  │ HRBP     │ encode   │    679,092     │  1.473   │   36    │         │
│  │ HRBP     │ decode   │  1,717,225     │  0.582   │   36    │         │
│  │ JSON     │ encode   │  5,389,867     │  0.186   │   23    │         │
│  │ JSON     │ decode   │  3,761,821     │  0.266   │   23    │         │
│  └──────────┴──────────┴────────────────┴──────────┴─────────┘         │
│                                                                         │
│  Medium object (100 string keys)                                        │
│  ┌──────────┬──────────┬────────────────┬──────────┬─────────┐         │
│  │ HRBP     │ encode   │     20,224     │  49.447  │  1990   │         │
│  │ HRBP     │ decode   │     38,107     │  26.242  │  1990   │         │
│  │ JSON     │ encode   │    214,602     │   4.660  │  1581   │         │
│  │ JSON     │ decode   │    137,968     │   7.248  │  1581   │         │
│  └──────────┴──────────┴────────────────┴──────────┴─────────┘         │
│                                                                         │
│  Array of 1,000 integers                                                │
│  ┌──────────┬──────────┬────────────────┬──────────┬─────────┐         │
│  │ HRBP     │ encode   │     13,014     │  76.841  │  5005   │         │
│  │ HRBP     │ decode   │     68,841     │  14.526  │  5005   │         │
│  │ JSON     │ encode   │     95,913     │  10.426  │  3891   │         │
│  │ JSON     │ decode   │     96,206     │  10.394  │  3891   │         │
│  └──────────┴──────────┴────────────────┴──────────┴─────────┘         │
└─────────────────────────────────────────────────────────────────────────┘
```

> **HRBP decode throughput exceeds JSON decode on medium and large payloads** — making it ideal for read-heavy workloads like caches and event streams.

Run benchmarks yourself:

```sh
npm run bench
```

See [BENCHMARKS.md](BENCHMARKS.md) for the full benchmark report.

---

## 🧪 Running Tests

```sh
npm test
```

The test suite uses Node.js's **built-in `node:test` runner** — zero extra dependencies required.

```
▶ encoder
  ✔ encodes null (1.2ms)
  ✔ encodes true / false (0.3ms)
  ✔ encodes integer numbers (0.4ms)
  ✔ encodes float numbers (0.3ms)
  ✔ encodes strings (0.5ms)
  ✔ encodes Buffer (0.2ms)
  ✔ encodes arrays (0.6ms)
  ✔ encodes objects (0.5ms)
  ...
▶ decoder … ▶ inspector … ▶ schema … ▶ versioning … ▶ compression … ▶ streaming …

ℹ tests 164
ℹ pass  164
ℹ fail    0
```

---

## 🗂️ Project Structure

```
Human-Readable-Binary-Protocol/
│
├── src/
│   ├── index.js          ← Public API re-exports (single entry point)
│   ├── types.js          ← TAG constants and reverse TAG_NAME map
│   ├── encoder.js        ← encode() — JS value → Buffer
│   ├── decoder.js        ← decode() / decodeAll() / decodeAt() — Buffer → JS value
│   ├── inspector.js      ← inspect() / hexDump() — Buffer → human-readable string
│   ├── framing.js        ← 4-byte length-prefix framing utilities
│   ├── schema.js         ← validate() / encodeWithSchema() / decodeWithSchema()
│   ├── versioned.js      ← encodeVersioned() / decodeVersioned()
│   ├── compress.js       ← compress() / decompress() / encodeCompressed() / decodeCompressed()
│   ├── stream.js         ← StreamDecoder (incremental streaming decoder)
│   ├── tcp/
│   │   ├── server.js     ← HRBPServer — TCP server with HRBP framing
│   │   └── client.js     ← HRBPClient — TCP client with HRBP framing
│   └── rpc/
│       ├── server.js     ← HRBPRpcServer — RPC server with middleware support
│       ├── client.js     ← HRBPRpcClient — RPC client with promise-based calls
│       └── protocol.js   ← RPC envelope helpers (makeCall, makeReply, makeError)
│
├── tests/
│   ├── encoder.test.js
│   ├── decoder.test.js
│   ├── inspector.test.js
│   ├── schema.test.js
│   ├── versioned.test.js
│   ├── compress.test.js
│   └── stream.test.js
│
├── bin/
│   └── hrbp.js           ← CLI DevTools (inspect, hexdump, decode, encode)
│
├── benchmarks/
│   └── bench.js          ← HRBP vs JSON benchmark suite
│
├── ports/
│   ├── python/hrbp.py    ← Python reference implementation
│   ├── c/hrbp.h          ← C reference implementation (single-header)
│   └── rust/             ← Rust reference implementation (Cargo workspace)
│
├── SPEC.md               ← Complete wire format specification
├── BENCHMARKS.md         ← Benchmark results
└── README.md             ← This file
```

---

## 📜 Wire Format Specification

The full machine-readable protocol specification is in [`SPEC.md`](SPEC.md). It covers:

- All type encoding rules with exact byte layouts
- TCP framing protocol
- RPC envelope format
- Versioned frame structure
- Conformance requirements

HRBP is designed to be **language-agnostic** — the spec is the single source of truth for all language ports.

---

## 👤 Author

<div align="center">

**Human-Readable Binary Protocol (HRBP)** was designed, built, and documented by

## Daniel Kimeu

> _"A protocol should be fast enough for machines and clear enough for humans."_

[![GitHub](https://img.shields.io/badge/GitHub-dnlkilonzi--pixel-181717?style=for-the-badge&logo=github)](https://github.com/dnlkilonzi-pixel)

---

*All code, architecture, wire format specification, CLI tooling, RPC layer,*  
*TCP transport, streaming decoder, schema validation, compression support,*  
*and multi-language ports are the original work of **Daniel Kimeu**.*

</div>

---

<div align="center">

**MIT License** · © Daniel Kimeu · [SPEC.md](SPEC.md) · [BENCHMARKS.md](BENCHMARKS.md)

</div>

