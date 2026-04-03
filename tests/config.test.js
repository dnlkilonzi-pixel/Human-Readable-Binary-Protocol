'use strict';

/**
 * Tests for HRBP Configuration System and Deployment Config
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { Config, deepMerge } = require('../src/config');

// ---------------------------------------------------------------------------
// deepMerge
// ---------------------------------------------------------------------------

describe('deepMerge', () => {
  it('merges flat objects', () => {
    const result = deepMerge({ a: 1 }, { b: 2 });
    assert.deepEqual(result, { a: 1, b: 2 });
  });

  it('b overrides a for same keys', () => {
    const result = deepMerge({ x: 1 }, { x: 2 });
    assert.deepEqual(result, { x: 2 });
  });

  it('deeply merges nested objects', () => {
    const result = deepMerge(
      { server: { port: 7001, host: '0.0.0.0' } },
      { server: { port: 9001 } }
    );
    assert.deepEqual(result, { server: { port: 9001, host: '0.0.0.0' } });
  });

  it('does not mutate inputs', () => {
    const a = { x: { y: 1 } };
    const b = { x: { z: 2 } };
    deepMerge(a, b);
    assert.deepEqual(a, { x: { y: 1 } });
    assert.deepEqual(b, { x: { z: 2 } });
  });

  it('handles arrays (replaced, not merged)', () => {
    const result = deepMerge({ tags: [1, 2] }, { tags: [3] });
    assert.deepEqual(result, { tags: [3] });
  });

  it('handles null values', () => {
    const result = deepMerge({ x: { nested: 1 } }, { x: null });
    assert.equal(result.x, null);
  });
});

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

describe('Config', () => {
  it('returns default values', () => {
    const config = new Config({
      defaults: { server: { port: 7001, host: '0.0.0.0' } },
    });
    assert.equal(config.get('server.port'), 7001);
    assert.equal(config.get('server.host'), '0.0.0.0');
  });

  it('applies environment-specific overrides', () => {
    const config = new Config({
      defaults: { server: { port: 7001 } },
      env: 'production',
      environments: {
        production: { server: { port: 443 } },
      },
    });
    assert.equal(config.get('server.port'), 443);
  });

  it('applies environment variable overrides', () => {
    // Set a test env var
    process.env.__HRBP_TEST_PORT = '9999';
    const config = new Config({
      defaults: { server: { port: 7001 } },
      envOverrides: { 'server.port': '__HRBP_TEST_PORT' },
    });
    assert.equal(config.get('server.port'), 9999); // coerced to number
    delete process.env.__HRBP_TEST_PORT;
  });

  it('coerces env vars: boolean true', () => {
    process.env.__HRBP_TEST_BOOL = 'true';
    const config = new Config({
      defaults: { debug: false },
      envOverrides: { 'debug': '__HRBP_TEST_BOOL' },
    });
    assert.equal(config.get('debug'), true);
    delete process.env.__HRBP_TEST_BOOL;
  });

  it('coerces env vars: boolean false', () => {
    process.env.__HRBP_TEST_BOOL = 'false';
    const config = new Config({
      defaults: { debug: true },
      envOverrides: { 'debug': '__HRBP_TEST_BOOL' },
    });
    assert.equal(config.get('debug'), false);
    delete process.env.__HRBP_TEST_BOOL;
  });

  it('coerces env vars: null', () => {
    process.env.__HRBP_TEST_NULL = 'null';
    const config = new Config({
      defaults: { value: 'something' },
      envOverrides: { 'value': '__HRBP_TEST_NULL' },
    });
    assert.equal(config.get('value'), null);
    delete process.env.__HRBP_TEST_NULL;
  });

  it('returns defaultValue for missing keys', () => {
    const config = new Config({ defaults: {} });
    assert.equal(config.get('nonexistent', 42), 42);
    assert.equal(config.get('a.b.c'), undefined);
  });

  it('validates required keys', () => {
    assert.throws(
      () => new Config({
        defaults: { a: 1 },
        required: ['b'],
      }),
      /Missing required config keys: b/
    );
  });

  it('passes when required keys exist', () => {
    assert.doesNotThrow(() => {
      new Config({
        defaults: { a: 1, b: 2 },
        required: ['a', 'b'],
      });
    });
  });

  it('env getter returns environment name', () => {
    const config = new Config({ env: 'staging' });
    assert.equal(config.env, 'staging');
  });

  it('toJSON returns full config', () => {
    const config = new Config({
      defaults: { server: { port: 7001 } },
    });
    const json = config.toJSON();
    assert.deepEqual(json, { server: { port: 7001 } });
  });

  it('env vars create nested paths', () => {
    process.env.__HRBP_DEEP = 'hello';
    const config = new Config({
      defaults: {},
      envOverrides: { 'a.b.c': '__HRBP_DEEP' },
    });
    assert.equal(config.get('a.b.c'), 'hello');
    delete process.env.__HRBP_DEEP;
  });
});
