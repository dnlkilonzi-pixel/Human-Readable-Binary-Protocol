#!/usr/bin/env node
'use strict';

/**
 * hrbp — HRBP DevTools CLI
 *
 * Commands:
 *
 *   hrbp inspect  <file.bin>            Pretty-print the HRBP structure.
 *   hrbp hexdump  <file.bin>            Print an annotated hex dump.
 *   hrbp decode   <file.bin>            Decode and print as JSON.
 *   hrbp encode  [--json '<json>']      Encode JSON to HRBP binary (stdout).
 *   hrbp version                        Print the current protocol version.
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
 */

const fs = require('fs');
const path = require('path');
const { inspect, hexDump, encode, decode, CURRENT_VERSION } = require('../src/index');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readFile(filePath) {
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
  process.stdout.write(`Usage:
  hrbp inspect  <file.bin>            Pretty-print the HRBP structure.
  hrbp hexdump  <file.bin>            Print an annotated hex dump.
  hrbp decode   <file.bin>            Decode and print as JSON.
  hrbp encode  [--json '<json>']      Encode JSON to HRBP (stdout).
  hrbp version                        Print the current protocol version.

  When <file.bin> is omitted, stdin is read.
`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

function cmdInspect(args) {
  const buf = args[0] ? readFile(args[0]) : readStdin();
  process.stdout.write(inspect(buf) + '\n');
}

function cmdHexdump(args) {
  const buf = args[0] ? readFile(args[0]) : readStdin();
  process.stdout.write(hexDump(buf) + '\n');
}

function cmdDecode(args) {
  const buf = args[0] ? readFile(args[0]) : readStdin();
  const value = decode(buf);
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

function cmdEncode(args) {
  let jsonStr;

  // --json '<json string>'
  const jsonFlag = args.indexOf('--json');
  if (jsonFlag !== -1 && args[jsonFlag + 1]) {
    jsonStr = args[jsonFlag + 1];
  } else if (args[0] && !args[0].startsWith('--')) {
    // positional: hrbp encode file.json
    jsonStr = readFile(args[0]).toString('utf8');
  } else {
    // stdin
    jsonStr = readStdin().toString('utf8');
  }

  let value;
  try {
    value = JSON.parse(jsonStr);
  } catch (e) {
    die(`Invalid JSON: ${e.message}`);
  }

  const buf = encode(value);
  process.stdout.write(buf);
}

function cmdVersion() {
  process.stdout.write(`HRBP protocol version: ${CURRENT_VERSION}\n`);
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const [, , command, ...rest] = process.argv;

if (!command || command === '--help' || command === '-h') {
  usage();
}

switch (command) {
  case 'inspect':  cmdInspect(rest); break;
  case 'hexdump':  cmdHexdump(rest); break;
  case 'decode':   cmdDecode(rest);  break;
  case 'encode':   cmdEncode(rest);  break;
  case 'version':  cmdVersion();     break;
  default:
    die(`Unknown command: "${command}". Run "hrbp --help" for usage.`);
}
