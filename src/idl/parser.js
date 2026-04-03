'use strict';

/**
 * HRBP IDL Parser
 *
 * Parses `.hrbp` Interface Definition Language files into an in-memory
 * service/type registry.  The IDL syntax is intentionally minimal:
 *
 *   // --- example.hrbp ---
 *
 *   type User {
 *     id:     int
 *     name:   string
 *     active: boolean
 *   }
 *
 *   type AddRequest {
 *     a: int
 *     b: int
 *   }
 *
 *   service Calculator {
 *     add(AddRequest): int
 *     getUser(int):    User
 *   }
 *
 * Supported primitive types: int, float, number, string, boolean, null, buffer
 * Composite types:  arrays use `int[]` or `User[]` suffix notation.
 *
 * The parser produces a `ServiceDefinition` that can be used for:
 *   - Runtime validation of RPC call params and return values
 *   - Code generation (stubs)
 *   - Documentation
 */

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

const TOKEN_PATTERNS = [
  ['COMMENT',    /\/\/[^\n]*/],
  ['LBRACE',     /\{/],
  ['RBRACE',     /\}/],
  ['LPAREN',     /\(/],
  ['RPAREN',     /\)/],
  ['COLON',      /:/],
  ['COMMA',      /,/],
  ['BRACKETS',   /\[\]/],
  ['KEYWORD',    /\b(type|service)\b/],
  ['IDENT',      /[a-zA-Z_][a-zA-Z0-9_]*/],
  ['WHITESPACE', /\s+/],
];

function tokenize(source) {
  const tokens = [];
  let pos = 0;

  while (pos < source.length) {
    let matched = false;
    for (const [type, regex] of TOKEN_PATTERNS) {
      const re = new RegExp(`^${regex.source}`);
      const m = source.slice(pos).match(re);
      if (m) {
        if (type !== 'WHITESPACE' && type !== 'COMMENT') {
          tokens.push({ type, value: m[0], pos });
        }
        pos += m[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      throw new SyntaxError(`IDL: unexpected character '${source[pos]}' at position ${pos}`);
    }
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} FieldDef
 * @property {string} name
 * @property {string} type   Primitive type name or a user-defined type name.
 * @property {boolean} isArray
 */

/**
 * @typedef {Object} TypeDef
 * @property {string}     name
 * @property {FieldDef[]} fields
 */

/**
 * @typedef {Object} MethodDef
 * @property {string}  name
 * @property {string}  paramType   Type name (or primitive) of the single parameter.
 * @property {boolean} paramIsArray
 * @property {string}  returnType  Type name (or primitive) of the return value.
 * @property {boolean} returnIsArray
 */

/**
 * @typedef {Object} ServiceDef
 * @property {string}      name
 * @property {MethodDef[]} methods
 */

/**
 * @typedef {Object} IDLDefinition
 * @property {Map<string, TypeDef>}    types
 * @property {Map<string, ServiceDef>} services
 */

/**
 * Parse an HRBP IDL source string.
 *
 * @param {string} source  The `.hrbp` IDL text.
 * @returns {IDLDefinition}
 */
function parseIDL(source) {
  const tokens = tokenize(source);
  const types = new Map();
  const services = new Map();
  let i = 0;

  function peek() { return tokens[i]; }
  function eat(type) {
    const t = tokens[i];
    if (!t || t.type !== type) {
      const got = t ? `${t.type} '${t.value}'` : 'EOF';
      throw new SyntaxError(`IDL: expected ${type}, got ${got} at position ${t ? t.pos : 'end'}`);
    }
    i++;
    return t;
  }

  function parseTypeRef() {
    const name = eat('IDENT').value;
    let isArray = false;
    if (peek() && peek().type === 'BRACKETS') {
      eat('BRACKETS');
      isArray = true;
    }
    return { typeName: name, isArray };
  }

  function parseTypeDef() {
    eat('KEYWORD'); // 'type'
    const name = eat('IDENT').value;
    eat('LBRACE');
    const fields = [];
    while (peek() && peek().type !== 'RBRACE') {
      const fieldName = eat('IDENT').value;
      eat('COLON');
      const { typeName, isArray } = parseTypeRef();
      fields.push({ name: fieldName, type: typeName, isArray });
      // optional comma
      if (peek() && peek().type === 'COMMA') eat('COMMA');
    }
    eat('RBRACE');
    return { name, fields };
  }

  function parseServiceDef() {
    eat('KEYWORD'); // 'service'
    const name = eat('IDENT').value;
    eat('LBRACE');
    const methods = [];
    while (peek() && peek().type !== 'RBRACE') {
      const methodName = eat('IDENT').value;
      eat('LPAREN');
      const { typeName: paramType, isArray: paramIsArray } = parseTypeRef();
      eat('RPAREN');
      eat('COLON');
      const { typeName: returnType, isArray: returnIsArray } = parseTypeRef();
      methods.push({ name: methodName, paramType, paramIsArray, returnType, returnIsArray });
      // optional comma
      if (peek() && peek().type === 'COMMA') eat('COMMA');
    }
    eat('RBRACE');
    return { name, methods };
  }

  while (i < tokens.length) {
    const t = peek();
    if (t.type === 'KEYWORD' && t.value === 'type') {
      const td = parseTypeDef();
      types.set(td.name, td);
    } else if (t.type === 'KEYWORD' && t.value === 'service') {
      const sd = parseServiceDef();
      services.set(sd.name, sd);
    } else {
      throw new SyntaxError(`IDL: unexpected token '${t.value}' at position ${t.pos}`);
    }
  }

  return { types, services };
}

// ---------------------------------------------------------------------------
// Schema generation from IDL types
// ---------------------------------------------------------------------------

const PRIMITIVE_MAP = {
  int:     'int',
  float:   'float',
  number:  'number',
  string:  'string',
  boolean: 'boolean',
  null:    'null',
  buffer:  'buffer',
};

/**
 * Convert an IDL type reference to an HRBP schema object (compatible with
 * `validate()` from `src/schema.js`).
 *
 * @param {string}  typeName
 * @param {boolean} isArray
 * @param {Map<string, TypeDef>} typeMap
 * @returns {string|object}
 */
function typeToSchema(typeName, isArray, typeMap) {
  let innerSchema;

  if (PRIMITIVE_MAP[typeName]) {
    innerSchema = PRIMITIVE_MAP[typeName];
  } else if (typeMap.has(typeName)) {
    const td = typeMap.get(typeName);
    const fields = {};
    const required = [];
    for (const f of td.fields) {
      fields[f.name] = typeToSchema(f.type, f.isArray, typeMap);
      required.push(f.name);
    }
    innerSchema = { type: 'object', fields, required };
  } else {
    throw new TypeError(`IDL: unknown type "${typeName}"`);
  }

  if (isArray) {
    return { type: 'array', items: innerSchema };
  }
  return innerSchema;
}

/**
 * Build a full service contract from an `IDLDefinition`.
 *
 * Returns a map of `methodName → { paramSchema, returnSchema }` for each
 * method in each service.
 *
 * @param {IDLDefinition} idl
 * @returns {Map<string, { paramSchema: *, returnSchema: * }>}
 */
function buildContracts(idl) {
  const contracts = new Map();

  for (const [, service] of idl.services) {
    for (const method of service.methods) {
      const paramSchema  = typeToSchema(method.paramType,  method.paramIsArray,  idl.types);
      const returnSchema = typeToSchema(method.returnType, method.returnIsArray, idl.types);
      contracts.set(method.name, { paramSchema, returnSchema });
    }
  }

  return contracts;
}

module.exports = { parseIDL, typeToSchema, buildContracts };
