'use strict';

/**
 * HRBP Structured Logger
 *
 * A minimal structured-logging middleware for HRBP servers.  Logs are emitted
 * as JSON objects with consistent fields — easy to pipe into ELK, Datadog, etc.
 *
 * Features:
 *   - Per-request logging with method, latency, status
 *   - Pluggable output (default: console, or any `{ write(obj) }` sink)
 *   - Log levels: debug, info, warn, error
 *
 * Usage:
 *
 *   const { Logger } = require('./observability/logger');
 *
 *   const logger = new Logger({ level: 'info', name: 'my-service' });
 *   logger.info('server started', { port: 7001 });
 *   logger.error('handler failed', { method: 'add', error: 'division by zero' });
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

class Logger {
  /**
   * @param {Object}  [opts]
   * @param {string}  [opts.level='info']   Minimum log level.
   * @param {string}  [opts.name='hrbp']    Service / logger name.
   * @param {{ write: Function }} [opts.sink]  Output sink (default: console).
   */
  constructor(opts = {}) {
    this.level = opts.level || 'info';
    this.name = opts.name || 'hrbp';
    this._sink = opts.sink || null;
    this._minLevel = LEVELS[this.level] !== undefined ? LEVELS[this.level] : 1;
  }

  debug(msg, data = {}) { this._log('debug', msg, data); }
  info(msg, data = {})  { this._log('info',  msg, data); }
  warn(msg, data = {})  { this._log('warn',  msg, data); }
  error(msg, data = {}) { this._log('error', msg, data); }

  /**
   * Create a child logger with additional default fields.
   *
   * @param {Object} fields  Fields merged into every log entry.
   * @returns {Logger}
   */
  child(fields) {
    const child = new Logger({ level: this.level, name: this.name, sink: this._sink });
    child._defaultFields = { ...this._defaultFields, ...fields };
    return child;
  }

  _log(level, msg, data) {
    if (LEVELS[level] < this._minLevel) return;

    const entry = {
      level,
      ts: new Date().toISOString(),
      name: this.name,
      msg,
      ...this._defaultFields,
      ...data,
    };

    if (this._sink) {
      this._sink.write(entry);
    } else {
      const fn = level === 'error' ? console.error
               : level === 'warn'  ? console.warn
               : console.log;
      fn(JSON.stringify(entry));
    }
  }
}

// Allow default fields on the prototype.
Logger.prototype._defaultFields = {};

module.exports = { Logger, LEVELS };
