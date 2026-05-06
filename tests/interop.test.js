'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { encode, decode } = require('../src');
const { jsonToHRBP, hrbpToJSON } = require('../src/interop/json');
const {
  msgpackValueToHRBP,
  hrbpToMsgpackValue,
  createMsgpackBridge,
} = require('../src/interop/msgpack');
const {
  protobufValueToHRBP,
  hrbpToProtobufValue,
} = require('../src/interop/protobuf');

// ---------------------------------------------------------------------------
// JSON ↔ HRBP bridge
// ---------------------------------------------------------------------------

describe('interop: JSON bridge', () => {
  describe('jsonToHRBP', () => {
    it('encodes a JSON string of an object', () => {
      const buf = jsonToHRBP('{"name":"Alice","age":30}');
      assert.ok(Buffer.isBuffer(buf));
      const val = decode(buf);
      assert.deepEqual(val, { name: 'Alice', age: 30 });
    });

    it('encodes a JSON string of an array', () => {
      const buf = jsonToHRBP('[1,2,3]');
      assert.deepEqual(decode(buf), [1, 2, 3]);
    });

    it('encodes a JSON string of a primitive', () => {
      assert.equal(decode(jsonToHRBP('"hello"')), 'hello');
      assert.equal(decode(jsonToHRBP('42')), 42);
      assert.equal(decode(jsonToHRBP('true')), true);
      assert.equal(decode(jsonToHRBP('null')), null);
    });

    it('accepts a pre-parsed JS value (not a string)', () => {
      const buf = jsonToHRBP({ x: 1 });
      assert.deepEqual(decode(buf), { x: 1 });
    });

    it('throws SyntaxError for invalid JSON string', () => {
      assert.throws(() => jsonToHRBP('{bad json}'), SyntaxError);
    });

    it('error message begins with jsonToHRBP:', () => {
      try {
        jsonToHRBP('{bad}');
      } catch (e) {
        assert.ok(e.message.startsWith('jsonToHRBP:'));
      }
    });
  });

  describe('hrbpToJSON', () => {
    it('converts an HRBP buffer to a compact JSON string', () => {
      const buf = encode({ name: 'Alice', age: 30 });
      const json = hrbpToJSON(buf);
      assert.equal(json, '{"name":"Alice","age":30}');
    });

    it('produces pretty JSON when pretty=true', () => {
      const buf = encode({ a: 1 });
      const json = hrbpToJSON(buf, true);
      assert.ok(json.includes('\n'));
      assert.deepEqual(JSON.parse(json), { a: 1 });
    });

    it('round-trips through encode→hrbpToJSON→JSON.parse', () => {
      const original = { items: [1, 'two', true, null], nested: { x: 3.14 } };
      const buf = encode(original);
      const parsed = JSON.parse(hrbpToJSON(buf));
      assert.deepEqual(parsed, original);
    });

    it('throws TypeError for non-Buffer input', () => {
      assert.throws(() => hrbpToJSON('not a buffer'), TypeError);
    });

    it('propagates RangeError for malformed HRBP', () => {
      assert.throws(() => hrbpToJSON(Buffer.from([0xff])), RangeError);
    });
  });
});

// ---------------------------------------------------------------------------
// MessagePack value bridge (codec-free helpers)
// ---------------------------------------------------------------------------

describe('interop: MessagePack value bridge', () => {
  describe('msgpackValueToHRBP', () => {
    it('encodes a plain JS object', () => {
      const buf = msgpackValueToHRBP({ hello: 'world' });
      assert.deepEqual(decode(buf), { hello: 'world' });
    });

    it('converts Uint8Array to HRBP BUFFER type', () => {
      const ua = new Uint8Array([0x01, 0x02, 0x03]);
      const buf = msgpackValueToHRBP(ua);
      const val = decode(buf);
      assert.ok(Buffer.isBuffer(val));
      assert.deepEqual([...val], [0x01, 0x02, 0x03]);
    });

    it('handles nested Uint8Arrays', () => {
      const val = { data: new Uint8Array([0xde, 0xad]) };
      const buf = msgpackValueToHRBP(val);
      const result = decode(buf);
      assert.ok(Buffer.isBuffer(result.data));
    });
  });

  describe('hrbpToMsgpackValue', () => {
    it('decodes an HRBP buffer to a plain JS value', () => {
      const buf = encode({ x: 42 });
      assert.deepEqual(hrbpToMsgpackValue(buf), { x: 42 });
    });

    it('throws TypeError for non-Buffer', () => {
      assert.throws(() => hrbpToMsgpackValue('oops'), TypeError);
    });
  });

  describe('round-trip (value level)', () => {
    it('round-trips a complex object without a codec', () => {
      const original = { nums: [1, 2, 3], str: 'ok', flag: true, nil: null };
      const buf = msgpackValueToHRBP(original);
      assert.deepEqual(hrbpToMsgpackValue(buf), original);
    });
  });
});

// ---------------------------------------------------------------------------
// createMsgpackBridge (full bridge with codec)
// ---------------------------------------------------------------------------

