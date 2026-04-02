'use strict';

/**
 * Tests for the HRBP IDL parser and contract validator.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseIDL, typeToSchema, buildContracts, createContractValidator, generateClientStub } = require('../src/idl/index');

const SAMPLE_IDL = `
// A sample IDL file for testing

type User {
  id:     int
  name:   string
  active: boolean
}

type AddRequest {
  a: int
  b: int
}

service Calculator {
  add(AddRequest): int
  getUser(int): User
}
`;

describe('IDL Parser', () => {
  it('parses types correctly', () => {
    const idl = parseIDL(SAMPLE_IDL);
    assert.ok(idl.types.has('User'));
    assert.ok(idl.types.has('AddRequest'));
    const user = idl.types.get('User');
    assert.equal(user.fields.length, 3);
    assert.equal(user.fields[0].name, 'id');
    assert.equal(user.fields[0].type, 'int');
    assert.equal(user.fields[1].name, 'name');
    assert.equal(user.fields[1].type, 'string');
    assert.equal(user.fields[2].name, 'active');
    assert.equal(user.fields[2].type, 'boolean');
  });

  it('parses services correctly', () => {
    const idl = parseIDL(SAMPLE_IDL);
    assert.ok(idl.services.has('Calculator'));
    const calc = idl.services.get('Calculator');
    assert.equal(calc.methods.length, 2);
    assert.equal(calc.methods[0].name, 'add');
    assert.equal(calc.methods[0].paramType, 'AddRequest');
    assert.equal(calc.methods[0].returnType, 'int');
    assert.equal(calc.methods[1].name, 'getUser');
    assert.equal(calc.methods[1].paramType, 'int');
    assert.equal(calc.methods[1].returnType, 'User');
  });

  it('parses array types', () => {
    const idl = parseIDL(`
      type ListResult {
        items: int[]
        names: string[]
      }
      service Svc {
        list(int): ListResult
      }
    `);
    const lr = idl.types.get('ListResult');
    assert.equal(lr.fields[0].isArray, true);
    assert.equal(lr.fields[0].type, 'int');
    assert.equal(lr.fields[1].isArray, true);
    assert.equal(lr.fields[1].type, 'string');
  });

  it('throws on syntax error', () => {
    assert.throws(
      () => parseIDL('invalid content !!!'),
      (e) => e instanceof SyntaxError
    );
  });

  it('handles empty IDL', () => {
    const idl = parseIDL('');
    assert.equal(idl.types.size, 0);
    assert.equal(idl.services.size, 0);
  });

  it('handles comments', () => {
    const idl = parseIDL(`
      // This is a comment
      type Empty {
      }
    `);
    assert.ok(idl.types.has('Empty'));
  });
});

describe('typeToSchema', () => {
  it('resolves primitive types', () => {
    const idl = parseIDL(SAMPLE_IDL);
    assert.equal(typeToSchema('int', false, idl.types), 'int');
    assert.equal(typeToSchema('string', false, idl.types), 'string');
    assert.equal(typeToSchema('boolean', false, idl.types), 'boolean');
  });

  it('resolves named types to object schemas', () => {
    const idl = parseIDL(SAMPLE_IDL);
    const schema = typeToSchema('User', false, idl.types);
    assert.equal(schema.type, 'object');
    assert.ok(schema.fields.id);
    assert.ok(schema.fields.name);
    assert.ok(schema.fields.active);
  });

  it('resolves array types', () => {
    const idl = parseIDL(SAMPLE_IDL);
    const schema = typeToSchema('int', true, idl.types);
    assert.equal(schema.type, 'array');
    assert.equal(schema.items, 'int');
  });

  it('throws for unknown types', () => {
    const idl = parseIDL(SAMPLE_IDL);
    assert.throws(
      () => typeToSchema('Unknown', false, idl.types),
      (e) => e instanceof TypeError
    );
  });
});

describe('buildContracts', () => {
  it('builds contracts for all service methods', () => {
    const idl = parseIDL(SAMPLE_IDL);
    const contracts = buildContracts(idl);
    assert.ok(contracts.has('add'));
    assert.ok(contracts.has('getUser'));
    const addContract = contracts.get('add');
    assert.equal(addContract.paramSchema.type, 'object');
    assert.equal(addContract.returnSchema, 'int');
  });
});

describe('createContractValidator', () => {
  it('validateParams passes valid params', () => {
    const { validateParams } = createContractValidator(SAMPLE_IDL);
    // 'add' expects AddRequest { a: int, b: int }
    assert.doesNotThrow(() => validateParams('add', { a: 1, b: 2 }));
  });

  it('validateParams rejects invalid params', () => {
    const { validateParams } = createContractValidator(SAMPLE_IDL);
    assert.throws(
      () => validateParams('add', { a: 'not-int', b: 2 }),
      (e) => e instanceof TypeError
    );
  });

  it('validateReturn passes valid return value', () => {
    const { validateReturn } = createContractValidator(SAMPLE_IDL);
    assert.doesNotThrow(() => validateReturn('add', 42));
  });

  it('validateReturn rejects invalid return value', () => {
    const { validateReturn } = createContractValidator(SAMPLE_IDL);
    assert.throws(
      () => validateReturn('add', 'not-an-int'),
      (e) => e instanceof TypeError
    );
  });

  it('validateReturn works for complex types', () => {
    const { validateReturn } = createContractValidator(SAMPLE_IDL);
    assert.doesNotThrow(() => validateReturn('getUser', { id: 1, name: 'Alice', active: true }));
    assert.throws(
      () => validateReturn('getUser', { id: 'bad', name: 'Alice', active: true }),
      (e) => e instanceof TypeError
    );
  });

  it('throws for unknown method', () => {
    const { validateParams } = createContractValidator(SAMPLE_IDL);
    assert.throws(
      () => validateParams('nonexistent', {}),
      (e) => e instanceof TypeError
    );
  });
});

describe('generateClientStub', () => {
  it('generates valid JavaScript source', () => {
    const stub = generateClientStub(SAMPLE_IDL);
    assert.ok(stub.includes('class CalculatorClient'));
    assert.ok(stub.includes('async add'));
    assert.ok(stub.includes('async getUser'));
    assert.ok(stub.includes("this._rpc.call('add'"));
    assert.ok(stub.includes("this._rpc.call('getUser'"));
  });
});
