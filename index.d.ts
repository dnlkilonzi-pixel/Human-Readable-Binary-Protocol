/**
 * Human-Readable Binary Protocol (HRBP)
 *
 * TypeScript type declarations for the public API.
 *
 * Install:  npm install human-readable-binary-protocol
 * Usage:    import { encode, decode, inspect, hexDump } from 'human-readable-binary-protocol';
 */

/// <reference types="node" />

// ---------------------------------------------------------------------------
// Core codec
// ---------------------------------------------------------------------------

/** Encode a JavaScript value into an HRBP-encoded Buffer. */
export function encode(value: unknown): Buffer;

/** Decode the first HRBP value from a Buffer. */
export function decode(buffer: Buffer): unknown;

/** Decode all HRBP values packed sequentially in a Buffer. */
export function decodeAll(buffer: Buffer): unknown[];

// ---------------------------------------------------------------------------
// Inspection / debugging
// ---------------------------------------------------------------------------

export interface InspectOptions {
  /** Spaces per indentation level (default: 2). */
  indent?: number;
}

export interface HexDumpOptions {
  /** Bytes per row (default: 16). */
  bytesPerRow?: number;
}

/** Return a human-readable text description of an HRBP buffer. */
export function inspect(buffer: Buffer, options?: InspectOptions): string;

/** Return an annotated hex dump of an HRBP buffer. */
export function hexDump(buffer: Buffer, options?: HexDumpOptions): string;

// ---------------------------------------------------------------------------
// Type tags
// ---------------------------------------------------------------------------

export const TAG: Readonly<{
  INT32:  number; // 0x49 'I'
  FLOAT:  number; // 0x46 'F'
  STRING: number; // 0x53 'S'
  TRUE:   number; // 0x54 'T'
  FALSE:  number; // 0x58 'X'
  NULL:   number; // 0x4E 'N'
  ARRAY:  number; // 0x5B '['
  OBJECT: number; // 0x7B '{'
  BUFFER: number; // 0x42 'B'
  HEADER: number; // 0x48 'H'
}>;

export const TAG_NAME: Readonly<Record<number, string>>;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export function validate(schema: object, value: unknown): void;
export function encodeWithSchema(schema: object, value: unknown): Buffer;
export function decodeWithSchema(schema: object, buffer: Buffer): unknown;

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

export const CURRENT_VERSION: number;
export const MAX_SUPPORTED_VERSION: number;

export function encodeVersioned(value: unknown, version?: number): Buffer;
export function decodeVersioned(buffer: Buffer): { version: number; value: unknown };

// ---------------------------------------------------------------------------
// Compression
// ---------------------------------------------------------------------------

export function compress(buffer: Buffer): Buffer;
export function decompress(buffer: Buffer): Buffer;
export function encodeCompressed(value: unknown): Buffer;
export function decodeCompressed(buffer: Buffer): unknown;

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

export class StreamDecoder {
  constructor(onMessage: (value: unknown) => void);
  push(chunk: Buffer): void;
}

// ---------------------------------------------------------------------------
// Framing
// ---------------------------------------------------------------------------

export function frameEncode(buffer: Buffer): Buffer;

export class FrameDecoder {
  constructor(onMessage: (buffer: Buffer) => void);
  push(chunk: Buffer): void;
}

// ---------------------------------------------------------------------------
// TCP transport
// ---------------------------------------------------------------------------

export class HRBPServer {
  listen(port: number, host?: string): void;
  close(): void;
  on(event: string, listener: (...args: unknown[]) => void): this;
}

export class HRBPConnection {
  send(value: unknown): void;
  close(): void;
  on(event: string, listener: (...args: unknown[]) => void): this;
}

export class HRBPClient {
  connect(port: number, host?: string): Promise<void>;
  send(value: unknown): void;
  close(): void;
  on(event: string, listener: (...args: unknown[]) => void): this;
}

// ---------------------------------------------------------------------------
// RPC layer
// ---------------------------------------------------------------------------

export class HRBPRpcServer {
  register(method: string, handler: (params: unknown) => unknown | Promise<unknown>): void;
  use(middleware: (ctx: object, next: () => Promise<void>) => Promise<void>): void;
  listen(port: number, host?: string): void;
  close(): void;
}

export class HRBPRpcClient {
  connect(port: number, host?: string): Promise<void>;
  call(method: string, params?: unknown): Promise<unknown>;
  close(): void;
}

export function makeCall(id: number, method: string, params: unknown): object;
export function makeReply(id: number, result: unknown): object;
export function makeError(id: number, message: string): object;
export function encodeEnvelope(envelope: object): Buffer;
export function decodeEnvelope(buffer: Buffer): object;

// ---------------------------------------------------------------------------
// Backpressure
// ---------------------------------------------------------------------------

