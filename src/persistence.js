'use strict';

/**
 * HRBP Persistence Layer
 *
 * Provides state recovery, registry persistence, and replay logs for HRBP
 * systems.  All data is stored on the local filesystem using append-only
 * log files (WAL) for crash recovery.
 *
 * Features:
 *   - Write-ahead log (WAL) for replay after crash
 *   - Registry snapshot/restore for service discovery state
 *   - Key-value store with periodic snapshotting
 *
 * Usage:
 *
 *   const { WAL, RegistryStore, StateStore } = require('./persistence');
 *
 *   // Write-ahead log
 *   const wal = new WAL('/tmp/hrbp.wal');
 *   await wal.open();
 *   await wal.append({ type: 'call', method: 'add', params: { a: 1, b: 2 } });
 *   const entries = await wal.replay();
 *
 *   // State store
 *   const store = new StateStore('/tmp/hrbp-state');
 *   await store.open();
 *   await store.set('config', { maxConns: 100 });
 *   const value = await store.get('config');
 */

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

// ---------------------------------------------------------------------------
// Write-Ahead Log
// ---------------------------------------------------------------------------

class WAL extends EventEmitter {
  /**
   * @param {string} filePath  Path to the WAL file.
   * @param {Object} [opts]
   * @param {number} [opts.maxSize=10485760]  Max WAL size in bytes before rotation (10 MB).
   */
  constructor(filePath, opts = {}) {
    super();
    this._filePath = filePath;
    this._maxSize = opts.maxSize || 10 * 1024 * 1024;
    this._fd = null;
    this._size = 0;
  }

  /** Open or create the WAL file. */
  async open() {
    await fs.promises.mkdir(path.dirname(this._filePath), { recursive: true });
    this._fd = await fs.promises.open(this._filePath, 'a+');
    const stat = await this._fd.stat();
    this._size = stat.size;
  }

  /**
   * Append an entry to the log.
   *
   * Each entry is one JSON line: `{ts, data}\n`
   *
   * @param {*} data  Any JSON-serializable value.
   */
  async append(data) {
    if (!this._fd) throw new Error('WAL not open');
    const line = JSON.stringify({ ts: Date.now(), data }) + '\n';
    const buf = Buffer.from(line, 'utf8');
    await this._fd.write(buf);
    this._size += buf.length;

    if (this._size >= this._maxSize) {
      this.emit('rotate');
    }
  }

