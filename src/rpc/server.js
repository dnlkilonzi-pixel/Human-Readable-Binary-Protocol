'use strict';

/**
 * HRBP RPC Server
 *
 * Builds on `HRBPServer` to provide a call/response RPC layer.  Register
 * named handlers with `server.handle(name, fn)`.  When a 'call' envelope
 * arrives the handler is awaited, and the result (or error) is sent back with
 * the matching request id — exactly like a mini gRPC server.
 *
 * Middleware:
 *   Use `server.use(fn)` to register middleware functions that run before
 *   each handler.  Each middleware receives `(envelope, conn)` and must
 *   return the (possibly modified) envelope to continue, or throw to reject.
 *
 * Usage:
 *
 *   const { HRBPRpcServer } = require('./rpc/server');
 *
 *   const rpc = new HRBPRpcServer();
 *
 *   rpc.use(authMiddleware);
 *   rpc.handle('add', async ({ a, b }) => a + b);
 *   rpc.handle('getUser', async ({ id }) => ({ id, name: 'Alice' }));
 *
 *   rpc.listen(7001, '127.0.0.1', () => console.log('RPC server ready'));
 */

const { HRBPServer } = require('../tcp/server');
const { makeReply, makeError } = require('./protocol');

class HRBPRpcServer {
  constructor() {
    this._handlers = new Map();
    this._middleware = [];
    this._server = new HRBPServer();

    this._server.on('connection', (conn) => {
      conn.on('message', async (envelope) => {
        if (!envelope || envelope.type !== 'call') return;
        const { id, method, params } = envelope;

        // Run middleware chain
        let processed = envelope;
        for (const mw of this._middleware) {
          try {
            processed = await mw(processed, conn);
            if (!processed) {
              conn.send(makeError(id, 'Request rejected by middleware'));
              return;
            }
          } catch (e) {
            conn.send(makeError(id, e && e.message ? e.message : String(e)));
            return;
          }
        }

        const handler = this._handlers.get(method);
        if (!handler) {
          conn.send(makeError(id, `Unknown method: ${method}`));
          return;
        }

        try {
          const result = await handler(processed.params);
          conn.send(makeReply(id, result));
          if (processed._span) processed._span.finish();
        } catch (e) {
          if (processed._span) {
            processed._span.setError(e);
            processed._span.finish();
          }
          conn.send(makeError(id, e && e.message ? e.message : String(e)));
        }
      });
    });

    // Forward server errors.
    this._server.on('error', (e) => this.emit && this.emit('error', e));
  }

  /**
   * Register a middleware function.
   *
   * Middleware runs in order before the handler.  Each receives
   * `(envelope, conn)` and must return the envelope (or a modified copy)
   * to continue, or throw to reject the call.
   *
   * @param {Function} fn  `async (envelope, conn) => envelope`
   * @returns {this}
   */
  use(fn) {
    this._middleware.push(fn);
    return this;
  }

  /**
   * Register a named RPC handler.
   *
   * @param {string}   name     Method name (must match what the client calls).
   * @param {Function} handler  `async (params) => result`
   * @returns {this}
   */
  handle(name, handler) {
    this._handlers.set(name, handler);
    return this;
  }

  /**
   * Start listening for connections.
   *
   * @param {number}   port
   * @param {string}   [host='127.0.0.1']
   * @param {Function} [callback]
   * @returns {this}
   */
  listen(port, host = '127.0.0.1', callback) {
    this._server.listen(port, host, callback);
    return this;
  }

  /**
   * Stop the server.
   *
   * @param {Function} [callback]
   * @returns {this}
   */
  close(callback) {
    this._server.close(callback);
    return this;
  }

  /** Bound address info (available after listening). */
  get address() {
    return this._server.address;
  }
}

module.exports = { HRBPRpcServer };
