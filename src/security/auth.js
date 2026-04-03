'use strict';

/**
 * HRBP Authentication Middleware
 *
 * Provides token-based authentication for HRBP RPC servers.  Plugs into the
 * RPC layer as a middleware that validates a `token` field on the first message
 * (or on every call envelope).
 *
 * Strategies:
 *   - **static token** — a shared secret (like an API key)
 *   - **custom validator** — async function `(token, method, params) => bool`
 *
 * Usage:
 *
 *   const { createAuthMiddleware } = require('./security/auth');
 *
 *   // Static token
 *   const auth = createAuthMiddleware({ token: 'my-secret-key' });
 *
 *   // Custom validator
 *   const auth = createAuthMiddleware({
 *     validate: async (token, method) => {
 *       const user = await db.findByToken(token);
 *       return user && user.canAccess(method);
 *     },
 *   });
 *
 *   // Apply to RPC server
 *   const server = new HRBPRpcServer();
 *   server.use(auth);  // ← new middleware hook
 */

/**
 * @typedef {Object} AuthOptions
 * @property {string}   [token]     Shared secret — messages must include `{ token }`.
 * @property {Function} [validate]  `async (token, method, params) => boolean`
 */

/**
 * Create an authentication middleware function.
 *
 * The returned function has signature `(envelope, conn) => Promise<envelope|null>`.
 * Returns the envelope to pass it through, or throws to reject.
 *
 * @param {AuthOptions} opts
 * @returns {Function}
 */
function createAuthMiddleware(opts = {}) {
  const { token: expectedToken, validate } = opts;

  if (!expectedToken && !validate) {
    throw new Error('Auth middleware requires either `token` or `validate` option');
  }

  return async function authMiddleware(envelope) {
    if (!envelope || envelope.type !== 'call') {
      return envelope; // only gate calls
    }

    const providedToken = envelope.token;
    if (!providedToken) {
      throw new Error('Authentication required: missing token');
    }

    if (expectedToken) {
      if (providedToken !== expectedToken) {
        throw new Error('Authentication failed: invalid token');
      }
      return envelope;
    }

    if (validate) {
      const ok = await validate(providedToken, envelope.method, envelope.params);
      if (!ok) {
        throw new Error('Authentication failed: token rejected by validator');
      }
      return envelope;
    }

    return envelope;
  };
}

/**
 * Create a simple rate limiter middleware.
 *
 * @param {Object} opts
 * @param {number} opts.maxCallsPerSecond   Maximum calls per second per connection.
 * @returns {Function}
 */
function createRateLimiter(opts = {}) {
  const { maxCallsPerSecond = 100 } = opts;
  const interval = 1000;

  // Per-connection state is tracked by a WeakMap keyed on the connection.
  const counters = new Map(); // connId → { count, resetAt }

  return async function rateLimiter(envelope, conn) {
    if (!envelope || envelope.type !== 'call') return envelope;

    const connId = conn ? (conn._id || (conn._id = Symbol())) : 'default';
    const now = Date.now();

    let entry = counters.get(connId);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + interval };
      counters.set(connId, entry);
    }

    entry.count++;
    if (entry.count > maxCallsPerSecond) {
      throw new Error(`Rate limit exceeded: ${maxCallsPerSecond} calls/sec`);
    }

    return envelope;
  };
}

module.exports = { createAuthMiddleware, createRateLimiter };
