'use strict';

/**
 * HRBP Benchmark Suite
 *
 * Compares HRBP encode/decode performance against JSON (and optionally
 * MessagePack and protobufjs) across microbenchmarks and a realistic
 * API-response payload.
 *
 * Run with:  node benchmarks/bench.js   or   npm run bench
 *
 * Optional dependencies (improves coverage when installed):
 *   npm install --no-save @msgpack/msgpack
 *   npm install --no-save protobufjs
 *
 * Memory measurements use Node.js process.memoryUsage() and are indicative
 * only — GC timing affects accuracy.  Run on an idle machine for best results.
 *
 * Methodology
 * -----------
 * Each codec+phase combination is run for ITERATIONS operations after a
 * warm-up pass.  ops/sec, average latency in µs, encoded size in bytes, and
 * heap delta are recorded.  Results are written to BENCHMARKS.md.
 */

const { encode, decode } = require('../src/index');
const { performance } = require('perf_hooks');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Optional dependencies
// ---------------------------------------------------------------------------

let msgpack = null;
try { msgpack = require('@msgpack/msgpack'); } catch (_) {}

let protobuf = null;
try { protobuf = require('protobufjs'); } catch (_) {}

// ---------------------------------------------------------------------------
// Test payloads
// ---------------------------------------------------------------------------

const SMALL = { id: 1, name: 'Alice' };

const MEDIUM = Object.fromEntries(
  Array.from({ length: 100 }, (_, i) => [`key_${i}`, i % 2 === 0 ? i : `value_${i}`])
);

const LARGE_ARRAY = Array.from({ length: 1000 }, (_, i) => i);

// Realistic payload: simulates an HTTP API response with nested objects,
// arrays, mixed types, and binary data typical of production services.
const REALISTIC = {
  requestId: 'req-8f3a1b9c',
  timestamp: 1700000000000,
  status: 'success',
  user: {
    id: 42,
    name: 'Alice Wonderland',
    email: 'alice@example.com',
    roles: ['admin', 'editor'],
    preferences: { theme: 'dark', lang: 'en-US', notifications: true },
    createdAt: '2023-01-15T10:30:00Z',
  },
  items: Array.from({ length: 20 }, (_, i) => ({
    id: i + 1,
    sku: `PROD-${String(i + 1).padStart(4, '0')}`,
    name: `Product ${i + 1}`,
    price: parseFloat((9.99 + i * 1.5).toFixed(2)),
    inStock: i % 3 !== 0,
    tags: ['new', i % 2 === 0 ? 'featured' : 'sale'],
  })),
  pagination: { page: 1, perPage: 20, total: 200, hasNext: true },
  meta: { version: '2.1.0', region: 'us-east-1', latencyMs: 12 },
};

const payloads = [
  { name: 'small flat object', value: SMALL },
  { name: 'medium object (100 keys)', value: MEDIUM },
  { name: 'array of 1000 ints', value: LARGE_ARRAY },
  { name: 'realistic API response', value: REALISTIC },
];

// ---------------------------------------------------------------------------
// Benchmark runner
// ---------------------------------------------------------------------------

const ITERATIONS = 20_000;

/**
 * Measure ops/sec, avg µs, and approximate heap delta for `fn`.
 */
