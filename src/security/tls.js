'use strict';

/**
 * HRBP TLS / Secure Transport
 *
 * Wraps Node's `tls` module to provide encrypted HRBP connections.
 * Drop-in replacements for `HRBPServer` / `HRBPClient` that speak TLS.
 *
 * Usage:
 *
 *   const { HRBPSecureServer, HRBPSecureClient } = require('./security/tls');
 *
 *   // Server
 *   const server = new HRBPSecureServer({
 *     key:  fs.readFileSync('server-key.pem'),
 *     cert: fs.readFileSync('server-cert.pem'),
 *   });
 *   server.on('connection', (conn) => { ... });
 *   server.listen(7443);
 *
 *   // Client
 *   const client = new HRBPSecureClient({ ca: fs.readFileSync('ca-cert.pem') });
 *   client.connect(7443, '127.0.0.1', () => client.send({ hello: 'TLS' }));
 */

const tls = require('tls');
const { EventEmitter } = require('events');
const { encode } = require('../encoder');
const { decode } = require('../decoder');
const { frameEncode, FrameDecoder } = require('../framing');

// ---------------------------------------------------------------------------
// HRBPSecureConnection
// ---------------------------------------------------------------------------

/**
 * A TLS-encrypted HRBP connection.  Same API as `HRBPConnection`.
 */
class HRBPSecureConnection extends EventEmitter {
  /**
   * @param {tls.TLSSocket} socket
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
   * @returns {boolean}  Whether the data was flushed to the kernel buffer.
   */
  send(value) {
    return this._socket.write(frameEncode(encode(value)));
  }

  /** Gracefully close the connection. */
  close() {
    this._socket.end();
  }

  /** True while the socket is still writable. */
  get connected() {
    return !this._socket.destroyed;
  }

  /** Whether the TLS handshake was authorized (peer cert valid). */
  get authorized() {
    return this._socket.authorized;
  }

  /** Peer certificate info. */
  get peerCertificate() {
    return this._socket.getPeerCertificate();
  }
}

// ---------------------------------------------------------------------------
// HRBPSecureServer
// ---------------------------------------------------------------------------

/**
 * TLS-secured HRBP server.  Same event API as `HRBPServer`.
 *
 * @param {tls.TlsOptions} tlsOptions  Node TLS options (key, cert, ca, etc.)
 */
class HRBPSecureServer extends EventEmitter {
  constructor(tlsOptions = {}) {
    super();
    this._tlsOptions = tlsOptions;
    this._server = tls.createServer(tlsOptions, (socket) => {
      const conn = new HRBPSecureConnection(socket);
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

// ---------------------------------------------------------------------------
// HRBPSecureClient
// ---------------------------------------------------------------------------

/**
 * TLS-secured HRBP client.  Same event API as `HRBPClient`.
 *
 * @param {tls.ConnectionOptions} [tlsOptions]  TLS connect options (ca, rejectUnauthorized, etc.)
 */
class HRBPSecureClient extends EventEmitter {
  constructor(tlsOptions = {}) {
    super();
    this._tlsOptions = tlsOptions;
    this._socket = null;
    this._fd = new FrameDecoder();
  }

  /**
   * Connect to an HRBP TLS server.
   *
   * @param {number}   port
   * @param {string}   [host='127.0.0.1']
   * @param {Function} [callback]  Called on 'secureConnect'.
   * @returns {this}
   */
  connect(port, host = '127.0.0.1', callback) {
    const opts = { ...this._tlsOptions, port, host };
    this._socket = tls.connect(opts, () => {
      this.emit('connect');
      if (callback) callback();
    });

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

    this._socket.on('error', (e) => this.emit('error', e));
    this._socket.on('close', () => this.emit('close'));

    return this;
  }

  /**
   * Encode `value` and send it as a framed HRBP message.
   *
   * @param {*} value
   * @returns {boolean}
   */
  send(value) {
    if (!this._socket) throw new Error('Not connected');
    return this._socket.write(frameEncode(encode(value)));
  }

  /** Gracefully close the connection. */
  close() {
    if (this._socket) this._socket.end();
  }

  /** True while the socket is still writable. */
  get connected() {
    return this._socket && !this._socket.destroyed;
  }

  /** Whether the TLS handshake was authorized. */
  get authorized() {
    return this._socket ? this._socket.authorized : false;
  }
}

module.exports = { HRBPSecureServer, HRBPSecureClient, HRBPSecureConnection };
