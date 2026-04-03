'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validate, encodeWithSchema, decodeWithSchema } = require('../src/schema');
const { encode } = require('../src/encoder');

describe('schema', () => {
  // ─── Primitive validation ────────────────────────────────────────────────

  describe('validate() – primitives', () => {
    it('accepts an integer for "int"', () => {
      assert.doesNotThrow(() => validate(42, 'int'));
    });

    it('rejects a float for "int"', () => {
      assert.throws(() => validate(3.14, 'int'), TypeError);
    });

    it('rejects a string for "int"', () => {
      assert.throws(() => validate('42', 'int'), TypeError);
    });

    it('accepts any number for "float"', () => {
      assert.doesNotThrow(() => validate(3.14, 'float'));
      assert.doesNotThrow(() => validate(0, 'float'));
      assert.doesNotThrow(() => validate(NaN, 'float'));
      assert.doesNotThrow(() => validate(Infinity, 'float'));
    });

    it('rejects a non-number for "float"', () => {
      assert.throws(() => validate('3.14', 'float'), TypeError);
    });

    it('"number" is an alias for "float"', () => {
      assert.doesNotThrow(() => validate(1.5, 'number'));
      assert.throws(() => validate('1.5', 'number'), TypeError);
    });

    it('accepts a string for "string"', () => {
      assert.doesNotThrow(() => validate('hello', 'string'));
    });

    it('rejects a non-string for "string"', () => {
      assert.throws(() => validate(42, 'string'), TypeError);
    });

    it('accepts true/false for "boolean"', () => {
      assert.doesNotThrow(() => validate(true, 'boolean'));
      assert.doesNotThrow(() => validate(false, 'boolean'));
    });

    it('rejects a non-boolean for "boolean"', () => {
      assert.throws(() => validate(1, 'boolean'), TypeError);
    });

    it('accepts null for "null"', () => {
      assert.doesNotThrow(() => validate(null, 'null'));
    });

    it('rejects a non-null for "null"', () => {
      assert.throws(() => validate(0, 'null'), TypeError);
    });

    it('accepts a Buffer for "buffer"', () => {
      assert.doesNotThrow(() => validate(Buffer.from([1, 2]), 'buffer'));
    });

    it('rejects a non-Buffer for "buffer"', () => {
      assert.throws(() => validate([1, 2], 'buffer'), TypeError);
    });

    it('throws on an unknown primitive type', () => {
      assert.throws(() => validate(42, 'bigint'), TypeError);
    });
  });

  // ─── Array schema ────────────────────────────────────────────────────────

  describe('validate() – array schema', () => {
    it('accepts an array of ints', () => {
      assert.doesNotThrow(() => validate([1, 2, 3], { type: 'array', items: 'int' }));
    });

    it('rejects when an element fails the items schema', () => {
      assert.throws(() => validate([1, 'two', 3], { type: 'array', items: 'int' }), TypeError);
    });

    it('accepts an empty array', () => {
      assert.doesNotThrow(() => validate([], { type: 'array', items: 'int' }));
    });

    it('accepts array without items schema (no element checking)', () => {
      assert.doesNotThrow(() => validate([1, 'two', true], { type: 'array' }));
    });

    it('rejects a non-array', () => {
      assert.throws(() => validate('not-array', { type: 'array', items: 'int' }), TypeError);
    });

    it('includes the element index in the error path', () => {
      let err;
      try { validate([1, 'x'], { type: 'array', items: 'int' }); } catch (e) { err = e; }
      assert.ok(err instanceof TypeError);
      assert.ok(err.message.includes('[1]'), `expected "[1]" in: ${err.message}`);
    });
  });

  // ─── Object schema ───────────────────────────────────────────────────────

  describe('validate() – object schema', () => {
    const userSchema = {
      type: 'object',
      fields: { id: 'int', name: 'string' },
    };

    it('accepts a valid object', () => {
      assert.doesNotThrow(() => validate({ id: 1, name: 'Alice' }, userSchema));
    });

    it('rejects a missing required field', () => {
      assert.throws(() => validate({ id: 1 }, userSchema), TypeError);
    });

    it('rejects a field of the wrong type', () => {
      assert.throws(() => validate({ id: 1.5, name: 'Alice' }, userSchema), TypeError);
    });

    it('accepts extra fields not listed in fields', () => {
      assert.doesNotThrow(() => validate({ id: 1, name: 'Alice', extra: true }, userSchema));
    });

    it('honours an explicit required list', () => {
      const schema = { type: 'object', fields: { id: 'int', name: 'string' }, required: ['id'] };
      assert.doesNotThrow(() => validate({ id: 1 }, schema)); // name not required
    });

    it('rejects a non-object', () => {
      assert.throws(() => validate([1, 2], userSchema), TypeError);
    });

    it('includes the field name in the error path', () => {
      let err;
      try { validate({ id: 'bad', name: 'Alice' }, userSchema); } catch (e) { err = e; }
      assert.ok(err instanceof TypeError);
      assert.ok(err.message.includes('.id'), `expected ".id" in: ${err.message}`);
    });

    it('throws on an unknown schema type', () => {
      assert.throws(() => validate(42, { type: 'bigint' }), TypeError);
    });

    it('throws on an invalid schema definition', () => {
      assert.throws(() => validate(42, 123), TypeError);
    });
  });

  // ─── encodeWithSchema ────────────────────────────────────────────────────

  describe('encodeWithSchema()', () => {
    it('returns the same buffer as encode() for a valid value', () => {
      const buf = encodeWithSchema(42, 'int');
      assert.deepEqual(buf, encode(42));
    });

    it('throws before encoding if validation fails', () => {
      assert.throws(() => encodeWithSchema('not-an-int', 'int'), TypeError);
    });
  });

  // ─── decodeWithSchema ────────────────────────────────────────────────────

  describe('decodeWithSchema()', () => {
    it('returns the decoded value when it matches the schema', () => {
      assert.equal(decodeWithSchema(encode(42), 'int'), 42);
    });

    it('throws after decoding if the decoded value fails validation', () => {
      // Encode a float, but try to decode it as int
      assert.throws(() => decodeWithSchema(encode(3.14), 'int'), TypeError);
    });

    it('round-trips an object through encodeWithSchema / decodeWithSchema', () => {
      const schema = { type: 'object', fields: { id: 'int', name: 'string' } };
      const value = { id: 7, name: 'Bob' };
      const decoded = decodeWithSchema(encodeWithSchema(value, schema), schema);
      assert.deepEqual(decoded, value);
    });
  });
});