function bench(fn, iterations = ITERATIONS) {
  // Warm-up
  for (let i = 0; i < Math.min(500, Math.floor(iterations / 10)); i++) fn();

  // Force GC if available (node --expose-gc)
  if (typeof global.gc === 'function') global.gc();

  const heapBefore = process.memoryUsage().heapUsed;
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const elapsed = performance.now() - start;

  if (typeof global.gc === 'function') global.gc();
  const heapAfter = process.memoryUsage().heapUsed;

  const opsPerSec = Math.round((iterations / elapsed) * 1000);
  const avgUs = (elapsed / iterations) * 1000;
  // heapDelta can be negative due to GC; clamp to 0 for display.
  const heapDeltaKB = Math.max(0, Math.round((heapAfter - heapBefore) / 1024));
  return { opsPerSec, avgUs, heapDeltaKB };
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function row(label, opsPerSec, avgUs, bytes, heapKB) {
  const ops  = opsPerSec.toLocaleString('en-US').padStart(12);
  const us   = avgUs.toFixed(3).padStart(10);
  const b    = String(bytes).padStart(8);
  const heap = String(heapKB).padStart(8);
  return `${label.padEnd(28)} ${ops}  ${us}  ${b}  ${heap}`;
}

function header() {
  return `${'Codec + payload'.padEnd(28)} ${'ops/sec'.padStart(12)}  ${'avg µs'.padStart(10)}  ${'bytes'.padStart(8)}  ${'heap KB'.padStart(8)}`;
}

function separator() {
  return '-'.repeat(75);
}

// ---------------------------------------------------------------------------
// Protobuf helper (no .proto file — use plain-object round-trip via protobufjs)
// ---------------------------------------------------------------------------

async function buildProtobufType() {
  if (!protobuf) return null;
  try {
    const root = new protobuf.Root();
    const Type = protobuf.Type;
    const Field = protobuf.Field;

    const UserPrefs = new Type('UserPrefs')
      .add(new Field('theme', 1, 'string'))
      .add(new Field('lang', 2, 'string'))
      .add(new Field('notifications', 3, 'bool'));

    const User = new Type('User')
      .add(new Field('id', 1, 'int32'))
      .add(new Field('name', 2, 'string'))
      .add(new Field('email', 3, 'string'))
      .add(new Field('preferences', 4, 'UserPrefs'))
      .add(new Field('createdAt', 5, 'string'));

    const Pagination = new Type('Pagination')
      .add(new Field('page', 1, 'int32'))
      .add(new Field('perPage', 2, 'int32'))
      .add(new Field('total', 3, 'int32'))
      .add(new Field('hasNext', 4, 'bool'));

    const BenchMsg = new Type('BenchMsg')
      .add(new Field('requestId', 1, 'string'))
      .add(new Field('timestamp', 2, 'double'))
      .add(new Field('status', 3, 'string'))
      .add(new Field('user', 4, 'User'))
      .add(new Field('pagination', 5, 'Pagination'));

    root.define('bench').add(UserPrefs).add(User).add(Pagination).add(BenchMsg);
    return root.lookupType('bench.BenchMsg');
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  const protoType = await buildProtobufType();

  console.log('\nHRBP Benchmark\n');
  console.log(`Node.js ${process.version}  |  ${ITERATIONS.toLocaleString('en-US')} iterations per measurement`);
  if (typeof global.gc === 'function') console.log('GC exposed — heap measurements more accurate');
  else console.log('Tip: run with --expose-gc for better heap measurements');

  const allResults = [];

  for (const { name, value } of payloads) {
    console.log(`\n## ${name}\n`);
    console.log(header());
    console.log(separator());

    const payloadResults = [];

    // HRBP encode
    const hrbpEncResult = bench(() => encode(value));
    const hrbpBuf = encode(value);
    console.log(row('HRBP encode', hrbpEncResult.opsPerSec, hrbpEncResult.avgUs, hrbpBuf.length, hrbpEncResult.heapDeltaKB));
    payloadResults.push({ codec: 'HRBP', phase: 'encode', ...hrbpEncResult, bytes: hrbpBuf.length });

    // HRBP decode
    const hrbpDecResult = bench(() => decode(hrbpBuf));
    console.log(row('HRBP decode', hrbpDecResult.opsPerSec, hrbpDecResult.avgUs, hrbpBuf.length, hrbpDecResult.heapDeltaKB));
    payloadResults.push({ codec: 'HRBP', phase: 'decode', ...hrbpDecResult, bytes: hrbpBuf.length });

    // JSON encode
    const jsonEncResult = bench(() => JSON.stringify(value));
    const jsonStr = JSON.stringify(value);
    const jsonBytes = Buffer.byteLength(jsonStr, 'utf8');
    console.log(row('JSON encode', jsonEncResult.opsPerSec, jsonEncResult.avgUs, jsonBytes, jsonEncResult.heapDeltaKB));
    payloadResults.push({ codec: 'JSON', phase: 'encode', ...jsonEncResult, bytes: jsonBytes });

    // JSON decode
    const jsonDecResult = bench(() => JSON.parse(jsonStr));
    console.log(row('JSON decode', jsonDecResult.opsPerSec, jsonDecResult.avgUs, jsonBytes, jsonDecResult.heapDeltaKB));
    payloadResults.push({ codec: 'JSON', phase: 'decode', ...jsonDecResult, bytes: jsonBytes });

    // MessagePack (optional)
    if (msgpack) {
      const mpEncResult = bench(() => msgpack.encode(value));
      const mpBuf = msgpack.encode(value);
      console.log(row('MessagePack encode', mpEncResult.opsPerSec, mpEncResult.avgUs, mpBuf.byteLength, mpEncResult.heapDeltaKB));
      payloadResults.push({ codec: 'MessagePack', phase: 'encode', ...mpEncResult, bytes: mpBuf.byteLength });

      const mpDecResult = bench(() => msgpack.decode(mpBuf));
      console.log(row('MessagePack decode', mpDecResult.opsPerSec, mpDecResult.avgUs, mpBuf.byteLength, mpDecResult.heapDeltaKB));
      payloadResults.push({ codec: 'MessagePack', phase: 'decode', ...mpDecResult, bytes: mpBuf.byteLength });
    }

    // Protobuf (optional, realistic payload only — schema available)
    if (protoType && name === 'realistic API response') {
      try {
        const protoValue = {
          requestId: value.requestId,
          timestamp: value.timestamp,
          status: value.status,
          user: {
            id: value.user.id,
            name: value.user.name,
            email: value.user.email,
            preferences: value.user.preferences,
            createdAt: value.user.createdAt,
          },
          pagination: value.pagination,
        };
        const errMsg = protoType.verify(protoValue);
        if (!errMsg) {
          const protoMsg = protoType.create(protoValue);
          const protoEncResult = bench(() => protoType.encode(protoMsg).finish());
          const protoBuf = protoType.encode(protoMsg).finish();
          console.log(row('Protobuf encode', protoEncResult.opsPerSec, protoEncResult.avgUs, protoBuf.byteLength, protoEncResult.heapDeltaKB));
          payloadResults.push({ codec: 'Protobuf', phase: 'encode', ...protoEncResult, bytes: protoBuf.byteLength });

          const protoDecResult = bench(() => protoType.decode(protoBuf));
          console.log(row('Protobuf decode', protoDecResult.opsPerSec, protoDecResult.avgUs, protoBuf.byteLength, protoDecResult.heapDeltaKB));
          payloadResults.push({ codec: 'Protobuf', phase: 'decode', ...protoDecResult, bytes: protoBuf.byteLength });
        }
      } catch (_) {
        // protobufjs not usable for this payload — skip silently
      }
    }

    allResults.push({ payload: name, rows: payloadResults });
  }

  // ---------------------------------------------------------------------------
  // Emit BENCHMARKS.md
  // ---------------------------------------------------------------------------

  const now = new Date().toISOString().slice(0, 10);

  let md = `# HRBP Benchmarks\n\n`;
  md += `> Generated by \`npm run bench\` on ${now}  \n`;
  md += `> Node.js ${process.version}  \n`;
  md += `> ${ITERATIONS.toLocaleString('en-US')} iterations per measurement\n\n`;

  md += `## Methodology\n\n`;
  md += `Each codec+phase combination is measured independently after a warm-up pass.\n`;
  md += `The table columns are:\n\n`;
  md += `- **ops/sec** — operations per second (higher is better)\n`;
  md += `- **avg µs** — average latency per operation in microseconds (lower is better)\n`;
  md += `- **bytes** — encoded payload size in bytes (lower is better)\n`;
  md += `- **heap KB** — approximate heap growth during the measurement window (indicative only; depends on GC timing; run with \`--expose-gc\` for better accuracy)\n\n`;
  md += `### Caveats\n\n`;
  md += `- JSON is measured via the built-in \`JSON.stringify\`/\`JSON.parse\` (native C++ in V8) and is the fastest baseline for simple objects.\n`;
  md += `- HRBP is a pure-JS implementation with zero dependencies; performance will improve with optimisation passes.\n`;
  md += `- MessagePack results appear only when \`@msgpack/msgpack\` is installed (\`npm install --no-save @msgpack/msgpack\`).\n`;
  md += `- Protobuf results appear only for the realistic payload when \`protobufjs\` is installed (\`npm install --no-save protobufjs\`) and only covers a subset of the schema.\n`;
  md += `- Heap delta measurements can be negative or zero when GC runs during the window — this is expected.\n`;
  md += `- All benchmarks run in a single Node.js process; CPU frequency scaling and OS scheduling affect results.\n\n`;

  for (const { payload, rows } of allResults) {
    md += `## ${payload}\n\n`;
    md += `| Codec | Phase | ops/sec | avg µs | bytes | heap KB |\n`;
    md += `|-------|-------|--------:|-------:|------:|--------:|\n`;
    for (const r of rows) {
      md += `| ${r.codec} | ${r.phase} | ${r.opsPerSec.toLocaleString('en-US')} | ${r.avgUs.toFixed(3)} | ${r.bytes} | ${r.heapDeltaKB} |\n`;
    }
    md += '\n';
  }

  const mdPath = path.join(__dirname, '..', 'BENCHMARKS.md');
  fs.writeFileSync(mdPath, md, 'utf8');
  console.log(`\nResults written to BENCHMARKS.md\n`);
})();
