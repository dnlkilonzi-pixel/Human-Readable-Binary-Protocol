'use strict';

/**
 * HRBP RPC Client
 *
 * Builds on `HRBPClient` to provide a call/response RPC layer.  Each call
 * returns a Promise that resolves with the server's result or rejects with an
 * error, matching requests to responses via a numeric id — similar to JSON-RPC
 * or gRPC streaming.
 *
 * Usage:
 *
 *   const { HRBPRpcClient } = require('./rpc/client');
 *
 *   const rpc = new HRBPRpcClient();
 *
 *   await new Promise((resolve) => rpc.connect(7001, '127.0.0.1', resolve));
 *
 *   const sum = await rpc.call('add', { a: 3, b: 4 });  // => 7
 *   const user = await rpc.call('getUser', { id: 1 });  // => { id: 1, name: 'Alice' }
 *
 *   rpc.close();
 */

const { HRBPClient } = require('../tcp/client');
const { makeCall } = require('./protocol');

class HRBPRpcClient {
  constructor() {
    this._client = new HRBPClient();
    this._pending = new Map(); // id → { resolve, reject }
    this._nextId = 1;

    this._client.on('message', (envelope) => {
      if (!envelope || (envelope.type !== 'reply' && envelope.type !== 'error')) return;
      const { id } = envelope;
      const pending = this._pending.get(id);
      if (!pending) return;
      this._pending.delete(id);

      if (envelope.type === 'reply') {
        pending.resolve(envelope.result);
      } else {
        pending.reject(new Error(envelope.message));
      }
    });

    this._client.on('close', () => {
      // Reject any in-flight calls if the connection drops.
      for (const { reject } of this._pending.values()) {
        reject(new Error('Connection closed'));
      }
      this._pending.clear();
    });

    this._client.on('error', (e) => {
      // Surface to pending calls; unhandled errors bubble to uncaught on the
      // client if there are no pending calls.
      if (this._pending.size === 0) return;
      for (const { reject } of this._pending.values()) {
        reject(e);
      }
      this._pending.clear();
    });
  }

  /**
   * Connect to an HRBP RPC server.
   *
   * @param {number}   port
   * @param {string}   [host='127.0.0.1']
   * @param {Function} [callback]
   * @returns {this}
   */
  connect(port, host = '127.0.0.1', callback) {
    this._client.connect(port, host, callback);
    return this;
  }

  /**
   * Call a remote method and return a Promise for the result.
   *
   * @param {string} method  Name of the method to call.
   * @param {*}      [params]  Argument to pass to the handler.
   * @returns {Promise<*>}
   */
  call(method, params) {
    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      this._client.send(makeCall(id, method, params));
    });
  }

  /** Gracefully close the connection. */
  close() {
    this._client.close();
  }

  /** True while the socket is still writable. */
  get connected() {
    return this._client.connected;
  }
}

module.exports = { HRBPRpcClient };
