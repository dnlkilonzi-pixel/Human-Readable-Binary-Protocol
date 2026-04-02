'use strict';

/**
 * HRBP Message Signing
 *
 * Optional HMAC-based message signing for integrity verification.
 * Uses Node's built-in `crypto` module — no external dependencies.
 *
 * Usage:
 *
 *   const { createSigner, createVerifier } = require('./security/signing');
 *
 *   const sign   = createSigner('my-shared-secret');
 *   const verify = createVerifier('my-shared-secret');
 *
 *   const signed = sign(encodedBuffer);  // → Buffer with appended HMAC
 *   const { payload, valid } = verify(signed);
 */

const crypto = require('crypto');

const HMAC_SIZE = 32; // SHA-256 produces 32 bytes
const DEFAULT_ALGORITHM = 'sha256';

/**
 * Create a signing function that appends an HMAC to HRBP payloads.
 *
 * @param {string|Buffer} secret     Shared secret for HMAC.
 * @param {string}        [algo]     Hash algorithm (default: 'sha256').
 * @returns {Function}  `(buf: Buffer) => Buffer` — returns `[payload][32-byte HMAC]`.
 */
function createSigner(secret, algo = DEFAULT_ALGORITHM) {
  return function sign(buf) {
    const hmac = crypto.createHmac(algo, secret).update(buf).digest();
    return Buffer.concat([buf, hmac]);
  };
}

/**
 * Create a verification function that checks the appended HMAC.
 *
 * @param {string|Buffer} secret     Shared secret for HMAC.
 * @param {string}        [algo]     Hash algorithm (default: 'sha256').
 * @returns {Function}  `(buf: Buffer) => { payload: Buffer, valid: boolean }`
 */
function createVerifier(secret, algo = DEFAULT_ALGORITHM) {
  return function verify(buf) {
    if (buf.length < HMAC_SIZE) {
      return { payload: buf, valid: false };
    }

    const payload = buf.slice(0, buf.length - HMAC_SIZE);
    const receivedHmac = buf.slice(buf.length - HMAC_SIZE);
    const expectedHmac = crypto.createHmac(algo, secret).update(payload).digest();

    const valid = crypto.timingSafeEqual(receivedHmac, expectedHmac);
    return { payload, valid };
  };
}

module.exports = { createSigner, createVerifier, HMAC_SIZE };
