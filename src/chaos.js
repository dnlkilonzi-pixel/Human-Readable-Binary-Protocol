'use strict';

/**
 * HRBP Chaos Testing Framework
 *
 * Provides failure-simulation utilities for testing HRBP systems under
 * adversarial conditions.  Wraps TCP connections with configurable faults:
 *
 *   - Latency injection (random or fixed delay)
 *   - Packet dropping (random probability)
 *   - Connection reset / partial disconnect
 *   - Frame corruption (random byte flips)
 *   - Bandwidth throttling
 *
 * Usage:
 *
 *   const { ChaosProxy } = require('./chaos');
 *
 *   const proxy = new ChaosProxy({
 *     target: { host: '127.0.0.1', port: 7001 },
 *     latency: { min: 10, max: 100 },     // ms
 *     dropRate: 0.05,                       // 5% packet loss
 *     corruptRate: 0.01,                    // 1% byte corruption
 *     resetAfter: 50,                       // reset connection after N messages
 *   });
 *
 *   await proxy.listen(9001);
 *   // Now connect clients to port 9001 instead of 7001
 */

const net = require('net');
const { EventEmitter } = require('events');

// ---------------------------------------------------------------------------
// ChaosProxy
// ---------------------------------------------------------------------------

class ChaosProxy extends EventEmitter {
  /**
   * @param {Object} opts
   * @param {{ host: string, port: number }} opts.target  Backend to proxy to.
   * @param {{ min: number, max: number }}  [opts.latency]  Latency injection range in ms.
   * @param {number}  [opts.dropRate=0]     Probability [0,1) of dropping a chunk.
   * @param {number}  [opts.corruptRate=0]  Probability [0,1) of corrupting a chunk.
   * @param {number}  [opts.resetAfter=0]   Reset the connection after N forwarded chunks (0 = never).
   */
  constructor(opts = {}) {
    super();
    this._target = opts.target || { host: '127.0.0.1', port: 7001 };
    this._latency = opts.latency || null;
    this._dropRate = opts.dropRate || 0;
    this._corruptRate = opts.corruptRate || 0;
    this._resetAfter = opts.resetAfter || 0;
    this._server = null;
    this._connections = new Set();
    this._stats = { forwarded: 0, dropped: 0, corrupted: 0, reset: 0, delayed: 0 };
  }

  /**
   * Start the chaos proxy on the given port.
   *
   * @param {number} port
   * @param {string} [host='127.0.0.1']
   * @returns {Promise<void>}
   */
  listen(port, host = '127.0.0.1') {
    return new Promise((resolve, reject) => {
      this._server = net.createServer((clientSocket) => {
        this._handleConnection(clientSocket);
      });
      this._server.on('error', (e) => {
        this.emit('error', e);
        reject(e);
      });
      this._server.listen(port, host, () => {
        this.emit('listening', this._server.address());
        resolve();
      });
    });
  }

  _handleConnection(clientSocket) {
    const targetSocket = net.createConnection(this._target.port, this._target.host);
    let chunkCount = 0;
    const pair = { clientSocket, targetSocket };
    this._connections.add(pair);

    const cleanup = () => {
      clientSocket.destroy();
      targetSocket.destroy();
      this._connections.delete(pair);
    };

    clientSocket.on('error', cleanup);
    targetSocket.on('error', cleanup);
    clientSocket.on('close', cleanup);
    targetSocket.on('close', cleanup);

    // Client → Target (with faults)
    clientSocket.on('data', (chunk) => {
      chunkCount++;

      // Drop?
      if (this._dropRate > 0 && Math.random() < this._dropRate) {
        this._stats.dropped++;
        this.emit('drop', { direction: 'c2s', bytes: chunk.length });
        return;
      }

      // Corrupt?
      if (this._corruptRate > 0 && Math.random() < this._corruptRate) {
        chunk = corruptBuffer(chunk);
        this._stats.corrupted++;
        this.emit('corrupt', { direction: 'c2s', bytes: chunk.length });
      }

      // Reset after N chunks?
      if (this._resetAfter > 0 && chunkCount >= this._resetAfter) {
        this._stats.reset++;
        this.emit('reset', { direction: 'c2s', chunkCount });
        cleanup();
        return;
      }

      // Latency?
      if (this._latency) {
        const delay = this._latency.min + Math.random() * (this._latency.max - this._latency.min);
        this._stats.delayed++;
        setTimeout(() => {
          if (!targetSocket.destroyed) targetSocket.write(chunk);
        }, delay);
      } else {
        this._stats.forwarded++;
        targetSocket.write(chunk);
      }
    });

    // Target → Client (forwarded as-is, but with optional latency)
    targetSocket.on('data', (chunk) => {
      if (this._latency) {
        const delay = this._latency.min + Math.random() * (this._latency.max - this._latency.min);
        setTimeout(() => {
          if (!clientSocket.destroyed) clientSocket.write(chunk);
        }, delay);
      } else {
        if (!clientSocket.destroyed) clientSocket.write(chunk);
      }
    });
  }

  /** Get statistics about faults injected. */
  get stats() {
    return { ...this._stats };
  }

  /** Reset statistics. */
  resetStats() {
    this._stats = { forwarded: 0, dropped: 0, corrupted: 0, reset: 0, delayed: 0 };
  }

  /** The bound address (available after listen). */
  get address() {
    return this._server ? this._server.address() : null;
  }

  /** Stop the proxy and close all connections. */
  close() {
    return new Promise((resolve) => {
      for (const { clientSocket, targetSocket } of this._connections) {
        clientSocket.destroy();
        targetSocket.destroy();
      }
      this._connections.clear();
      if (this._server) {
        this._server.close(resolve);
      } else {
        resolve();
      }
    });
  }
}

// ---------------------------------------------------------------------------
// FaultInjector — middleware for RPC servers
// ---------------------------------------------------------------------------

/**
 * Creates an RPC middleware that injects faults into the handler pipeline.
 * Useful for testing how clients handle server-side failures.
 *
 * @param {Object} opts
 * @param {number} [opts.errorRate=0]     Probability of returning a random error.
 * @param {number} [opts.latencyMs=0]     Additional delay in ms before handler runs.
 * @param {number} [opts.timeoutRate=0]   Probability of never responding (simulates hang).
 * @returns {Function}  Middleware function for HRBPRpcServer.use()
 */
function createFaultInjector(opts = {}) {
  const { errorRate = 0, latencyMs = 0, timeoutRate = 0 } = opts;

  return async function faultInjector(envelope) {
    // Simulate timeout (never respond)
    if (timeoutRate > 0 && Math.random() < timeoutRate) {
      return null; // drop — middleware returning null stops processing
    }

    // Simulate latency
    if (latencyMs > 0) {
      await new Promise((r) => setTimeout(r, latencyMs));
    }

    // Simulate random error
    if (errorRate > 0 && Math.random() < errorRate) {
      throw new Error('Injected fault: random error');
    }

    return envelope;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Corrupt a buffer by flipping random bits.
 *
 * @param {Buffer} buf
 * @returns {Buffer}
 */
function corruptBuffer(buf) {
  const corrupted = Buffer.from(buf);
  const idx = Math.floor(Math.random() * corrupted.length);
  corrupted[idx] ^= (1 << Math.floor(Math.random() * 8));
  return corrupted;
}

module.exports = { ChaosProxy, createFaultInjector, corruptBuffer };
