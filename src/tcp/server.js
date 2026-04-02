'use strict';

/**
 * HRBP TCP Server
 *
 * Wraps Node's `net.Server` to expose a simple message-oriented API on top of
 * the TCP framing layer.  Each connected client is represented by a
 * `HRBPConnection` that emits 'message' events for decoded HRBP values and
 * exposes a `send(value)` method to reply.
 *
 * Usage:
 *
 *   const { HRBPServer } = require('./tcp/server');
 *
 *   const server = new HRBPServer();
 *
 *   server.on('connection', (conn) => {
 *     conn.on('message', (value) => {
 *       console.log('received:', value);
 *       conn.send({ echo: value });
 *     });
 *     conn.on('close', () => console.log('client disconnected'));
 *   });
 *
 *   server.listen(7000, '127.0.0.1', () => console.log('listening'));
 */

const net = require('net');
const { EventEmitter } = require('events');
const { encode } = require('../encoder');
const { decode } = require('../decoder');
const { frameEncode, FrameDecoder } = require('../framing');

// ---------------------------------------------------------------------------
// HRBPConnection
// ---------------------------------------------------------------------------

/**
 * Wraps a `net.Socket` as a message-oriented HRBP channel.
 *
 * Events:
 *   'message'  – emitted with the decoded JS value for each complete frame.
 *   'error'    – emitted with an Error on socket or decode failure.
 *   'close'    – emitted when the underlying socket closes.
 */
class HRBPConnection extends EventEmitter {
  /**
   * @param {net.Socket} socket
   */
  constructor(socket) {
    super();
    this._socket = socket;
    this._fd = new FrameDecoder();

    socket.on('data', (chunk) => {
      let frames;
      try {
        frames = this._fd.push(chunk);
      } catch (e) {
        this.emit('error', e);
        return;
      }
      for (const payload of frames) {
        try {
          this.emit('message', decode(payload));
        } catch (e) {
          this.emit('error', e);
        }
      }
    });

    socket.on('error', (e) => this.emit('error', e));
    socket.on('close', () => this.emit('close'));
  }

  /**
   * Encode `value` as an HRBP frame and write it to the socket.
   *
   * @param {*} value
   */
  send(value) {
    this._socket.write(frameEncode(encode(value)));
  }

  /** Gracefully close the connection. */
  close() {
    this._socket.end();
  }

  /** True while the socket is still writable. */
  get connected() {
    return !this._socket.destroyed;
  }
}

// ---------------------------------------------------------------------------
// HRBPServer
// ---------------------------------------------------------------------------

/**
 * A TCP server that speaks HRBP.
 *
 * Events:
 *   'connection'  – emitted with an `HRBPConnection` for each new client.
 *   'error'       – forwarded from the underlying `net.Server`.
 *   'close'       – emitted when the server closes.
 */
class HRBPServer extends EventEmitter {
  constructor() {
    super();
    this._server = net.createServer((socket) => {
      const conn = new HRBPConnection(socket);
      this.emit('connection', conn);
    });
    this._server.on('error', (e) => this.emit('error', e));
    this._server.on('close', () => this.emit('close'));
  }

  /**
   * Start listening.
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
   * Stop accepting new connections.
   *
   * @param {Function} [callback]
   * @returns {this}
   */
  close(callback) {
    this._server.close(callback);
    return this;
  }

  /** The bound address/port info (available after 'listening'). */
  get address() {
    return this._server.address();
  }
}

module.exports = { HRBPServer, HRBPConnection };
