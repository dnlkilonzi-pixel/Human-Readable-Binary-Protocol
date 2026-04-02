'use strict';

/**
 * HRBP RPC Protocol Helpers
 *
 * Defines the envelope format used by the HRBP RPC layer and the helper
 * functions to encode/decode each envelope type.
 *
 * RPC envelope objects:
 *
 *   Call:
 *     { type: 'call', id: <uint32>, method: <string>, params: <any> }
 *
 *   Reply:
 *     { type: 'reply', id: <uint32>, result: <any> }
 *
 *   Error reply:
 *     { type: 'error', id: <uint32>, message: <string> }
 *
 * All envelopes are encoded/decoded as plain HRBP objects.
 */

const { encode } = require('../encoder');
const { decode } = require('../decoder');

// ---------------------------------------------------------------------------
// Envelope constructors
// ---------------------------------------------------------------------------

/** @param {number} id @param {string} method @param {*} params */
function makeCall(id, method, params) {
  return { type: 'call', id, method, params };
}

/** @param {number} id @param {*} result */
function makeReply(id, result) {
  return { type: 'reply', id, result };
}

/** @param {number} id @param {string} message */
function makeError(id, message) {
  return { type: 'error', id, message };
}

// ---------------------------------------------------------------------------
// Wire helpers
// ---------------------------------------------------------------------------

/** Encode an RPC envelope to an HRBP Buffer. */
function encodeEnvelope(envelope) {
  return encode(envelope);
}

/** Decode an RPC envelope from an HRBP Buffer. */
function decodeEnvelope(buf) {
  return decode(buf);
}

module.exports = { makeCall, makeReply, makeError, encodeEnvelope, decodeEnvelope };
