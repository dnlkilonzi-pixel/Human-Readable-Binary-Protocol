'use strict';

/**
 * HRBP Inspector
 *
 * Produces a human-readable text representation of an HRBP-encoded buffer.
 * Useful for debugging binary messages without a GUI tool.
 *
 * Example output for `encode({ name: "Alice", age: 30, active: true })`:
 *
 *   { (2 pairs)
 *     S(4) "name"
 *       S(5) "Alice"
 *     S(3) "age"
 *       I 30
 *     S(6) "active"
 *       T true
 *   }
 *
 * Also exports `hexDump(buffer)` for annotated hex output.
 */

const { TAG, TAG_NAME } = require('./types');

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return a human-readable text description of the HRBP buffer.
 *
 * @param {Buffer} buffer
 * @param {object} [options]
 * @param {number} [options.indent=2]  Spaces per indentation level.
 * @returns {string}
 */
function inspect(buffer, { indent = 2 } = {}) {
  const lines = [];
  inspectAt(buffer, 0, 0, indent, lines);
  return lines.join('\n');
}

/**
 * Return an annotated hex dump of the buffer showing offsets, hex bytes, and
 * the printable ASCII column (where type tags appear as readable characters).
 *
 * @param {Buffer} buffer
 * @param {object} [options]
 * @param {number} [options.bytesPerRow=16]
 * @returns {string}
 */
function hexDump(buffer, { bytesPerRow = 16 } = {}) {
  const lines = [];
  for (let row = 0; row < buffer.length; row += bytesPerRow) {
    const slice = buffer.slice(row, row + bytesPerRow);
    const hex = Array.from(slice)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ');
    const ascii = Array.from(slice)
      .map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'))
      .join('');
    const offset = row.toString(16).padStart(8, '0');
    lines.push(`${offset}  ${hex.padEnd(bytesPerRow * 3 - 1)}  |${ascii}|`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Internal recursive inspector
// ---------------------------------------------------------------------------

/**
 * @param {Buffer}   buffer
 * @param {number}   offset   Current read position.
 * @param {number}   depth    Current nesting depth.
 * @param {number}   indent   Spaces per level.
 * @param {string[]} lines    Accumulator for output lines.
 * @returns {number}  Next offset after this value.
 */
function inspectAt(buffer, offset, depth, indent, lines) {
  const pad = ' '.repeat(depth * indent);

  if (offset >= buffer.length) return offset;

  const tag = buffer[offset];
  offset += 1;

  switch (tag) {
    case TAG.NULL:
      lines.push(`${pad}N null`);
      return offset;

    case TAG.TRUE:
      lines.push(`${pad}T true`);
      return offset;

    case TAG.FALSE:
      lines.push(`${pad}X false`);
      return offset;

    case TAG.INT32: {
      const value = buffer.readInt32BE(offset);
      lines.push(`${pad}I ${value}`);
      return offset + 4;
    }

    case TAG.FLOAT: {
      const value = buffer.readDoubleBE(offset);
      lines.push(`${pad}F ${value}`);
      return offset + 8;
    }

    case TAG.STRING: {
      const len = buffer.readUInt32BE(offset);
      const str = buffer.toString('utf8', offset + 4, offset + 4 + len);
      lines.push(`${pad}S(${len}) "${escapeString(str)}"`);
      return offset + 4 + len;
    }

    case TAG.BUFFER: {
      const len = buffer.readUInt32BE(offset);
      const preview = buffer.slice(offset + 4, offset + 4 + Math.min(len, 16));
      const hex = Array.from(preview).map((b) => b.toString(16).padStart(2, '0')).join(' ');
      const ellipsis = len > 16 ? ' ...' : '';
      lines.push(`${pad}B(${len}) [${hex}${ellipsis}]`);
      return offset + 4 + len;
    }

    case TAG.ARRAY: {
      const count = buffer.readUInt32BE(offset);
      offset += 4;
      lines.push(`${pad}[ (${count} element${count !== 1 ? 's' : ''})`);
      for (let i = 0; i < count; i++) {
        offset = inspectAt(buffer, offset, depth + 1, indent, lines);
      }
      lines.push(`${pad}]`);
      return offset;
    }

    case TAG.OBJECT: {
      const count = buffer.readUInt32BE(offset);
      offset += 4;
      lines.push(`${pad}{ (${count} pair${count !== 1 ? 's' : ''})`);
      for (let i = 0; i < count; i++) {
        // Key
        offset = inspectAt(buffer, offset, depth + 1, indent, lines);
        // Value (indented one level deeper to show key→value relationship)
        offset = inspectAt(buffer, offset, depth + 2, indent, lines);
      }
      lines.push(`${pad}}`);
      return offset;
    }

    default: {
      lines.push(`${pad}<unknown tag 0x${tag.toString(16).toUpperCase()} at offset ${offset - 1}>`);
      return offset;
    }
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function escapeString(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

module.exports = { inspect, hexDump };
