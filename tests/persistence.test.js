'use strict';

/**
 * Tests for HRBP Persistence: WAL, RegistryStore, StateStore
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WAL, RegistryStore, StateStore } = require('../src/persistence');
const { ServiceRegistry } = require('../src/discovery/registry');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hrbp-test-'));
}

// ---------------------------------------------------------------------------
// WAL
// ---------------------------------------------------------------------------

describe('WAL', () => {
  it('opens and appends entries', async () => {
    const dir = tmpDir();
    const wal = new WAL(path.join(dir, 'test.wal'));
    await wal.open();
    await wal.append({ method: 'add', params: { a: 1, b: 2 } });
    await wal.append({ method: 'sub', params: { a: 5, b: 3 } });
    assert.ok(wal.size > 0);
    await wal.close();
    fs.rmSync(dir, { recursive: true });
  });

  it('replays all entries', async () => {
    const dir = tmpDir();
    const wal = new WAL(path.join(dir, 'test.wal'));
    await wal.open();
    await wal.append({ x: 1 });
    await wal.append({ x: 2 });
    await wal.append({ x: 3 });
    const entries = await wal.replay();
    assert.equal(entries.length, 3);
    assert.equal(entries[0].data.x, 1);
    assert.equal(entries[2].data.x, 3);
    assert.ok(entries[0].ts > 0);
    await wal.close();
    fs.rmSync(dir, { recursive: true });
  });

  it('truncate clears the WAL', async () => {
    const dir = tmpDir();
    const wal = new WAL(path.join(dir, 'test.wal'));
    await wal.open();
    await wal.append({ x: 1 });
    await wal.truncate();
    assert.equal(wal.size, 0);
    const entries = await wal.replay();
    assert.equal(entries.length, 0);
    await wal.close();
    fs.rmSync(dir, { recursive: true });
  });

  it('emits rotate when maxSize exceeded', async () => {
    const dir = tmpDir();
    const wal = new WAL(path.join(dir, 'test.wal'), { maxSize: 50 });
    await wal.open();
    let rotated = false;
    wal.on('rotate', () => { rotated = true; });
    // Write enough to exceed 50 bytes
    for (let i = 0; i < 10; i++) {
      await wal.append({ bigData: 'x'.repeat(20) });
    }
    assert.ok(rotated, 'should emit rotate event');
    await wal.close();
    fs.rmSync(dir, { recursive: true });
  });

  it('skips corrupted lines during replay', async () => {
    const dir = tmpDir();
    const filePath = path.join(dir, 'test.wal');
    // Write some valid and some invalid JSON
    fs.writeFileSync(filePath, '{"ts":1,"data":"ok"}\ngarbage\n{"ts":2,"data":"also ok"}\n');
    const wal = new WAL(filePath);
    await wal.open();
    let corruptCount = 0;
    wal.on('corrupt', () => { corruptCount++; });
    const entries = await wal.replay();
    assert.equal(entries.length, 2);
    assert.equal(corruptCount, 1);
    await wal.close();
    fs.rmSync(dir, { recursive: true });
  });

  it('throws when not open', async () => {
    const wal = new WAL('/tmp/not-open.wal');
    await assert.rejects(() => wal.append({}), /not open/);
    await assert.rejects(() => wal.replay(), /not open/);
  });

  it('creates parent directories', async () => {
    const dir = tmpDir();
    const nested = path.join(dir, 'deep', 'nested', 'test.wal');
    const wal = new WAL(nested);
    await wal.open();
    await wal.append({ x: 1 });
    assert.ok(fs.existsSync(nested));
    await wal.close();
    fs.rmSync(dir, { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// RegistryStore
// ---------------------------------------------------------------------------

describe('RegistryStore', () => {
  it('save and restore round-trips registry state', async () => {
    const dir = tmpDir();
    const store = new RegistryStore(path.join(dir, 'registry.json'));

    // Populate a registry
    const reg = new ServiceRegistry();
    reg.register({ name: 'svc-a', host: '10.0.0.1', port: 7001, tags: ['v1'] });
    reg.register({ name: 'svc-b', host: '10.0.0.2', port: 7002 });

    await store.save(reg);
    reg.close();

    // Restore into a fresh registry
    const reg2 = new ServiceRegistry();
    const count = await store.restore(reg2);
    assert.equal(count, 2);
    const svcA = reg2.lookup('svc-a');
    assert.equal(svcA.length, 1);
    assert.equal(svcA[0].host, '10.0.0.1');
    const svcB = reg2.lookup('svc-b');
    assert.equal(svcB.length, 1);
    reg2.close();
    fs.rmSync(dir, { recursive: true });
  });

  it('restore returns 0 when no snapshot exists', async () => {
    const store = new RegistryStore('/tmp/nonexistent-reg-snapshot.json');
    const reg = new ServiceRegistry();
    const count = await store.restore(reg);
    assert.equal(count, 0);
    reg.close();
  });

  it('exists() checks file presence', async () => {
    const dir = tmpDir();
    const filePath = path.join(dir, 'test.json');
    const store = new RegistryStore(filePath);
    assert.equal(await store.exists(), false);
    fs.writeFileSync(filePath, '{}');
    assert.equal(await store.exists(), true);
    fs.rmSync(dir, { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// StateStore
// ---------------------------------------------------------------------------

describe('StateStore', () => {
  it('set and get values', async () => {
    const dir = tmpDir();
    const store = new StateStore(dir);
    await store.open();
    store.set('key1', 'value1');
    store.set('key2', { nested: true });
    assert.equal(store.get('key1'), 'value1');
    assert.deepEqual(store.get('key2'), { nested: true });
    await store.close();
    fs.rmSync(dir, { recursive: true });
  });

  it('persists and recovers state', async () => {
    const dir = tmpDir();

    // Write
    const store1 = new StateStore(dir);
    await store1.open();
    store1.set('config', { port: 7001 });
    store1.set('version', 2);
    await store1.snapshot();
    await store1.close();

    // Read back
    const store2 = new StateStore(dir);
    await store2.open();
    assert.deepEqual(store2.get('config'), { port: 7001 });
    assert.equal(store2.get('version'), 2);
    await store2.close();
    fs.rmSync(dir, { recursive: true });
  });

  it('delete removes keys', async () => {
    const dir = tmpDir();
    const store = new StateStore(dir);
    await store.open();
    store.set('a', 1);
    assert.equal(store.delete('a'), true);
    assert.equal(store.get('a'), undefined);
    assert.equal(store.delete('nonexistent'), false);
    await store.close();
    fs.rmSync(dir, { recursive: true });
  });

  it('has and keys work correctly', async () => {
    const dir = tmpDir();
    const store = new StateStore(dir);
    await store.open();
    store.set('x', 1);
    store.set('y', 2);
    assert.equal(store.has('x'), true);
    assert.equal(store.has('z'), false);
    assert.deepEqual(store.keys().sort(), ['x', 'y']);
    assert.equal(store.size, 2);
    await store.close();
    fs.rmSync(dir, { recursive: true });
  });

  it('auto-snapshots on close when dirty', async () => {
    const dir = tmpDir();
    const store = new StateStore(dir);
    await store.open();
    store.set('dirty', true);
    await store.close();

    // Verify it was written
    const store2 = new StateStore(dir);
    await store2.open();
    assert.equal(store2.get('dirty'), true);
    await store2.close();
    fs.rmSync(dir, { recursive: true });
  });

  it('handles empty initial state', async () => {
    const dir = tmpDir();
    const store = new StateStore(dir);
    await store.open();
    assert.equal(store.size, 0);
    assert.equal(store.get('nothing'), undefined);
    await store.close();
    fs.rmSync(dir, { recursive: true });
  });
});
