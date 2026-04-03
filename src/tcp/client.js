'use strict';

/**
 * HRBP TCP Client
 *
 * Wraps Node's `net.Socket` to provide a message-oriented HRBP client that
 * speaks the same framing protocol as `HRBPServer`.
 *
 * Usage:
 *
 *   const { HRBPClient } = require('./tcp/client');
 *
 *   const client = new HRBPClient();
 *
 *   client.on('message', (value) => console.log('server says:', value));
 *
 *   client.connect(7000, '127.0.0.1', () => {
 *     client.send({ hello: 'world' });
 *   });
 */

const net = require('net');
const { EventEmitter } = require('events');
const { encode } = require('../encoder');
const { decode } = require('../decoder');
const { frameEncode, FrameDecoder } = require('../framing');

/**
 * A TCP client that speaks HRBP.
 *
 * Events:
 *   'message'  – emitted with the decoded JS value for each complete frame.
 *   'error'    – emitted on socket or decode failure.
 *   'close'    – emitted when the socket closes.
 *   'connect'  – emitted once the TCP connection is established.
 */
class HRBPClient extends EventEmitter {
  constructor() {
    super();
    this._socket = new net.Socket();
    this._fd = new FrameDecoder();

    this._socket.on('data', (chunk) => {
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

    this._socket.on('connect', () => this.emit('connect'));
    this._socket.on('error', (e) => this.emit('error', e));
    this._socket.on('close', () => this.emit('close'));
  }

  /**
   * Connect to an HRBP server.
   *
   * @param {number}   port
   * @param {string}   [host='127.0.0.1']
   * @param {Function} [callback]  Called on 'connect'.
   * @returns {this}
   */
  connect(port, host = '127.0.0.1', callback) {
    this._socket.connect(port, host, callback);
    return this;
  }

  /**
   * Encode `value` and send it as a framed HRBP message.
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

module.exports = { HRBPClient };
