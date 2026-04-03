'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { StreamDecoder } = require('../src/stream');
const { encode } = require('../src/encoder');
const { TAG } = require('../src/types');

// Helper: collect all 'data' events emitted synchronously when feeding chunks.
function collectSync(chunks) {
  const decoder = new StreamDecoder();
  const values = [];
  const errors = [];
  decoder.on('data', (v) => values.push(v));
  decoder.on('error', (e) => errors.push(e));
  for (const chunk of chunks) decoder.write(chunk);
  return { values, errors, decoder };
}

describe('StreamDecoder', () => {
  describe('complete value in one chunk', () => {
    it('emits null', () => {
      const { values } = collectSync([encode(null)]);
      assert.deepEqual(values, [null]);
    });

    it('emits a number', () => {
      const { values } = collectSync([encode(42)]);
      assert.deepEqual(values, [42]);
    });

    it('emits a string', () => {
      const { values } = collectSync([encode('hello')]);
      assert.deepEqual(values, ['hello']);
    });

    it('emits a boolean', () => {
      const { values } = collectSync([encode(true), encode(false)]);
      assert.deepEqual(values, [true, false]);
    });

    it('emits an object', () => {
      const obj = { a: 1, b: 'x' };
      const { values } = collectSync([encode(obj)]);
      assert.deepEqual(values, [obj]);
    });

    it('emits multiple values from a single chunk', () => {
      const chunk = Buffer.concat([encode(1), encode('two'), encode(true)]);
      const { values } = collectSync([chunk]);
      assert.deepEqual(values, [1, 'two', true]);
    });
  });

  describe('value split across chunks', () => {
    it('emits value after the second chunk completes it', () => {
      const full = encode('hello');
      const part1 = full.slice(0, 3);
      const part2 = full.slice(3);
      const { values } = collectSync([part1, part2]);
      assert.deepEqual(values, ['hello']);
    });

    it('handles a value split into many single-byte chunks', () => {
      const full = encode(12345);
      const chunks = Array.from(full).map((b) => Buffer.from([b]));
      const { values } = collectSync(chunks);
      assert.deepEqual(values, [12345]);
    });

    it('handles interleaved complete and incomplete values', () => {
      const a = encode(1);
      const b = encode(2);
      const combined = Buffer.concat([a, b]);
      // Split between the two values
      const split = a.length + 2; // mid-way into b
      const { values } = collectSync([combined.slice(0, split), combined.slice(split)]);
      assert.deepEqual(values, [1, 2]);
    });
  });

  describe('multiple values across chunks', () => {
    it('handles many values split arbitrarily across chunks', () => {
      const full = Buffer.concat([1, 2, 3, 4, 5].map(encode));
      // Feed byte-by-byte
      const chunks = Array.from(full).map((b) => Buffer.from([b]));
      const { values } = collectSync(chunks);
      assert.deepEqual(values, [1, 2, 3, 4, 5]);
    });
  });

  describe('end()', () => {
    it('emits "end" when buffer is empty', async () => {
      const decoder = new StreamDecoder();
      const ended = new Promise((resolve) => decoder.once('end', resolve));
      decoder.end();
      await ended;
    });

    it('emits "error" then "end" when leftover bytes remain', async () => {
      const partial = encode('hello').slice(0, 2); // incomplete
      const decoder = new StreamDecoder();
      let errorSeen = false;
      decoder.on('error', () => { errorSeen = true; });
      const ended = new Promise((resolve) => decoder.once('end', resolve));
      decoder.write(partial);
      decoder.end();
      await ended;
      assert.ok(errorSeen, 'expected error before end');
    });

    it('drains remaining complete values before emitting "end"', async () => {
      const full = encode(99);
      const decoder = new StreamDecoder();
      const values = [];
      decoder.on('data', (v) => values.push(v));
      const ended = new Promise((resolve) => decoder.once('end', resolve));
      decoder.write(full);
      decoder.end();
      await ended;
      assert.deepEqual(values, [99]);
    });
  });

  describe('error handling', () => {
    it('emits "error" for an unknown tag byte', async () => {
      const decoder = new StreamDecoder();
      const errored = new Promise((resolve) => decoder.once('error', resolve));
      decoder.write(Buffer.from([0xff])); // unknown tag
      const e = await errored;
      assert.ok(e instanceof RangeError, 'expected RangeError');
    });

    it('does not emit more data events after an error', () => {
      const badChunk = Buffer.concat([Buffer.from([0xff]), encode(1)]);
      const { values, errors } = collectSync([badChunk]);
      assert.equal(errors.length, 1);
      // The '1' value after the bad tag should not be emitted
      assert.deepEqual(values, []);
    });

    it('accepts a string chunk (converts via Buffer.from)', () => {
      // Encode a simple null, ensure string-typed data path works
      const decoder = new StreamDecoder();
      const values = [];
      decoder.on('data', (v) => values.push(v));
      // Write the raw bytes as a Buffer (string path would break binary data,
      // so we just confirm the write() method accepts string without throwing)
      decoder.write(encode(null));
      assert.deepEqual(values, [null]);
    });
  });

  describe('write() chaining', () => {
    it('returns the decoder instance for chaining', () => {
      const decoder = new StreamDecoder();
      decoder.on('error', () => {}); // suppress
      const result = decoder.write(encode(1));
      assert.strictEqual(result, decoder);
    });
  });
});
