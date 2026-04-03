# Human-Readable Binary Protocol (HRBP)

A protocol that is **binary** (fast, compact) **and** human-readable / debuggable — combining the best of both worlds.

---

## Why HRBP?

| Concern | JSON | MessagePack / Protobuf | **HRBP** |
|---------|------|------------------------|----------|
| Wire speed | ❌ Slower (text parsing) | ✅ Fast | ✅ Fast |
| Human readability | ✅ Readable | ❌ Opaque binary | ✅ Readable in any hex dump |
| External tooling needed | ❌ No binary support | ✅ Requires schema/decoder | ✅ None — ASCII tags visible inline |
| Schema / IDL | ❌ None built-in | ✅ Protobuf IDL | ✅ Built-in IDL + schema validation |
| Built-in RPC | ❌ No | ❌ Needs gRPC layer | ✅ Native RPC layer |
| Observability | ❌ No | ❌ No | ✅ Tracing, metrics, structured logs |
| Chaos testing | ❌ No | ❌ No | ✅ Built-in fault injector + chaos proxy |
| Production persistence | ❌ No | ❌ No | ✅ WAL + state store |
| Horizontal scaling | ❌ No | ❌ No | ✅ Consistent hash ring + cluster coordinator |
| Zero dependencies | ✅ Yes | ❌ Schema compiler | ✅ Yes — Node.js built-ins only |

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

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          HRBP Production Stack                          │
├─────────────────────────────────────────────────────────────────────────┤
│  CLI (bin/hrbp.js)        inspect · hexdump · encode · decode           │
│                           serve · ping                                  │
├─────────────────────────────────────────────────────────────────────────┤
│  Developer Tools          IDL / contracts · schema · inspector          │
├─────────────────────────────────────────────────────────────────────────┤
│  RPC Layer                HRBPRpcServer · HRBPRpcClient                  │
│    middleware chain       auth · rate-limit · signing · tracing          │
├─────────────────────────────────────────────────────────────────────────┤
│  Observability            Tracer (spans) · MetricsCollector · Logger    │
├─────────────────────────────────────────────────────────────────────────┤
│  Service Discovery        ServiceRegistry · LoadBalancer · HealthCheck  │
├─────────────────────────────────────────────────────────────────────────┤
│  Cluster / Scaling        ConsistentHash · ClusterCoordinator           │
├─────────────────────────────────────────────────────────────────────────┤
│  Persistence              WAL · RegistryStore · StateStore              │
├─────────────────────────────────────────────────────────────────────────┤
│  Security                 TLS · HMAC signing · token auth               │
├─────────────────────────────────────────────────────────────────────────┤
│  TCP Transport            HRBPServer · HRBPClient · BackpressureCtrl    │
├─────────────────────────────────────────────────────────────────────────┤
│  Framing / Codec          frameEncode · FrameDecoder · StreamDecoder    │
├─────────────────────────────────────────────────────────────────────────┤
│  Core Codec               encode · decode · inspect · hexDump           │
│                           versioned · compress · schema                 │
└─────────────────────────────────────────────────────────────────────────┘
```

### Data Flow: RPC call with tracing and persistence

```
Client                  Server (RPC layer)               Backends
──────                  ──────────────────               ────────
call('add', {a,b})
  │ encode envelope
  │ ──────────────────►
  │                     middleware chain
  │                       1. auth / signing check
  │                       2. rate-limiter
  │                       3. tracer.startSpan('add')  ──► InMemoryCollector
  │                       4. logger.info('rpc:call')  ──► structured log sink
  │                     handler: add({a,b}) → result
  │                     span.finish()                 ──► collector records span
  │                     wal.append({method, result})  ──► WAL file (crash-safe)
  │                     metrics.recordCall('add', ms)
  │ ◄──────────────────
  result = a + b
```

---

## Quick Start

### Core codec

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

### RPC server and client

```js
const { HRBPRpcServer, HRBPRpcClient, attachHealthCheck } = require('./src/index');

// Server
const server = new HRBPRpcServer();
attachHealthCheck(server, { serviceName: 'calc' });
server.handle('add', async ({ a, b }) => a + b);
server.listen(7001, '127.0.0.1', () => console.log('RPC server on :7001'));

// Client
const client = new HRBPRpcClient();
client.connect(7001, '127.0.0.1', async () => {
  const result = await client.call('add', { a: 10, b: 20 });
  console.log(result); // 30
  client.close();
  server.close();
});
```

### Observability middleware

```js
const { HRBPRpcServer, Tracer, InMemoryCollector, MetricsCollector, Logger } = require('./src/index');

const collector = new InMemoryCollector();
const tracer    = new Tracer({ collector });
const metrics   = new MetricsCollector();
const logger    = new Logger({ level: 'info' });

const server = new HRBPRpcServer();

server.use(async (envelope) => {
  const span = tracer.startSpan(envelope.method);
  envelope._span = span;
  logger.info('rpc:call', { method: envelope.method });
  return envelope;
});

server.handle('greet', async ({ name }) => `Hello, ${name}!`);
server.listen(7001);
```

### Chaos testing

```js
const { ChaosProxy, HRBPRpcClient } = require('./src/index');

// Sit a chaos proxy in front of a real server
const proxy = new ChaosProxy({
  target: { host: '127.0.0.1', port: 7001 },
  latency: { min: 20, max: 80 },   // inject 20–80 ms delay
  dropRate: 0.05,                   // 5% packet loss
  corruptRate: 0.01,                // 1% frame corruption
});

