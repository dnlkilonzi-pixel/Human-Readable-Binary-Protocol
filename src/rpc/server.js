'use strict';

/**
 * HRBP RPC Server
 *
 * Builds on `HRBPServer` to provide a call/response RPC layer.  Register
 * named handlers with `server.handle(name, fn)`.  When a 'call' envelope
 * arrives the handler is awaited, and the result (or error) is sent back with
 * the matching request id — exactly like a mini gRPC server.
 *
 * Usage:
 *
 *   const { HRBPRpcServer } = require('./rpc/server');
 *
 *   const rpc = new HRBPRpcServer();
 *
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
    this._server = new HRBPServer();

    this._server.on('connection', (conn) => {
      conn.on('message', async (envelope) => {
        if (!envelope || envelope.type !== 'call') return;
        const { id, method, params } = envelope;

        const handler = this._handlers.get(method);
        if (!handler) {
          conn.send(makeError(id, `Unknown method: ${method}`));
          return;
        }

        try {
          const result = await handler(params);
          conn.send(makeReply(id, result));
        } catch (e) {
          conn.send(makeError(id, e && e.message ? e.message : String(e)));
        }
      });
    });

    // Forward server errors.
    this._server.on('error', (e) => this.emit && this.emit('error', e));
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
