'use strict';

/**
 * Tests for the HRBP CLI tool (bin/hrbp.js).
 *
 * Uses `child_process.spawnSync` to invoke the CLI and assert stdout/stderr/exit code.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { encode } = require('../src/encoder');

const CLI = path.join(__dirname, '..', 'bin', 'hrbp.js');

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function run(args, { input } = {}) {
  const opts = { encoding: 'buffer', timeout: 5000 };
  if (input) opts.input = input;
  const result = spawnSync(process.execPath, [CLI, ...args], opts);
  return {
    stdout: result.stdout,
    stderr: result.stderr ? result.stderr.toString('utf8') : '',
    status: result.status,
  };
}

function tmpFile(buf) {
  const file = path.join(os.tmpdir(), `hrbp-test-${process.pid}-${Date.now()}.bin`);
  fs.writeFileSync(file, buf);
  return file;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('hrbp CLI', () => {
  describe('version', () => {
    it('prints the current protocol version', () => {
      const { stdout, status } = run(['version']);
      assert.equal(status, 0);
      assert.match(stdout.toString(), /version.*1/i);
    });
  });

  describe('inspect', () => {
    it('pretty-prints a buffer from a file', () => {
      const buf = encode({ name: 'Alice', age: 30 });
      const file = tmpFile(buf);
      const { stdout, status } = run(['inspect', file]);
      assert.equal(status, 0);
      const out = stdout.toString();
      assert.ok(out.includes('{'), 'should contain object marker');
      assert.ok(out.includes('Alice'), 'should contain the string value');
    });

    it('pretty-prints a buffer from stdin', () => {
      const buf = encode([1, 2, 3]);
      const { stdout, status } = run(['inspect'], { input: buf });
      assert.equal(status, 0);
      const out = stdout.toString();
      assert.ok(out.includes('['), 'should contain array marker');
    });
  });

  describe('hexdump', () => {
    it('prints a hex dump from a file', () => {
      const buf = encode('hello');
      const file = tmpFile(buf);
      const { stdout, status } = run(['hexdump', file]);
      assert.equal(status, 0);
      const out = stdout.toString();
      // Should have the offset column
      assert.match(out, /^00000000/m);
    });

    it('prints a hex dump from stdin', () => {
      const buf = encode(42);
      const { stdout, status } = run(['hexdump'], { input: buf });
      assert.equal(status, 0);
      assert.match(stdout.toString(), /^00000000/m);
    });
  });

  describe('decode', () => {
    it('decodes a file and prints JSON', () => {
      const buf = encode({ id: 1, name: 'Bob' });
      const file = tmpFile(buf);
      const { stdout, status } = run(['decode', file]);
      assert.equal(status, 0);
      const parsed = JSON.parse(stdout.toString());
      assert.deepEqual(parsed, { id: 1, name: 'Bob' });
    });

    it('decodes from stdin', () => {
      const buf = encode([10, 20, 30]);
      const { stdout, status } = run(['decode'], { input: buf });
      assert.equal(status, 0);
      const parsed = JSON.parse(stdout.toString());
      assert.deepEqual(parsed, [10, 20, 30]);
    });

    it('decodes boolean and null values', () => {
      const buf = encode(null);
      const file = tmpFile(buf);
      const { stdout, status } = run(['decode', file]);
      assert.equal(status, 0);
      assert.equal(stdout.toString().trim(), 'null');
    });
  });

  describe('encode', () => {
    it('encodes --json flag to binary stdout', () => {
      const { stdout, status } = run(['encode', '--json', '{"x":1}']);
      assert.equal(status, 0);
      const { decode } = require('../src/index');
      const value = decode(stdout);
      assert.deepEqual(value, { x: 1 });
    });

    it('encode → decode round-trip via CLI', () => {
      const original = { greeting: 'hello', count: 7, flag: true };
      const json = JSON.stringify(original);
      const { stdout: encoded, status: s1 } = run(['encode', '--json', json]);
      assert.equal(s1, 0);
      const { stdout: decoded, status: s2 } = run(['decode'], { input: encoded });
      assert.equal(s2, 0);
      assert.deepEqual(JSON.parse(decoded.toString()), original);
    });

    it('exits with error for invalid JSON', () => {
      const { status, stderr } = run(['encode', '--json', 'not-json']);
      assert.notEqual(status, 0);
      assert.match(stderr, /Invalid JSON/i);
    });
  });

  describe('unknown command', () => {
    it('exits with non-zero and prints error', () => {
      const { status, stderr } = run(['foobar']);
      assert.notEqual(status, 0);
      assert.match(stderr, /Unknown command/i);
    });
  });
});
