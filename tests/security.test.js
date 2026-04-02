'use strict';

/**
 * Tests for HRBP Security: TLS, Auth middleware, Message signing
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// -- Auth middleware tests --
const { createAuthMiddleware, createRateLimiter } = require('../src/security/auth');

describe('createAuthMiddleware', () => {
  it('throws if neither token nor validate is provided', () => {
    assert.throws(
      () => createAuthMiddleware({}),
      (e) => /requires either/.test(e.message)
    );
  });

  it('rejects envelope without token', async () => {
    const auth = createAuthMiddleware({ token: 'secret' });
    const envelope = { type: 'call', id: 1, method: 'foo', params: {} };
    await assert.rejects(
      () => auth(envelope),
      (e) => /missing token/.test(e.message)
    );
  });

  it('rejects envelope with wrong token', async () => {
    const auth = createAuthMiddleware({ token: 'secret' });
    const envelope = { type: 'call', id: 1, method: 'foo', params: {}, token: 'wrong' };
    await assert.rejects(
      () => auth(envelope),
      (e) => /invalid token/.test(e.message)
    );
  });

  it('passes envelope with correct token', async () => {
    const auth = createAuthMiddleware({ token: 'secret' });
    const envelope = { type: 'call', id: 1, method: 'foo', params: {}, token: 'secret' };
    const result = await auth(envelope);
    assert.deepEqual(result, envelope);
  });

  it('passes non-call envelopes without checking', async () => {
    const auth = createAuthMiddleware({ token: 'secret' });
    const reply = { type: 'reply', id: 1, result: 42 };
    const result = await auth(reply);
    assert.deepEqual(result, reply);
  });

  it('supports custom validate function', async () => {
    const auth = createAuthMiddleware({
      validate: async (token, method) => token === 'custom-key' && method === 'allowed',
    });
    const good = { type: 'call', id: 1, method: 'allowed', params: {}, token: 'custom-key' };
    assert.deepEqual(await auth(good), good);

    const bad = { type: 'call', id: 2, method: 'denied', params: {}, token: 'custom-key' };
    await assert.rejects(
      () => auth(bad),
      (e) => /rejected by validator/.test(e.message)
    );
  });
});

describe('createRateLimiter', () => {
  it('allows calls within the limit', async () => {
    const limiter = createRateLimiter({ maxCallsPerSecond: 5 });
    const envelope = { type: 'call', id: 1, method: 'foo', params: {} };
    for (let i = 0; i < 5; i++) {
      const result = await limiter(envelope);
      assert.deepEqual(result, envelope);
    }
  });

  it('rejects calls exceeding the limit', async () => {
    const limiter = createRateLimiter({ maxCallsPerSecond: 2 });
    const envelope = { type: 'call', id: 1, method: 'foo', params: {} };
    await limiter(envelope);
    await limiter(envelope);
    await assert.rejects(
      () => limiter(envelope),
      (e) => /Rate limit exceeded/.test(e.message)
    );
  });

  it('passes non-call envelopes without rate limiting', async () => {
    const limiter = createRateLimiter({ maxCallsPerSecond: 1 });
    const reply = { type: 'reply', id: 1, result: 42 };
    const result = await limiter(reply);
    assert.deepEqual(result, reply);
  });
});

// -- Message signing tests --
const { createSigner, createVerifier, HMAC_SIZE } = require('../src/security/signing');

describe('Message Signing', () => {
  it('HMAC_SIZE is 32 (SHA-256)', () => {
    assert.equal(HMAC_SIZE, 32);
  });

  it('sign appends 32 bytes to the buffer', () => {
    const sign = createSigner('secret');
    const buf = Buffer.from('hello');
    const signed = sign(buf);
    assert.equal(signed.length, buf.length + 32);
  });

  it('verify returns valid=true for correctly signed buffer', () => {
    const sign = createSigner('secret');
    const verify = createVerifier('secret');
    const buf = Buffer.from('test data');
    const signed = sign(buf);
    const { payload, valid } = verify(signed);
    assert.equal(valid, true);
    assert.deepEqual(payload, buf);
  });

  it('verify returns valid=false for tampered buffer', () => {
    const sign = createSigner('secret');
    const verify = createVerifier('secret');
    const buf = Buffer.from('test data');
    const signed = sign(buf);
    signed[0] ^= 0xFF; // tamper
    const { valid } = verify(signed);
    assert.equal(valid, false);
  });

  it('verify returns valid=false for wrong secret', () => {
    const sign = createSigner('secret-A');
    const verify = createVerifier('secret-B');
    const buf = Buffer.from('data');
    const signed = sign(buf);
    const { valid } = verify(signed);
    assert.equal(valid, false);
  });

  it('verify returns valid=false for buffer shorter than HMAC_SIZE', () => {
    const verify = createVerifier('secret');
    const { valid } = verify(Buffer.alloc(10));
    assert.equal(valid, false);
  });
});
