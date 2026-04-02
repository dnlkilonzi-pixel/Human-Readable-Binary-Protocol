'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { compress, decompress, encodeCompressed, decodeCompressed } = require('../src/compress');
const { encode } = require('../src/encoder');

describe('compress', () => {
  describe('compress() / decompress()', () => {
    it('returns a Buffer from compress()', () => {
      const result = compress(Buffer.from([1, 2, 3]));
      assert.ok(Buffer.isBuffer(result), 'expected a Buffer');
    });

    it('round-trips an arbitrary buffer', () => {
      const original = Buffer.from('hello world');
      assert.deepEqual(decompress(compress(original)), original);
    });

    it('round-trips an empty buffer', () => {
      const original = Buffer.alloc(0);
      assert.deepEqual(decompress(compress(original)), original);
    });

    it('round-trips a binary buffer', () => {
      const original = Buffer.from([0x00, 0xff, 0x7f, 0x80, 0xde, 0xad]);
      assert.deepEqual(decompress(compress(original)), original);
    });

    it('produces a smaller buffer for highly repetitive data', () => {
      const repetitive = Buffer.alloc(1000, 0x41); // 1000 × 'A'
      const compressed = compress(repetitive);
      assert.ok(
        compressed.length < repetitive.length,
        `expected compressed (${compressed.length}) < original (${repetitive.length})`
      );
    });

    it('throws when decompressing non-gzip data', () => {
      assert.throws(() => decompress(Buffer.from([0xde, 0xad, 0xbe, 0xef])), Error);
    });
  });

  describe('encodeCompressed() / decodeCompressed()', () => {
    it('round-trips null', () => {
      assert.equal(decodeCompressed(encodeCompressed(null)), null);
    });

    it('round-trips a number', () => {
      assert.equal(decodeCompressed(encodeCompressed(42)), 42);
    });

    it('round-trips a string', () => {
      assert.equal(decodeCompressed(encodeCompressed('hello HRBP')), 'hello HRBP');
    });

    it('round-trips a nested object', () => {
      const obj = { user: { name: 'Alice', age: 30 }, active: true };
      assert.deepEqual(decodeCompressed(encodeCompressed(obj)), obj);
    });

    it('round-trips an array', () => {
      const arr = [1, 2, 3, 'four', null, true];
      assert.deepEqual(decodeCompressed(encodeCompressed(arr)), arr);
    });

    it('encodeCompressed returns a Buffer', () => {
      assert.ok(Buffer.isBuffer(encodeCompressed(42)));
    });

    it('produces a different (compressed) buffer than plain encode()', () => {
      // Compressed output will differ from raw HRBP bytes
      const raw = encode(42);
      const compressed = encodeCompressed(42);
      assert.notDeepEqual(compressed, raw);
    });

    it('compressed size is smaller than raw for a large repetitive object', () => {
      const obj = {};
      for (let i = 0; i < 50; i++) obj[`field_${i}`] = 'value_repeated';
      const raw = encode(obj);
      const compressed = encodeCompressed(obj);
      assert.ok(
        compressed.length < raw.length,
        `expected compressed (${compressed.length}) < raw (${raw.length})`
      );
    });
  });
});
