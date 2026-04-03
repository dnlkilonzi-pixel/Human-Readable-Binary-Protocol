'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { encode } = require('../src/encoder');
const { decode, decodeAll } = require('../src/decoder');

describe('decoder', () => {
  /**
   * Round-trip helper: encode then decode, assert deep equality.
   */
  function roundTrip(value) {
    return decode(encode(value));
  }

  describe('null', () => {
    it('round-trips null', () => {
      assert.equal(roundTrip(null), null);
    });
  });

  describe('boolean', () => {
    it('round-trips true', () => assert.equal(roundTrip(true), true));
    it('round-trips false', () => assert.equal(roundTrip(false), false));
  });

  describe('number', () => {
    it('round-trips zero', () => assert.equal(roundTrip(0), 0));
    it('round-trips a positive integer', () => assert.equal(roundTrip(42), 42));
    it('round-trips a negative integer', () => assert.equal(roundTrip(-1), -1));
    it('round-trips INT32_MIN', () => assert.equal(roundTrip(-2147483648), -2147483648));
    it('round-trips INT32_MAX', () => assert.equal(roundTrip(2147483647), 2147483647));
    it('round-trips a float', () => {
      const val = roundTrip(3.14);
      assert.ok(Math.abs(val - 3.14) < 1e-12);
    });
    it('round-trips a large integer (encoded as FLOAT)', () => {
      assert.equal(roundTrip(2147483648), 2147483648);
    });
    it('round-trips -0 as FLOAT', () => {
      const val = roundTrip(-0);
      assert.ok(Object.is(val, -0) || val === 0); // -0 is encoded as float
    });
  });

  describe('string', () => {
    it('round-trips an empty string', () => assert.equal(roundTrip(''), ''));
    it('round-trips a simple string', () => assert.equal(roundTrip('hello'), 'hello'));
    it('round-trips a UTF-8 string', () => assert.equal(roundTrip('héllo 🌍'), 'héllo 🌍'));
    it('round-trips a string with special chars', () => {
      assert.equal(roundTrip('line1\nline2\ttab'), 'line1\nline2\ttab');
    });
  });

  describe('Buffer', () => {
    it('round-trips an empty Buffer', () => {
      const result = roundTrip(Buffer.alloc(0));
      assert.ok(Buffer.isBuffer(result));
      assert.equal(result.length, 0);
    });

    it('round-trips a non-empty Buffer', () => {
      const input = Buffer.from([0x01, 0x02, 0x03]);
      const result = roundTrip(input);
      assert.ok(Buffer.isBuffer(result));
      assert.deepEqual(result, input);
    });
  });

  describe('Array', () => {
    it('round-trips an empty array', () => {
      assert.deepEqual(roundTrip([]), []);
    });

    it('round-trips an array of integers', () => {
      assert.deepEqual(roundTrip([1, 2, 3]), [1, 2, 3]);
    });

    it('round-trips a mixed-type array', () => {
      assert.deepEqual(roundTrip([1, 'two', true, null]), [1, 'two', true, null]);
    });

    it('round-trips nested arrays', () => {
      assert.deepEqual(roundTrip([[1, 2], [3, 4]]), [[1, 2], [3, 4]]);
    });
  });

  describe('Object', () => {
    it('round-trips an empty object', () => {
      assert.deepEqual(roundTrip({}), {});
    });

    it('round-trips a simple object', () => {
      assert.deepEqual(roundTrip({ a: 1, b: 'hello' }), { a: 1, b: 'hello' });
    });

    it('round-trips a nested object', () => {
      const obj = { user: { name: 'Alice', age: 30 }, active: true };
      assert.deepEqual(roundTrip(obj), obj);
    });

    it('round-trips an object with array values', () => {
      const obj = { tags: ['js', 'binary', 'protocol'] };
      assert.deepEqual(roundTrip(obj), obj);
    });
  });

  describe('decodeAll', () => {
    it('decodes multiple values packed sequentially', () => {
      const buf = Buffer.concat([encode(1), encode('hello'), encode(true)]);
      const values = decodeAll(buf);
      assert.deepEqual(values, [1, 'hello', true]);
    });

    it('returns an empty array for an empty buffer', () => {
      assert.deepEqual(decodeAll(Buffer.alloc(0)), []);
    });
  });

  describe('error handling', () => {
    it('throws RangeError for an unknown tag byte', () => {
      const buf = Buffer.from([0xff]);
      assert.throws(() => decode(buf), RangeError);
    });

    it('throws RangeError when buffer is truncated mid-integer', () => {
      const buf = Buffer.from([0x49, 0x00]); // INT32 tag but only 2 bytes of payload
      assert.throws(() => decode(buf), RangeError);
    });

    it('throws RangeError when buffer is truncated mid-string', () => {
      // STRING tag, length says 100 but no bytes follow
      const buf = Buffer.alloc(5);
      buf[0] = 0x53; // TAG.STRING
      buf.writeUInt32BE(100, 1);
      assert.throws(() => decode(buf), RangeError);
    });

    it('throws RangeError for an empty buffer', () => {
      assert.throws(() => decode(Buffer.alloc(0)), RangeError);
    });
  });
});
