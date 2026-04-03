'use strict';

/**
 * HRBP IDL (Interface Definition Language) Module
 *
 * Provides a complete contract-driven schema system for HRBP services:
 *
 *   - `parseIDL(source)` — parse `.hrbp` IDL files into type + service definitions
 *   - `generateSchemas(idl)` — produce HRBP-compatible schemas from parsed IDL
 *   - `generateStub(idl)` — generate JavaScript client/server stub code
 *
 * IDL Syntax:
 *
 *   type User {
 *     id:     int
 *     name:   string
 *     active: boolean
 *   }
 *
 *   service UserService {
 *     getUser(id: int): User
 *     listUsers(): User[]
 *   }
 */

const { parseIDL, typeToSchema, buildContracts } = require('./parser');
const { validate } = require('../schema');

// ---------------------------------------------------------------------------
// Contract validator
// ---------------------------------------------------------------------------

/**
 * Create a contract validator from an IDL source string.
 *
 * Returns an object with `validateParams(method, params)` and
 * `validateReturn(method, result)` methods that throw `TypeError` when
 * the value does not match the IDL-defined schema.
 *
 * @param {string} idlSource
 * @returns {{ validateParams: Function, validateReturn: Function, contracts: Map }}
 */
function createContractValidator(idlSource) {
  const idl = parseIDL(idlSource);
  const contracts = buildContracts(idl);

  function validateParams(method, params) {
    const contract = contracts.get(method);
    if (!contract) {
      throw new TypeError(`No contract defined for method "${method}"`);
    }
    validate(params, contract.paramSchema, `${method}.params`);
  }

  function validateReturn(method, result) {
    const contract = contracts.get(method);
    if (!contract) {
      throw new TypeError(`No contract defined for method "${method}"`);
    }
    validate(result, contract.returnSchema, `${method}.return`);
  }

  return { validateParams, validateReturn, contracts };
}

// ---------------------------------------------------------------------------
// Code generator — JavaScript stubs
// ---------------------------------------------------------------------------

/**
 * Generate JavaScript client stub code from an IDL definition.
 *
 * The generated code creates a class with typed methods that call the
 * underlying RPC client.
 *
 * @param {string} idlSource
 * @returns {string}  JavaScript source code for a client stub class.
 */
function generateClientStub(idlSource) {
  const idl = parseIDL(idlSource);
  const lines = [
    "'use strict';",
    '',
    '// Auto-generated HRBP client stub',
    '// DO NOT EDIT — regenerate from the .hrbp IDL file.',
    '',
  ];

  for (const [, service] of idl.services) {
    lines.push(`class ${service.name}Client {`);
    lines.push('  constructor(rpcClient) {');
    lines.push('    this._rpc = rpcClient;');
    lines.push('  }');
    lines.push('');

    for (const method of service.methods) {
      lines.push(`  /** @returns {Promise<*>} */`);
      lines.push(`  async ${method.name}(params) {`);
      lines.push(`    return this._rpc.call('${method.name}', params);`);
      lines.push('  }');
      lines.push('');
    }

    lines.push('}');
    lines.push('');
    lines.push(`module.exports = { ${service.name}Client };`);
  }

  return lines.join('\n');
}

module.exports = {
  parseIDL,
  typeToSchema,
  buildContracts,
  createContractValidator,
  generateClientStub,
};