describe('interop: createMsgpackBridge', () => {
  // Build a minimal in-process mock codec so the test has no external deps.
  const mockCodec = {
    encode(value) {
      // Store as JSON bytes for testing purposes.
      return Buffer.from(JSON.stringify(value), 'utf8');
    },
    decode(buf) {
      return JSON.parse(Buffer.from(buf).toString('utf8'));
    },
  };

  it('creates a bridge with a valid codec', () => {
    const bridge = createMsgpackBridge(mockCodec);
    assert.equal(typeof bridge.msgpackToHRBP, 'function');
    assert.equal(typeof bridge.hrbpToMsgpack, 'function');
  });

  it('throws TypeError for invalid codec', () => {
    assert.throws(() => createMsgpackBridge(null), TypeError);
    assert.throws(() => createMsgpackBridge({}), TypeError);
    assert.throws(() => createMsgpackBridge({ encode: () => {} }), TypeError);
  });

  it('msgpackToHRBP converts codec output to HRBP buffer', () => {
    const bridge = createMsgpackBridge(mockCodec);
    const mpBuf = mockCodec.encode({ val: 99 });
    const hrbpBuf = bridge.msgpackToHRBP(mpBuf);
    assert.deepEqual(decode(hrbpBuf), { val: 99 });
  });

  it('hrbpToMsgpack converts HRBP buffer through codec', () => {
    const bridge = createMsgpackBridge(mockCodec);
    const hrbpBuf = encode({ val: 99 });
    const out = bridge.hrbpToMsgpack(hrbpBuf);
    assert.deepEqual(mockCodec.decode(out), { val: 99 });
  });

  it('hrbpToMsgpack throws TypeError for non-Buffer', () => {
    const bridge = createMsgpackBridge(mockCodec);
    assert.throws(() => bridge.hrbpToMsgpack('x'), TypeError);
  });

  it('msgpackToHRBP wraps codec decode errors as RangeError', () => {
    const badCodec = { encode: () => Buffer.alloc(0), decode: () => { throw new Error('bad'); } };
    const bridge = createMsgpackBridge(badCodec);
    assert.throws(() => bridge.msgpackToHRBP(Buffer.from('x')), RangeError);
  });
});

// ---------------------------------------------------------------------------
// Protobuf value bridge
// ---------------------------------------------------------------------------

describe('interop: Protobuf value bridge', () => {
  describe('protobufValueToHRBP', () => {
    it('encodes a plain object (protobuf toObject result)', () => {
      const obj = { userId: 1, name: 'Bob', active: true };
      const buf = protobufValueToHRBP(obj);
      assert.deepEqual(decode(buf), obj);
    });

    it('converts Uint8Array bytes fields to HRBP BUFFER', () => {
      const obj = { data: new Uint8Array([0xca, 0xfe]) };
      const buf = protobufValueToHRBP(obj);
      const result = decode(buf);
      assert.ok(Buffer.isBuffer(result.data));
      assert.deepEqual([...result.data], [0xca, 0xfe]);
    });

    it('converts protobufjs Long-like objects to number', () => {
      const longLike = { low: 42, high: 0, toNumber: () => 42 };
      const buf = protobufValueToHRBP(longLike);
      assert.equal(decode(buf), 42);
    });

    it('converts bigint to number', () => {
      const buf = protobufValueToHRBP(BigInt(123));
      assert.equal(decode(buf), 123);
    });

    it('handles null/undefined as HRBP null', () => {
      assert.equal(decode(protobufValueToHRBP(null)), null);
      assert.equal(decode(protobufValueToHRBP(undefined)), null);
    });

    it('handles nested objects and arrays', () => {
      const obj = { items: [1, 2, 3], meta: { version: 1 } };
      const buf = protobufValueToHRBP(obj);
      assert.deepEqual(decode(buf), obj);
    });
  });

  describe('hrbpToProtobufValue', () => {
    it('decodes an HRBP buffer to a plain JS value', () => {
      const buf = encode({ userId: 7 });
      assert.deepEqual(hrbpToProtobufValue(buf), { userId: 7 });
    });

    it('throws TypeError for non-Buffer', () => {
      assert.throws(() => hrbpToProtobufValue(123), TypeError);
      assert.throws(() => hrbpToProtobufValue('x'), TypeError);
    });

    it('propagates RangeError for malformed HRBP', () => {
      assert.throws(() => hrbpToProtobufValue(Buffer.from([0xfe, 0xed])), RangeError);
    });
  });

  describe('round-trip', () => {
    it('round-trips a representative Protobuf-style plain object', () => {
      const original = {
        id: 1001,
        name: 'Service',
        tags: ['alpha', 'beta'],
        metadata: { region: 'us-east-1', priority: 3 },
        enabled: true,
      };
      const buf = protobufValueToHRBP(original);
      const result = hrbpToProtobufValue(buf);
      assert.deepEqual(result, original);
    });
  });
});

// ---------------------------------------------------------------------------
// Public entrypoint exports bridges
// ---------------------------------------------------------------------------

describe('interop: public entrypoint exports', () => {
  const hrbp = require('../src');
  it('exports jsonToHRBP and hrbpToJSON', () => {
    assert.equal(typeof hrbp.jsonToHRBP, 'function');
    assert.equal(typeof hrbp.hrbpToJSON, 'function');
  });
  it('exports msgpack bridge helpers', () => {
    assert.equal(typeof hrbp.msgpackValueToHRBP, 'function');
    assert.equal(typeof hrbp.hrbpToMsgpackValue, 'function');
    assert.equal(typeof hrbp.createMsgpackBridge, 'function');
  });
  it('exports protobuf bridge helpers', () => {
    assert.equal(typeof hrbp.protobufValueToHRBP, 'function');
    assert.equal(typeof hrbp.hrbpToProtobufValue, 'function');
  });
});
