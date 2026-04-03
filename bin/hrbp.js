#!/usr/bin/env node
'use strict';

/**
 * hrbp — HRBP DevTools CLI
 *
 * Commands:
 *
 *   hrbp inspect  <file.bin>                  Pretty-print the HRBP structure.
 *   hrbp hexdump  <file.bin>                  Print an annotated hex dump.
 *   hrbp decode   <file.bin>                  Decode and print as JSON.
 *   hrbp encode  [--json '<json>']            Encode JSON to HRBP binary (stdout).
 *   hrbp serve   [--port <n>] [--host <h>]   Start a minimal RPC echo server.
 *   hrbp ping    [--port <n>] [--host <h>]   Ping an RPC server's health check.
 *   hrbp version                              Print the current protocol version.
 *
 * Pipe-friendly: omit the file argument to read from stdin.
 *
 * Examples:
 *
 *   hrbp inspect  message.bin
 *   hrbp hexdump  message.bin
 *   hrbp decode   message.bin
 *   hrbp encode  --json '{"name":"Alice","age":30}' > out.bin
 *   cat out.bin | hrbp inspect
 *   hrbp serve --port 7001
 *   hrbp ping  --port 7001
 */

const fs = require('fs');
const path = require('path');
const { inspect, hexDump, encode, decode, CURRENT_VERSION } = require('../src/index');
const { HRBPRpcServer } = require('../src/rpc/server');
const { HRBPRpcClient } = require('../src/rpc/client');
const { attachHealthCheck } = require('../src/discovery/health');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readFile(filePath) {
  if (!fs.existsSync(filePath)) {
    die(`File not found: ${filePath}\n  Hint: use stdin by omitting the file argument, e.g. "cat data.bin | hrbp ${command}"`);
  }
  return fs.readFileSync(filePath);
}

function readStdin() {
  return fs.readFileSync(0); // fd 0 = stdin; works with piped input
}

function die(msg) {
  process.stderr.write(`hrbp: ${msg}\n`);
  process.exit(1);
}

function usage() {
  process.stdout.write(`hrbp — Human-Readable Binary Protocol DevTools

Usage:
  hrbp inspect  <file.bin>                  Pretty-print the HRBP structure
  hrbp hexdump  <file.bin>                  Annotated hex dump
  hrbp decode   <file.bin>                  Decode to JSON
  hrbp encode  [--json '<json>']            Encode JSON to HRBP binary (stdout)
  hrbp serve   [--port <n>] [--host <h>]   Start a minimal RPC echo server
  hrbp ping    [--port <n>] [--host <h>]   Ping a server health check
  hrbp version                              Print the protocol version

Options:
  --port  Server / target port (default: 7001)
  --host  Server / target host (default: 127.0.0.1)
  --json  JSON string to encode (for 'encode' command)
  -h, --help  Show this help

When <file.bin> is omitted, stdin is read.

Examples:
  hrbp encode --json '{"name":"Alice","age":30}' > out.bin
  hrbp inspect out.bin
  hrbp decode  out.bin
  cat out.bin | hrbp hexdump
  hrbp serve --port 7001
  hrbp ping  --port 7001 --host 10.0.0.1
`);
  process.exit(0);
}

/** Parse --key value pairs from an args array; returns { flags, rest }. */
function parseFlags(args) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && i + 1 < args.length && !args[i + 1].startsWith('--')) {
      flags[args[i].slice(2)] = args[i + 1];
      i++;
    } else if (!args[i].startsWith('--')) {
      rest.push(args[i]);
    }
  }
  return { flags, rest };
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

function cmdInspect(args) {
  const { rest } = parseFlags(args);
  let buf;
  try {
    buf = rest[0] ? readFile(rest[0]) : readStdin();
  } catch (e) {
    die(e.message);
  }
  try {
    process.stdout.write(inspect(buf) + '\n');
  } catch (e) {
    die(`Failed to inspect buffer: ${e.message}\n  Hint: make sure the file contains valid HRBP binary data, not raw text or JSON`);
  }
}

function cmdHexdump(args) {
  const { rest } = parseFlags(args);
  let buf;
  try {
    buf = rest[0] ? readFile(rest[0]) : readStdin();
  } catch (e) {
    die(e.message);
  }
  process.stdout.write(hexDump(buf) + '\n');
}

