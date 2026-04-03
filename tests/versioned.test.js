'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { encodeVersioned, decodeVersioned, CURRENT_VERSION, MAX_SUPPORTED_VERSION } = require('../src/versioned');
const { TAG } = require('../src/types');

describe('versioned', () => {
  describe('encodeVersioned()', () => {
    it('starts with the HEADER tag byte (0x48 / "H")', () => {
      const buf = encodeVersioned(42);
      assert.equal(buf[0], TAG.HEADER);
      assert.equal(buf[0], 0x48);
    });

    it('embeds the current version by default', () => {
      const buf = encodeVersioned(42);
      assert.equal(buf[1], CURRENT_VERSION);
    });

    it('embeds a custom version when provided', () => {
      const buf = encodeVersioned(42, 2);
      assert.equal(buf[1], 2);
    });

    it('produces a buffer longer than just the header', () => {
      const buf = encodeVersioned('hello');
      assert.ok(buf.length > 2, 'expected payload bytes after the header');
    });

    it('throws RangeError for a negative version', () => {
      assert.throws(() => encodeVersioned(42, -1), RangeError);
    });

    it('throws RangeError for a version > 255', () => {
      assert.throws(() => encodeVersioned(42, 256), RangeError);
    });

    it('throws RangeError for a non-integer version', () => {
      assert.throws(() => encodeVersioned(42, 1.5), RangeError);
    });
  });

  describe('decodeVersioned()', () => {
    it('decodes a null value', () => {
      const { version, value } = decodeVersioned(encodeVersioned(null));
      assert.equal(version, CURRENT_VERSION);
      assert.equal(value, null);
    });

    it('decodes a number', () => {
      const { version, value } = decodeVersioned(encodeVersioned(99));
      assert.equal(version, CURRENT_VERSION);
      assert.equal(value, 99);
    });

    it('decodes a string', () => {
      const { version, value } = decodeVersioned(encodeVersioned('hello'));
      assert.equal(version, CURRENT_VERSION);
      assert.equal(value, 'hello');
    });

    it('decodes a nested object', () => {
      const obj = { a: 1, b: [true, false] };
      const { value } = decodeVersioned(encodeVersioned(obj));
      assert.deepEqual(value, obj);
    });

    it('returns the embedded version number', () => {
      const buf = encodeVersioned('test', 1);
      const { version } = decodeVersioned(buf);
      assert.equal(version, 1);
    });

    it('throws RangeError when buffer is too short', () => {
      assert.throws(() => decodeVersioned(Buffer.from([TAG.HEADER])), RangeError);
    });

    it('throws RangeError when first byte is not the HEADER tag', () => {
      const buf = Buffer.from([0x00, 0x01, 0x4e]); // not 'H'
      assert.throws(() => decodeVersioned(buf), RangeError);
    });

    it('throws RangeError for an unsupported (future) version', () => {
      const buf = Buffer.from([TAG.HEADER, MAX_SUPPORTED_VERSION + 1, 0x4e]);
      assert.throws(() => decodeVersioned(buf), RangeError);
    });

    it('throws RangeError for an empty buffer', () => {
      assert.throws(() => decodeVersioned(Buffer.alloc(0)), RangeError);
    });
  });

  describe('round-trip', () => {
    const values = [null, true, false, 0, -1, 3.14, 'hi', [], {}, [1, 'two', null]];
    for (const v of values) {
      it(`round-trips ${JSON.stringify(v)}`, () => {
        const { value } = decodeVersioned(encodeVersioned(v));
        assert.deepEqual(value, v);
      });
    }
  });
});
