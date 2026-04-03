'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { encode } = require('../src/encoder');
const { inspect, hexDump } = require('../src/inspector');

describe('inspector', () => {
  describe('inspect()', () => {
    it('shows null', () => {
      const out = inspect(encode(null));
      assert.ok(out.includes('N'), `expected "N" in: ${out}`);
      assert.ok(out.includes('null'), `expected "null" in: ${out}`);
    });

    it('shows true', () => {
      const out = inspect(encode(true));
      assert.ok(out.includes('T'), `expected "T" in: ${out}`);
      assert.ok(out.includes('true'), `expected "true" in: ${out}`);
    });

    it('shows false', () => {
      const out = inspect(encode(false));
      assert.ok(out.includes('X'), `expected "X" in: ${out}`);
      assert.ok(out.includes('false'), `expected "false" in: ${out}`);
    });

    it('shows an integer with tag I', () => {
      const out = inspect(encode(42));
      assert.ok(out.includes('I'), `expected "I" in: ${out}`);
      assert.ok(out.includes('42'), `expected "42" in: ${out}`);
    });

    it('shows a float with tag F', () => {
      const out = inspect(encode(3.14));
      assert.ok(out.includes('F'), `expected "F" in: ${out}`);
      assert.ok(out.includes('3.14'), `expected "3.14" in: ${out}`);
    });

    it('shows a string with byte length', () => {
      const out = inspect(encode('hello'));
      assert.ok(out.includes('S(5)'), `expected "S(5)" in: ${out}`);
      assert.ok(out.includes('"hello"'), `expected '"hello"' in: ${out}`);
    });

    it('shows a Buffer with its length', () => {
      const out = inspect(encode(Buffer.from([0xab, 0xcd])));
      assert.ok(out.includes('B(2)'), `expected "B(2)" in: ${out}`);
      assert.ok(out.includes('ab'), `expected "ab" in: ${out}`);
    });

    it('shows an array with element count', () => {
      const out = inspect(encode([1, 2, 3]));
      assert.ok(out.includes('[ (3 elements)'), `expected "[ (3 elements)" in: ${out}`);
      assert.ok(out.includes(']'), `expected "]" in: ${out}`);
    });

    it('uses singular "element" for a 1-element array', () => {
      const out = inspect(encode([99]));
      assert.ok(out.includes('(1 element)'), `expected "(1 element)" in: ${out}`);
    });

    it('shows an object with pair count', () => {
      const out = inspect(encode({ a: 1 }));
      assert.ok(out.includes('{ (1 pair)'), `expected "{ (1 pair)" in: ${out}`);
      assert.ok(out.includes('}'), `expected "}" in: ${out}`);
    });

    it('shows nested structure with indentation', () => {
      const out = inspect(encode({ x: [1, 2] }));
      // Should have nested indentation
      const lines = out.split('\n');
      assert.ok(lines.length > 3, 'expected multiple lines for nested value');
    });

    it('escapes special characters in strings', () => {
      const out = inspect(encode('line1\nline2'));
      assert.ok(out.includes('\\n'), `expected escaped newline in: ${out}`);
    });

    it('accepts custom indent option', () => {
      const out = inspect(encode({ a: 1 }), { indent: 4 });
      // With indent 4, nested content should be indented with 4 spaces per level
      const lines = out.split('\n');
      const indentedLine = lines.find((l) => l.startsWith('    '));
      assert.ok(indentedLine, `expected 4-space indented line in:\n${out}`);
    });
  });

  describe('hexDump()', () => {
    it('returns an empty string for an empty buffer', () => {
      assert.equal(hexDump(Buffer.alloc(0)), '');
    });

    it('shows the offset, hex bytes, and ASCII column', () => {
      const buf = encode('hi');
      const out = hexDump(buf);
      // Offset column
      assert.ok(out.includes('00000000'), `expected offset in: ${out}`);
      // ASCII column delimiters
      assert.ok(out.includes('|'), `expected | delimiter in: ${out}`);
      // 'S' type tag appears as 'S' in the ASCII column
      assert.ok(out.includes('S'), `expected "S" tag character in: ${out}`);
    });

    it('wraps to a new row after bytesPerRow bytes', () => {
      const buf = Buffer.alloc(32);
      const out = hexDump(buf, { bytesPerRow: 16 });
      const lines = out.split('\n');
      assert.equal(lines.length, 2, 'expected 2 rows for 32 bytes at 16 per row');
    });

    it('accepts custom bytesPerRow option', () => {
      const buf = Buffer.alloc(8);
      const out = hexDump(buf, { bytesPerRow: 4 });
      const lines = out.split('\n');
      assert.equal(lines.length, 2, 'expected 2 rows for 8 bytes at 4 per row');
    });
  });
});