function cmdDecode(args) {
  const { rest } = parseFlags(args);
  let buf;
  try {
    buf = rest[0] ? readFile(rest[0]) : readStdin();
  } catch (e) {
    die(e.message);
  }
  let value;
  try {
    value = decode(buf);
  } catch (e) {
    die(`Failed to decode buffer: ${e.message}\n  Hint: use "hrbp inspect" to examine the raw structure, or "hrbp hexdump" for a hex view`);
  }
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

function cmdEncode(args) {
  const { flags, rest } = parseFlags(args);
  let jsonStr;

  if (flags.json) {
    jsonStr = flags.json;
  } else if (rest[0]) {
    // positional: hrbp encode file.json
    try {
      jsonStr = readFile(rest[0]).toString('utf8');
    } catch (e) {
      die(e.message);
    }
  } else {
    // stdin
    jsonStr = readStdin().toString('utf8');
  }

  let value;
  try {
    value = JSON.parse(jsonStr);
  } catch (e) {
    die(`Invalid JSON: ${e.message}\n  Hint: pass a JSON string with --json '{"key":"value"}' or pipe a JSON file via stdin`);
  }

  const buf = encode(value);
  process.stdout.write(buf);
}

function cmdVersion() {
  process.stdout.write(`HRBP protocol version: ${CURRENT_VERSION}\n`);
}

/**
 * Start a minimal RPC server that echoes every call's params back.
 * Useful for manual integration testing.
 */
function cmdServe(args) {
  const { flags } = parseFlags(args);
  const port = parseInt(flags.port || '7001', 10);
  const host = flags.host || '127.0.0.1';

  if (isNaN(port) || port < 1 || port > 65535) {
    die(`Invalid port: "${flags.port}". Port must be a number between 1 and 65535.`);
  }

  const server = new HRBPRpcServer();
  attachHealthCheck(server, { serviceName: 'hrbp-cli-serve' });

  // Generic echo handler — responds to any method with its params
  server.use(async (envelope) => {
    process.stderr.write(`  → ${envelope.method}  ${JSON.stringify(envelope.params)}\n`);
    return envelope;
  });

  // Register a catch-all by intercepting unknown-method errors in middleware
  const originalHandle = server.handle.bind(server);
  server._defaultHandler = async (params) => params;
  server._handlers.set('__echo', server._defaultHandler);

  server.listen(port, host, () => {
    process.stdout.write(
      `hrbp serve  listening on ${host}:${port}\n` +
      `  Any unknown RPC method echoes its params back.\n` +
      `  Built-in:  __health  (health check)\n` +
      `  Press Ctrl-C to stop.\n`
    );
  });

  process.on('SIGINT', () => {
    process.stdout.write('\nhrbp serve  shutting down.\n');
    server.close(() => process.exit(0));
  });
}

/**
 * Ping the __health endpoint of an RPC server.
 * Exits 0 if healthy, 1 otherwise.
 */
function cmdPing(args) {
  const { flags } = parseFlags(args);
  const port = parseInt(flags.port || '7001', 10);
  const host = flags.host || '127.0.0.1';

  if (isNaN(port) || port < 1 || port > 65535) {
    die(`Invalid port: "${flags.port}". Port must be a number between 1 and 65535.`);
  }

  const client = new HRBPRpcClient();
  const timer = setTimeout(() => {
    process.stderr.write(`hrbp ping: timed out connecting to ${host}:${port}\n`);
    client.close();
    process.exit(1);
  }, 5000);
  timer.unref();

  client.connect(port, host, async () => {
    clearTimeout(timer);
    try {
      const health = await client.call('__health', {});
      const status = health && health.status ? health.status : 'unknown';
      const service = health && health.service ? health.service : 'unknown';
      process.stdout.write(
        `hrbp ping  ${host}:${port}  status=${status}  service=${service}  uptime=${health.uptime}ms\n`
      );
      client.close();
      process.exit(status === 'healthy' ? 0 : 1);
    } catch (e) {
      process.stderr.write(`hrbp ping: __health call failed: ${e.message}\n  Hint: make sure the server was started with attachHealthCheck()\n`);
      client.close();
      process.exit(1);
    }
  });

  client._client.on('error', (e) => {
    clearTimeout(timer);
    process.stderr.write(
      `hrbp ping: cannot connect to ${host}:${port}: ${e.message}\n` +
      `  Hint: start a server with "hrbp serve --port ${port}" or check the host/port\n`
    );
    process.exit(1);
  });
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const [, , command, ...rest] = process.argv;

// Export command name so readFile() can use it in error hints
let cmd = command; // intentional let — read in readFile helper below
// Fix forward reference for die() hint in readFile
Object.defineProperty(global, 'command', { get: () => cmd, configurable: true });

if (!command || command === '--help' || command === '-h') {
  usage();
}

const COMMANDS = ['inspect', 'hexdump', 'decode', 'encode', 'serve', 'ping', 'version'];

switch (command) {
  case 'inspect':  cmdInspect(rest); break;
  case 'hexdump':  cmdHexdump(rest); break;
  case 'decode':   cmdDecode(rest);  break;
  case 'encode':   cmdEncode(rest);  break;
  case 'serve':    cmdServe(rest);   break;
  case 'ping':     cmdPing(rest);    break;
  case 'version':  cmdVersion();     break;
  default: {
    const similar = COMMANDS.filter((c) => c.startsWith(command[0]));
    const hint = similar.length
      ? `\n  Did you mean: ${similar.join(', ')}?`
      : `\n  Available commands: ${COMMANDS.join(', ')}`;
    die(`Unknown command: "${command}".${hint}\n  Run "hrbp --help" for full usage.`);
  }
}
