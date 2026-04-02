'use strict';

/**
 * HRBP Schema Layer
 *
 * Provides optional type-safe encoding and decoding by validating JavaScript
 * values against a schema definition before encoding and after decoding.
 *
 * Schema shapes
 * ─────────────
 * Primitive schemas (strings):
 *   'int'     – integer value (Number.isInteger)
 *   'float'   – any finite or non-finite number
 *   'number'  – alias for 'float'
 *   'string'  – string value
 *   'boolean' – boolean value
 *   'null'    – null value
 *   'buffer'  – Buffer value
 *
 * Composite schemas (plain objects):
 *   { type: 'array', items: <schema> }
 *     – every element must match <schema>
 *
 *   { type: 'object', fields: { key: <schema>, … }, required: ['key', …] }
 *     – each field present in the value must match its schema
 *     – keys listed in `required` (default: all keys in `fields`) must exist
 */

const { encode } = require('./encoder');
const { decode } = require('./decoder');

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate `value` against `schema`.  Throws a `TypeError` with a descriptive
 * message if the value does not conform.
 *
 * @param {*}               value
 * @param {string|object}   schema
 * @param {string}          [path='']  Used internally to build error paths.
 */
function validate(value, schema, path = '') {
  if (typeof schema === 'string') {
    validatePrimitive(value, schema, path);
    return;
  }
  if (schema !== null && typeof schema === 'object') {
    const { type } = schema;
    if (type === 'array') {
      validateArray(value, schema, path);
    } else if (type === 'object') {
      validateObject(value, schema, path);
    } else {
      throw new TypeError(`Unknown schema type "${type}"`);
    }
    return;
  }
  throw new TypeError(`Invalid schema definition: ${JSON.stringify(schema)}`);
}

function validatePrimitive(value, type, path) {
  const label = path || 'value';
  switch (type) {
    case 'int':
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new TypeError(`Schema: ${label} must be an integer, got ${describeValue(value)}`);
      }
      break;
    case 'float':
    case 'number':
      if (typeof value !== 'number') {
        throw new TypeError(`Schema: ${label} must be a number, got ${describeValue(value)}`);
      }
      break;
    case 'string':
      if (typeof value !== 'string') {
        throw new TypeError(`Schema: ${label} must be a string, got ${describeValue(value)}`);
      }
      break;
    case 'boolean':
      if (typeof value !== 'boolean') {
        throw new TypeError(`Schema: ${label} must be a boolean, got ${describeValue(value)}`);
      }
      break;
    case 'null':
      if (value !== null) {
        throw new TypeError(`Schema: ${label} must be null, got ${describeValue(value)}`);
      }
      break;
    case 'buffer':
      if (!Buffer.isBuffer(value)) {
        throw new TypeError(`Schema: ${label} must be a Buffer, got ${describeValue(value)}`);
      }
      break;
    default:
      throw new TypeError(`Schema: unknown primitive type "${type}"`);
  }
}

function validateArray(value, schema, path) {
  const label = path || 'value';
  if (!Array.isArray(value)) {
    throw new TypeError(`Schema: ${label} must be an Array, got ${describeValue(value)}`);
  }
  if (schema.items !== undefined) {
    for (let i = 0; i < value.length; i++) {
      validate(value[i], schema.items, `${label}[${i}]`);
    }
  }
}

function validateObject(value, schema, path) {
  const label = path || 'value';
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Buffer.isBuffer(value)) {
    throw new TypeError(`Schema: ${label} must be a plain Object, got ${describeValue(value)}`);
  }
  const fields = schema.fields || {};
  const required = schema.required !== undefined ? schema.required : Object.keys(fields);
  for (const key of required) {
    if (!(key in value)) {
      throw new TypeError(`Schema: ${label} is missing required field "${key}"`);
    }
  }
  for (const [key, fieldSchema] of Object.entries(fields)) {
    if (key in value) {
      validate(value[key], fieldSchema, `${label}.${key}`);
    }
  }
}

function describeValue(value) {
  if (value === null) return 'null';
  if (Buffer.isBuffer(value)) return 'Buffer';
  if (Array.isArray(value)) return 'Array';
  return typeof value;
}

// ---------------------------------------------------------------------------
// Schema-aware encode / decode
// ---------------------------------------------------------------------------

/**
 * Validate `value` against `schema` then encode it.
 *
 * @param {*}             value
 * @param {string|object} schema
 * @returns {Buffer}
 */
function encodeWithSchema(value, schema) {
  validate(value, schema);
  return encode(value);
}

/**
 * Decode `buffer` then validate the result against `schema`.
 *
 * @param {Buffer}        buffer
 * @param {string|object} schema
 * @returns {*}
 */
function decodeWithSchema(buffer, schema) {
  const value = decode(buffer);
  validate(value, schema);
  return value;
}

module.exports = { validate, encodeWithSchema, decodeWithSchema };
