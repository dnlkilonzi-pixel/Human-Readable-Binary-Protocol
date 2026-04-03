'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { encode } = require('../src/encoder');
const { TAG } = require('../src/types');

describe('encoder', () => {
  describe('null / undefined', () => {
    it('encodes null as a single NULL tag byte', () => {
      const buf = encode(null);
      assert.equal(buf.length, 1);
      assert.equal(buf[0], TAG.NULL);
    });

    it('encodes undefined as NULL', () => {
      const buf = encode(undefined);
      assert.equal(buf[0], TAG.NULL);
    });
  });

  describe('boolean', () => {
    it('encodes true', () => {
      const buf = encode(true);
      assert.equal(buf.length, 1);
      assert.equal(buf[0], TAG.TRUE);
    });

    it('encodes false', () => {
      const buf = encode(false);
      assert.equal(buf.length, 1);
      assert.equal(buf[0], TAG.FALSE);
    });
  });

  describe('number', () => {
    it('encodes zero as INT32', () => {
      const buf = encode(0);
      assert.equal(buf.length, 5);
      assert.equal(buf[0], TAG.INT32);
      assert.equal(buf.readInt32BE(1), 0);
    });

    it('encodes a positive integer as INT32', () => {
      const buf = encode(42);
      assert.equal(buf[0], TAG.INT32);
      assert.equal(buf.readInt32BE(1), 42);
    });

    it('encodes a negative integer as INT32', () => {
      const buf = encode(-100);
      assert.equal(buf[0], TAG.INT32);
      assert.equal(buf.readInt32BE(1), -100);
    });

    it('encodes INT32_MIN correctly', () => {
      const buf = encode(-2147483648);
      assert.equal(buf[0], TAG.INT32);
      assert.equal(buf.readInt32BE(1), -2147483648);
    });

    it('encodes INT32_MAX correctly', () => {
      const buf = encode(2147483647);
      assert.equal(buf[0], TAG.INT32);
      assert.equal(buf.readInt32BE(1), 2147483647);
    });

    it('encodes a float as FLOAT', () => {
      const buf = encode(3.14);
      assert.equal(buf.length, 9);
      assert.equal(buf[0], TAG.FLOAT);
      assert.ok(Math.abs(buf.readDoubleBE(1) - 3.14) < 1e-12);
    });

    it('encodes a number outside int32 range as FLOAT', () => {
      const bigInt = 2147483648; // INT32_MAX + 1
      const buf = encode(bigInt);
      assert.equal(buf[0], TAG.FLOAT);
      assert.equal(buf.readDoubleBE(1), bigInt);
    });

    it('encodes NaN as FLOAT', () => {
      const buf = encode(NaN);
      assert.equal(buf[0], TAG.FLOAT);
      assert.ok(Number.isNaN(buf.readDoubleBE(1)));
    });

    it('encodes Infinity as FLOAT', () => {
      const buf = encode(Infinity);
      assert.equal(buf[0], TAG.FLOAT);
      assert.equal(buf.readDoubleBE(1), Infinity);
    });
  });

  describe('string', () => {
    it('encodes an empty string', () => {
      const buf = encode('');
      assert.equal(buf[0], TAG.STRING);
      assert.equal(buf.readUInt32BE(1), 0);
      assert.equal(buf.length, 5);
    });

    it('encodes an ASCII string', () => {
      const buf = encode('hello');
      assert.equal(buf[0], TAG.STRING);
      assert.equal(buf.readUInt32BE(1), 5);
      assert.equal(buf.toString('utf8', 5), 'hello');
    });

    it('encodes a UTF-8 multibyte string', () => {
      const str = 'héllo'; // é is 2 bytes in UTF-8
      const strBytes = Buffer.from(str, 'utf8');
      const buf = encode(str);
      assert.equal(buf[0], TAG.STRING);
      assert.equal(buf.readUInt32BE(1), strBytes.length);
      assert.equal(buf.toString('utf8', 5), str);
    });
  });

  describe('Buffer', () => {
    it('encodes an empty Buffer', () => {
      const input = Buffer.alloc(0);
      const buf = encode(input);
      assert.equal(buf[0], TAG.BUFFER);
      assert.equal(buf.readUInt32BE(1), 0);
      assert.equal(buf.length, 5);
    });

    it('encodes a non-empty Buffer', () => {
      const input = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
      const buf = encode(input);
      assert.equal(buf[0], TAG.BUFFER);
      assert.equal(buf.readUInt32BE(1), 4);
      assert.deepEqual(buf.slice(5), input);
    });
  });

  describe('Array', () => {
    it('encodes an empty array', () => {
      const buf = encode([]);
      assert.equal(buf[0], TAG.ARRAY);
      assert.equal(buf.readUInt32BE(1), 0);
      assert.equal(buf.length, 5);
    });

    it('encodes an array of mixed types', () => {
      const buf = encode([1, 'hi', true]);
      assert.equal(buf[0], TAG.ARRAY);
      assert.equal(buf.readUInt32BE(1), 3);
      // First element starts at offset 5
      assert.equal(buf[5], TAG.INT32);
    });
  });

  describe('Object', () => {
    it('encodes an empty object', () => {
      const buf = encode({});
      assert.equal(buf[0], TAG.OBJECT);
      assert.equal(buf.readUInt32BE(1), 0);
      assert.equal(buf.length, 5);
    });

    it('encodes an object with one string key', () => {
      const buf = encode({ x: 1 });
      assert.equal(buf[0], TAG.OBJECT);
      assert.equal(buf.readUInt32BE(1), 1); // 1 pair
      // Key starts at offset 5 → STRING tag
      assert.equal(buf[5], TAG.STRING);
    });
  });

  describe('error handling', () => {
    it('throws TypeError for unsupported types like function', () => {
      assert.throws(() => encode(() => {}), TypeError);
    });

    it('throws TypeError for Symbol', () => {
      assert.throws(() => encode(Symbol('x')), TypeError);
    });
  });
});
