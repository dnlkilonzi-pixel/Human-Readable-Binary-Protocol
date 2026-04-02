'use strict';

/**
 * HRBP Configuration System
 *
 * Production-grade configuration management with:
 *   - Environment-based config (dev / staging / production)
 *   - Environment variable overrides
 *   - Validation of required settings
 *   - Deep merge of config layers
 *
 * Usage:
 *
 *   const { Config } = require('./config');
 *
 *   const config = new Config({
 *     defaults: { server: { port: 7001, host: '0.0.0.0' } },
 *     env: process.env.NODE_ENV || 'development',
 *     envOverrides: {
 *       'server.port': 'HRBP_PORT',
 *       'server.host': 'HRBP_HOST',
 *     },
 *   });
 *
 *   config.get('server.port'); // 7001 or $HRBP_PORT
 */

/**
 * Deep merge two objects.  `b` takes precedence over `a`.
 * Does not mutate either input.
 */
function deepMerge(a, b) {
  const result = { ...a };
  for (const key of Object.keys(b)) {
    if (
      b[key] !== null &&
      typeof b[key] === 'object' &&
      !Array.isArray(b[key]) &&
      a[key] !== null &&
      typeof a[key] === 'object' &&
      !Array.isArray(a[key])
    ) {
      result[key] = deepMerge(a[key], b[key]);
    } else {
      result[key] = b[key];
    }
  }
  return result;
}

class Config {
  /**
   * @param {Object} opts
   * @param {Object} [opts.defaults={}]        Default configuration values.
   * @param {string} [opts.env='development']   Environment name.
   * @param {Object} [opts.environments={}]     Per-environment overrides.
   * @param {Object} [opts.envOverrides={}]     Map of `dotted.path` → env var name.
   * @param {string[]} [opts.required=[]]       Required dotted paths.
   */
  constructor(opts = {}) {
    const {
      defaults = {},
      env = 'development',
      environments = {},
      envOverrides = {},
      required = [],
    } = opts;

    this._env = env;

    // Layer 1: defaults
    let config = { ...defaults };

    // Layer 2: environment-specific overrides
    if (environments[env]) {
      config = deepMerge(config, environments[env]);
    }

    // Layer 3: environment variable overrides
    for (const [dotPath, envVar] of Object.entries(envOverrides)) {
      const value = process.env[envVar];
      if (value !== undefined) {
        config = this._setPath(config, dotPath, this._coerce(value));
      }
    }

    this._config = config;

    // Validate required keys
    const missing = required.filter((p) => this.get(p) === undefined);
    if (missing.length > 0) {
      throw new Error(`Missing required config keys: ${missing.join(', ')}`);
    }
  }

  /**
   * Get a config value by dotted path.
   *
   * @param {string} dotPath  e.g. 'server.port'
   * @param {*}      [defaultValue]
   * @returns {*}
   */
  get(dotPath, defaultValue) {
    const parts = dotPath.split('.');
    let current = this._config;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return defaultValue;
      }
      current = current[part];
    }
    return current !== undefined ? current : defaultValue;
  }

  /** Get the current environment name. */
  get env() {
    return this._env;
  }

  /** Get the full config object (shallow copy). */
  toJSON() {
    return JSON.parse(JSON.stringify(this._config));
  }

  /** Coerce string environment variable values to native types. */
  _coerce(value) {
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null') return null;
    const num = Number(value);
    if (!isNaN(num) && value.trim() !== '') return num;
    return value;
  }

  /** Set a value at a dotted path, returning a new config object. */
  _setPath(obj, dotPath, value) {
    const parts = dotPath.split('.');
    const result = JSON.parse(JSON.stringify(obj));
    let current = result;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof current[parts[i]] !== 'object' || current[parts[i]] === null) {
        current[parts[i]] = {};
      }
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
    return result;
  }
}

module.exports = { Config, deepMerge };