  /**
   * Replay all entries in the WAL.
   *
   * @returns {Array<{ ts: number, data: * }>}
   */
  async replay() {
    if (!this._fd) throw new Error('WAL not open');
    const content = await fs.promises.readFile(this._filePath, 'utf8');
    const entries = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line));
      } catch (_) {
        // Skip corrupted lines.
        this.emit('corrupt', line);
      }
    }
    return entries;
  }

  /**
   * Truncate the WAL (e.g. after taking a snapshot).
   */
  async truncate() {
    if (this._fd) {
      await this._fd.truncate(0);
      this._size = 0;
    }
  }

  /** Current size of the WAL in bytes. */
  get size() {
    return this._size;
  }

  /** Close the WAL file. */
  async close() {
    if (this._fd) {
      await this._fd.close();
      this._fd = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Registry Store — persists ServiceRegistry state
// ---------------------------------------------------------------------------

class RegistryStore {
  /**
   * @param {string} filePath  Path to the snapshot file.
   */
  constructor(filePath) {
    this._filePath = filePath;
  }

  /**
   * Save current registry state to disk.
   *
   * @param {import('./discovery/registry').ServiceRegistry} registry
   */
  async save(registry) {
    const snapshot = {
      ts: Date.now(),
      services: {},
    };

    for (const name of registry.listServices()) {
      const instances = registry.lookup(name);
      if (instances.length > 0) {
        snapshot.services[name] = instances;
      }
    }

    await fs.promises.mkdir(path.dirname(this._filePath), { recursive: true });
    // Write atomically via temp file + rename.
    const tmpPath = this._filePath + '.tmp';
    await fs.promises.writeFile(tmpPath, JSON.stringify(snapshot, null, 2), 'utf8');
    await fs.promises.rename(tmpPath, this._filePath);
  }

  /**
   * Restore registry state from disk.
   *
   * @param {import('./discovery/registry').ServiceRegistry} registry
   * @returns {number}  Number of instances restored.
   */
  async restore(registry) {
    let content;
    try {
      content = await fs.promises.readFile(this._filePath, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') return 0; // no snapshot yet
      throw e;
    }

    const snapshot = JSON.parse(content);
    let count = 0;

    for (const [name, instances] of Object.entries(snapshot.services)) {
      for (const inst of instances) {
        registry.register({
          name,
          host: inst.host,
          port: inst.port,
          tags: inst.tags || [],
          ttl: inst.ttl || 30000,
          metadata: inst.metadata || {},
        });
        count++;
      }
    }

    return count;
  }

  /**
   * Check if a snapshot file exists.
   */
  async exists() {
    try {
      await fs.promises.access(this._filePath);
      return true;
    } catch (_) {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// State Store — generic key-value persistence
// ---------------------------------------------------------------------------

class StateStore extends EventEmitter {
  /**
   * @param {string} dirPath  Directory to store state files.
   * @param {Object} [opts]
   * @param {number} [opts.snapshotInterval=0]  Auto-snapshot interval in ms (0 = disabled).
   */
  constructor(dirPath, opts = {}) {
    super();
    this._dirPath = dirPath;
    this._snapshotInterval = opts.snapshotInterval || 0;
    this._data = new Map();
    this._dirty = false;
    this._timer = null;
  }

  /** Ensure the state directory exists and load existing snapshot. */
  async open() {
    await fs.promises.mkdir(this._dirPath, { recursive: true });

    const snapPath = this._snapshotPath();
    try {
      const content = await fs.promises.readFile(snapPath, 'utf8');
      const obj = JSON.parse(content);
      for (const [k, v] of Object.entries(obj)) {
        this._data.set(k, v);
      }
    } catch (_) {
      // No snapshot yet — start fresh.
    }

    if (this._snapshotInterval > 0) {
      this._timer = setInterval(() => this._autoSnapshot(), this._snapshotInterval);
      if (this._timer.unref) this._timer.unref();
    }
  }

  /**
   * Get a value by key.
   *
   * @param {string} key
   * @returns {*|undefined}
   */
  get(key) {
    return this._data.get(key);
  }

  /**
   * Set a value.
   *
   * @param {string} key
   * @param {*} value  Must be JSON-serializable.
   */
  set(key, value) {
    this._data.set(key, value);
    this._dirty = true;
  }

  /**
   * Delete a key.
   *
   * @param {string} key
   * @returns {boolean}
   */
  delete(key) {
    const had = this._data.delete(key);
    if (had) this._dirty = true;
    return had;
  }

  /** Check if a key exists. */
  has(key) {
    return this._data.has(key);
  }

  /** Number of stored keys. */
  get size() {
    return this._data.size;
  }

  /** List all keys. */
  keys() {
    return [...this._data.keys()];
  }

  /**
   * Persist current state to disk.
   */
  async snapshot() {
    const obj = {};
    for (const [k, v] of this._data) {
      obj[k] = v;
    }
    const tmpPath = this._snapshotPath() + '.tmp';
    await fs.promises.writeFile(tmpPath, JSON.stringify(obj, null, 2), 'utf8');
    await fs.promises.rename(tmpPath, this._snapshotPath());
    this._dirty = false;
    this.emit('snapshot');
  }

  /** Close the store and flush pending changes. */
  async close() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    if (this._dirty) {
      await this.snapshot();
    }
  }

  _snapshotPath() {
    return path.join(this._dirPath, 'state.json');
  }

  async _autoSnapshot() {
    if (this._dirty) {
      try {
        await this.snapshot();
      } catch (e) {
        this.emit('error', e);
      }
    }
  }
}

module.exports = { WAL, RegistryStore, StateStore };
