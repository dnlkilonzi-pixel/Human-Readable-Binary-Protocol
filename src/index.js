'use strict';

/**
 * Human-Readable Binary Protocol (HRBP)
 *
 * A protocol that is simultaneously binary (fast, compact) and
 * human-readable/debuggable.
 *
 * Quick start:
 *
 *   const { encode, decode, inspect, hexDump } = require('human-readable-binary-protocol');
 *
 *   const buf = encode({ name: 'Alice', age: 30, active: true });
 *   // buf is a compact Buffer — but ASCII type tags ('S', 'I', 'T') are
 *   // visible in any hex dump.
 *
 *   const value = decode(buf);
 *   // value => { name: 'Alice', age: 30, active: true }
 *
 *   console.log(inspect(buf));
 *   // { (3 pairs)
 *   //   S(4) "name"
 *   //     S(5) "Alice"
 *   //   S(3) "age"
 *   //     I 30
 *   //   S(6) "active"
 *   //     T true
 *   // }
 *
 *   console.log(hexDump(buf));
 *   // 00000000  7b 00 00 00 03 53 00 00  00 04 6e 61 6d 65 53 00  |{....S....nameS.|
 *   // ...
 */

const { encode } = require('./encoder');
const { decode, decodeAll, IncompleteBufferError } = require('./decoder');
const { inspect, hexDump } = require('./inspector');
const { TAG, TAG_NAME } = require('./types');
const { validate, encodeWithSchema, decodeWithSchema } = require('./schema');
const { encodeVersioned, decodeVersioned, CURRENT_VERSION, MAX_SUPPORTED_VERSION } = require('./versioned');
const { compress, decompress, encodeCompressed, decodeCompressed } = require('./compress');
const { StreamDecoder } = require('./stream');
const { frameEncode, FrameDecoder } = require('./framing');
const { HRBPServer, HRBPConnection } = require('./tcp/server');
const { HRBPClient } = require('./tcp/client');
const { HRBPRpcServer } = require('./rpc/server');
const { HRBPRpcClient } = require('./rpc/client');
const { makeCall, makeReply, makeError, encodeEnvelope, decodeEnvelope } = require('./rpc/protocol');

// Backpressure / Flow control
const { BackpressureController, DEFAULT_HIGH_WATER_MARK, DEFAULT_MAX_MESSAGE_SIZE } = require('./backpressure');

// Security
const { HRBPSecureServer, HRBPSecureClient, HRBPSecureConnection } = require('./security/tls');
const { createAuthMiddleware, createRateLimiter } = require('./security/auth');
const { createSigner, createVerifier, HMAC_SIZE } = require('./security/signing');

// IDL / Schema contracts
const { parseIDL, typeToSchema, buildContracts, createContractValidator, generateClientStub } = require('./idl/index');

// Service discovery
const { ServiceRegistry } = require('./discovery/registry');
const { LoadBalancer } = require('./discovery/loadbalancer');
const { attachHealthCheck } = require('./discovery/health');

// Observability
const { Tracer, InMemoryCollector } = require('./observability/tracing');
const { MetricsCollector } = require('./observability/metrics');
const { Logger, LEVELS: LOG_LEVELS } = require('./observability/logger');

// Chaos testing
const { ChaosProxy, createFaultInjector, corruptBuffer } = require('./chaos');

// Cluster / Horizontal scaling
const { ConsistentHash, ClusterCoordinator } = require('./cluster');

// Persistence
const { WAL, RegistryStore, StateStore } = require('./persistence');

// Configuration
const { Config, deepMerge } = require('./config');

module.exports = {
  // Core
  encode, decode, decodeAll,
  // Inspection
  inspect, hexDump,
  // Constants
  TAG, TAG_NAME,
  // Schema layer
  validate, encodeWithSchema, decodeWithSchema,
  // Versioning
  encodeVersioned, decodeVersioned, CURRENT_VERSION, MAX_SUPPORTED_VERSION,
  // Compression
  compress, decompress, encodeCompressed, decodeCompressed,
  // Streaming
  StreamDecoder,
  // Framing
  frameEncode, FrameDecoder,
  // TCP transport
  HRBPServer, HRBPConnection, HRBPClient,
  // RPC layer
  HRBPRpcServer, HRBPRpcClient,
  makeCall, makeReply, makeError, encodeEnvelope, decodeEnvelope,
  // Backpressure
  BackpressureController, DEFAULT_HIGH_WATER_MARK, DEFAULT_MAX_MESSAGE_SIZE,
  // Security – TLS
  HRBPSecureServer, HRBPSecureClient, HRBPSecureConnection,
  // Security – Auth
  createAuthMiddleware, createRateLimiter,
  // Security – Signing
  createSigner, createVerifier, HMAC_SIZE,
  // IDL / Contracts
  parseIDL, typeToSchema, buildContracts, createContractValidator, generateClientStub,
  // Service discovery
  ServiceRegistry, LoadBalancer, attachHealthCheck,
  // Observability
  Tracer, InMemoryCollector, MetricsCollector, Logger, LOG_LEVELS,
  // Chaos testing
  ChaosProxy, createFaultInjector, corruptBuffer,
  // Cluster / Horizontal scaling
  ConsistentHash, ClusterCoordinator,
  // Persistence
  WAL, RegistryStore, StateStore,
  // Configuration
  Config, deepMerge,
  // Error types
  IncompleteBufferError,
};