export const DEFAULT_HIGH_WATER_MARK: number;
export const DEFAULT_MAX_MESSAGE_SIZE: number;

export class BackpressureController {
  constructor(options?: { highWaterMark?: number; maxMessageSize?: number });
}

// ---------------------------------------------------------------------------
// Security – TLS
// ---------------------------------------------------------------------------

export class HRBPSecureServer extends HRBPServer {}
export class HRBPSecureClient extends HRBPClient {}
export class HRBPSecureConnection extends HRBPConnection {}

// ---------------------------------------------------------------------------
// Security – Auth
// ---------------------------------------------------------------------------

export function createAuthMiddleware(options: object): (ctx: object, next: () => Promise<void>) => Promise<void>;
export function createRateLimiter(options: object): (ctx: object, next: () => Promise<void>) => Promise<void>;

// ---------------------------------------------------------------------------
// Security – Signing
// ---------------------------------------------------------------------------

export const HMAC_SIZE: number;
export function createSigner(secret: Buffer | string): (buffer: Buffer) => Buffer;
export function createVerifier(secret: Buffer | string): (buffer: Buffer) => boolean;

// ---------------------------------------------------------------------------
// IDL / Contracts
// ---------------------------------------------------------------------------

export function parseIDL(source: string): object;
export function typeToSchema(type: object): object;
export function buildContracts(idl: object): object;
export function createContractValidator(contract: object): (value: unknown) => void;
export function generateClientStub(contract: object): object;

// ---------------------------------------------------------------------------
// Service discovery
// ---------------------------------------------------------------------------

export class ServiceRegistry {
  register(name: string, address: object): void;
  lookup(name: string): object[];
  deregister(name: string, address: object): void;
}

export class LoadBalancer {
  constructor(registry: ServiceRegistry);
  pick(name: string): object | null;
}

export function attachHealthCheck(server: HRBPServer, registry: ServiceRegistry): void;

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------

export class Tracer {
  startSpan(name: string, parent?: object): object;
}

export class InMemoryCollector {
  record(span: object): void;
  spans(): object[];
}

export class MetricsCollector {
  recordCall(method: string, durationMs: number): void;
  summary(): object;
}

export const LOG_LEVELS: Readonly<Record<string, number>>;

export class Logger {
  constructor(options?: { level?: string; sink?: (entry: object) => void });
  info(message: string, meta?: object): void;
  warn(message: string, meta?: object): void;
  error(message: string, meta?: object): void;
  debug(message: string, meta?: object): void;
}

// ---------------------------------------------------------------------------
// Chaos testing
// ---------------------------------------------------------------------------

export class ChaosProxy {
  constructor(options?: object);
}

export function createFaultInjector(options: object): (buffer: Buffer) => Buffer;
export function corruptBuffer(buffer: Buffer, probability?: number): Buffer;

// ---------------------------------------------------------------------------
// Cluster / Horizontal scaling
// ---------------------------------------------------------------------------

export class ConsistentHash {
  add(node: string): void;
  remove(node: string): void;
  get(key: string): string | null;
}

export class ClusterCoordinator {
  constructor(options?: object);
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export class WAL {
  constructor(options?: { path?: string });
  append(entry: unknown): void;
  recover(): unknown[];
}

export class RegistryStore {
  constructor(options?: { path?: string });
}

export class StateStore {
  constructor(options?: { path?: string });
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export class Config {
  constructor(defaults?: object);
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export function deepMerge<T extends object>(target: T, ...sources: Partial<T>[]): T;

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/** Thrown when the buffer ends before a complete value has been read. */
export class IncompleteBufferError extends RangeError {}

// ---------------------------------------------------------------------------
// Interoperability bridges
// ---------------------------------------------------------------------------

// JSON bridge
export function jsonToHRBP(input: string | unknown): Buffer;
export function hrbpToJSON(buffer: Buffer, pretty?: boolean): string;

// MessagePack bridge — codec-free value helpers
export function msgpackValueToHRBP(value: unknown): Buffer;
export function hrbpToMsgpackValue(buffer: Buffer): unknown;

/** Minimal interface a MessagePack codec must expose. */
export interface MsgpackCodec {
  encode(value: unknown): Buffer | Uint8Array;
  decode(buffer: Buffer | Uint8Array): unknown;
}

/** Two-way bridge created by `createMsgpackBridge`. */
export interface MsgpackBridge {
  msgpackToHRBP(mpBuffer: Buffer | Uint8Array): Buffer;
  hrbpToMsgpack(hrbpBuffer: Buffer): Buffer | Uint8Array;
}

export function createMsgpackBridge(codec: MsgpackCodec): MsgpackBridge;

// Protobuf bridge (partial)
export function protobufValueToHRBP(value: unknown): Buffer;
export function hrbpToProtobufValue(buffer: Buffer): unknown;
