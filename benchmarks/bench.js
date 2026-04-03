'use strict';

/**
 * HRBP Benchmark Suite
 *
 * Compares HRBP encode/decode performance against JSON.
 * Run with:  node benchmarks/bench.js   or   npm run bench
 *
 * msgpack (@msgpack/msgpack) is measured when available but is optional:
 *   npm install --no-save @msgpack/msgpack
 */

const { encode, decode } = require('../src/index');
const { performance } = require('perf_hooks');

// ---------------------------------------------------------------------------
// Optional dependency: @msgpack/msgpack
// ---------------------------------------------------------------------------

let msgpack = null;
try {
  msgpack = require('@msgpack/msgpack');
} catch (_) {
  // Not installed — skip msgpack benchmarks.
}

// ---------------------------------------------------------------------------
// Test payloads
// ---------------------------------------------------------------------------

const SMALL = { id: 1, name: 'Alice' };

const MEDIUM = Object.fromEntries(
  Array.from({ length: 100 }, (_, i) => [`key_${i}`, i % 2 === 0 ? i : `value_${i}`])
);

const LARGE_ARRAY = Array.from({ length: 1000 }, (_, i) => i);

const payloads = [
  { name: 'small flat object  ', value: SMALL },
  { name: 'medium object (100k)', value: MEDIUM },
  { name: 'array of 1 000 ints', value: LARGE_ARRAY },
];

// ---------------------------------------------------------------------------
// Benchmark runner
// ---------------------------------------------------------------------------

const ITERATIONS = 50_000;

/**
 * Run `fn` `iterations` times and return ops/sec + average latency in µs.
 */
function bench(fn, iterations = ITERATIONS) {
  // Warm-up
  for (let i = 0; i < Math.min(1000, iterations / 10); i++) fn();

  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const elapsed = performance.now() - start; // ms

  const opsPerSec = Math.round((iterations / elapsed) * 1000);
  const avgUs = (elapsed / iterations) * 1000;
  return { opsPerSec, avgUs };
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function row(label, opsPerSec, avgUs, bytes) {
  const ops = opsPerSec.toLocaleString('en-US').padStart(12);
  const us  = avgUs.toFixed(3).padStart(10);
  const b   = String(bytes).padStart(8);
  return `${label.padEnd(25)} ${ops}  ${us}  ${b}`;
}

function header() {
  return `${'Codec + payload'.padEnd(25)} ${'ops/sec'.padStart(12)}  ${'avg µs'.padStart(10)}  ${'bytes'.padStart(8)}`;
}

function separator() {
  return '-'.repeat(65);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('\nHRBP Benchmark\n');

const results = []; // for BENCHMARKS.md

for (const { name, value } of payloads) {
  console.log(`\n## ${name.trim()}\n`);
  console.log(header());
  console.log(separator());

  const payloadResults = [];

  // HRBP encode
  const hrbpEnc = bench(() => encode(value));
  const hrbpBuf = encode(value);
  console.log(row(`HRBP encode`, hrbpEnc.opsPerSec, hrbpEnc.avgUs, hrbpBuf.length));
  payloadResults.push({ codec: 'HRBP', phase: 'encode', ...hrbpEnc, bytes: hrbpBuf.length });

  // HRBP decode
  const hrbpDec = bench(() => decode(hrbpBuf));
  console.log(row(`HRBP decode`, hrbpDec.opsPerSec, hrbpDec.avgUs, hrbpBuf.length));
  payloadResults.push({ codec: 'HRBP', phase: 'decode', ...hrbpDec, bytes: hrbpBuf.length });

  // JSON encode
  const jsonEnc = bench(() => JSON.stringify(value));
  const jsonStr = JSON.stringify(value);
  const jsonBytes = Buffer.byteLength(jsonStr, 'utf8');
  console.log(row(`JSON encode`, jsonEnc.opsPerSec, jsonEnc.avgUs, jsonBytes));
  payloadResults.push({ codec: 'JSON', phase: 'encode', ...jsonEnc, bytes: jsonBytes });

  // JSON decode
  const jsonDec = bench(() => JSON.parse(jsonStr));
  console.log(row(`JSON decode`, jsonDec.opsPerSec, jsonDec.avgUs, jsonBytes));
  payloadResults.push({ codec: 'JSON', phase: 'decode', ...jsonDec, bytes: jsonBytes });

  // msgpack (optional)
  if (msgpack) {
    const mpEnc = bench(() => msgpack.encode(value));
    const mpBuf = msgpack.encode(value);
    console.log(row(`msgpack encode`, mpEnc.opsPerSec, mpEnc.avgUs, mpBuf.byteLength));
    payloadResults.push({ codec: 'msgpack', phase: 'encode', ...mpEnc, bytes: mpBuf.byteLength });

    const mpDec = bench(() => msgpack.decode(mpBuf));
    console.log(row(`msgpack decode`, mpDec.opsPerSec, mpDec.avgUs, mpBuf.byteLength));
    payloadResults.push({ codec: 'msgpack', phase: 'decode', ...mpDec, bytes: mpBuf.byteLength });
  }

  results.push({ payload: name.trim(), rows: payloadResults });
}

// ---------------------------------------------------------------------------
// Emit BENCHMARKS.md
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

let md = `# HRBP Benchmarks\n\n`;
md += `> Generated by \`npm run bench\`  \n`;
md += `> Node.js ${process.version}  \n`;
md += `> ${ITERATIONS.toLocaleString('en-US')} iterations per measurement\n\n`;
md += `_msgpack_ results appear only when \`@msgpack/msgpack\` is installed.\n\n`;

for (const { payload, rows } of results) {
  md += `## ${payload}\n\n`;
  md += `| Codec | Phase | ops/sec | avg µs | bytes |\n`;
  md += `|-------|-------|--------:|-------:|------:|\n`;
  for (const r of rows) {
    md += `| ${r.codec} | ${r.phase} | ${r.opsPerSec.toLocaleString('en-US')} | ${r.avgUs.toFixed(3)} | ${r.bytes} |\n`;
  }
  md += '\n';
}

const mdPath = path.join(__dirname, '..', 'BENCHMARKS.md');
fs.writeFileSync(mdPath, md, 'utf8');
console.log(`\nResults written to BENCHMARKS.md\n`);