await proxy.listen(9001);

// Point your clients at the proxy port instead
const client = new HRBPRpcClient();
client.connect(9001, '127.0.0.1', async () => {
  const result = await client.call('add', { a: 1, b: 2 });
  console.log(result); // 3 (or an error if a fault triggered)
  await proxy.close();
  client.close();
});
```

### Service discovery + load balancing

```js
const { ServiceRegistry, LoadBalancer } = require('./src/index');

const registry = new ServiceRegistry();
registry.register({ name: 'calc', host: '10.0.0.1', port: 7001 });
registry.register({ name: 'calc', host: '10.0.0.2', port: 7001 });

const lb = new LoadBalancer({ strategy: 'round-robin' });
for (const inst of registry.lookup('calc')) {
  lb.addInstance({ host: inst.host, port: inst.port });
}

const target = lb.pick(); // { host: '10.0.0.1', port: 7001 }
```

### Horizontal scaling (consistent hashing)

```js
const { ConsistentHash, ClusterCoordinator } = require('./src/index');

const ring = new ConsistentHash(150); // 150 virtual nodes per real node
ring.addNode('node-1');
ring.addNode('node-2');
ring.addNode('node-3');

const target = ring.getNode('user:42'); // deterministic, stable routing
```

### Persistence (WAL + state store)

```js
const { WAL, StateStore } = require('./src/index');

const wal = new WAL('/var/data/hrbp.wal');
await wal.open();
await wal.append({ type: 'call', method: 'add', params: { a: 1, b: 2 } });

const entries = await wal.replay(); // recover on restart

const store = new StateStore('/var/data/hrbp-state');
await store.open();
await store.set('config', { maxConns: 100 });
const cfg = await store.get('config'); // { maxConns: 100 }
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

The test suite uses Node.js's built-in `node:test` runner — no extra dependencies required.  362 tests across 84 suites covering every module.

---

## CLI

```sh
# Inspect the structure of an HRBP binary file
hrbp inspect  message.bin

# Annotated hex dump
hrbp hexdump  message.bin

# Decode to JSON
hrbp decode   message.bin

# Encode JSON to HRBP binary
hrbp encode --json '{"name":"Alice","age":30}' > out.bin

# Start a minimal RPC echo server for manual testing
hrbp serve --port 7001

# Ping an RPC server to check liveness
hrbp ping --host 127.0.0.1 --port 7001

# Print the protocol version
hrbp version

# All commands accept stdin when no file is given
cat out.bin | hrbp inspect
```

---

## Project Structure

```
src/
  types.js               – TAG constants and reverse TAG_NAME map
  encoder.js             – encode()
  decoder.js             – decode() / decodeAll() / decodeAt()
  inspector.js           – inspect() / hexDump()
  schema.js              – validate() / encodeWithSchema() / decodeWithSchema()
  versioned.js           – encodeVersioned() / decodeVersioned()
  compress.js            – gzip encode/decode helpers
  stream.js              – StreamDecoder (incremental streaming decoder)
  framing.js             – frameEncode() / FrameDecoder (length-prefixed framing)
  backpressure.js        – BackpressureController (high-water-mark flow control)
  tcp/
    server.js            – HRBPServer (TCP listener, auto-frames HRBP messages)
    client.js            – HRBPClient (TCP client)
  rpc/
    server.js            – HRBPRpcServer (middleware + named handlers)
    client.js            – HRBPRpcClient (call / await pattern)
    protocol.js          – makeCall / makeReply / makeError envelope builders
  observability/
    tracing.js           – Tracer / SpanImpl / InMemoryCollector
    metrics.js           – MetricsCollector (call counts, latency histograms)
    logger.js            – Logger (structured, level-filtered, pluggable sink)
  discovery/
    registry.js          – ServiceRegistry (TTL-based in-memory registry)
    loadbalancer.js      – LoadBalancer (round-robin / random / least-pending)
    health.js            – attachHealthCheck() (__health RPC handler)
  cluster.js             – ConsistentHash / ClusterCoordinator
  persistence.js         – WAL / RegistryStore / StateStore
  chaos.js               – ChaosProxy / createFaultInjector / corruptBuffer
  security/
    tls.js               – HRBPSecureServer / HRBPSecureClient
    auth.js              – createAuthMiddleware / createRateLimiter
    signing.js           – createSigner / createVerifier (HMAC)
  idl/
    parser.js            – IDL language parser
    index.js             – parseIDL / buildContracts / generateClientStub
  config.js              – Config (env + file overlay system)
  index.js               – public API re-exports

bin/
  hrbp.js                – DevTools CLI

tests/
  encoder.test.js        decoder.test.js    inspector.test.js
  schema.test.js         versioned.test.js  compress.test.js
  stream.test.js         tcp.test.js        rpc.test.js
  backpressure.test.js   security.test.js   idl.test.js
  observability.test.js  discovery.test.js  cluster.test.js
  persistence.test.js    chaos.test.js      config.test.js
  cli.test.js            e2e.test.js        scenarios.test.js

ports/
  python/hrbp.py         – pure-Python codec
  c/hrbp.h               – single-header C codec
  rust/src/lib.rs        – Rust crate

benchmarks/
  bench.js               – encode/decode throughput benchmark
```

