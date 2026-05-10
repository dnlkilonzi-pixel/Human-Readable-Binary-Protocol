# HRBP Wire Format Specification

**Human-Readable Binary Protocol (HRBP) — Version 1**

---

## Overview

HRBP is a binary serialisation protocol whose type tags are printable ASCII characters.  
This means raw binary dumps remain partially human-readable: tag bytes like `I`, `S`, `{`, `[` appear as visible characters in any hex editor or terminal hexdump.

The format is:

- **Compact** — fixed-width headers, no redundant metadata.
- **Self-describing** — every value carries its own type tag.
- **Extensible** — the versioning header allows future evolution.
- **Language-agnostic** — this document is the complete implementation contract.

---

## Notation

- All multi-byte integers are **big-endian** unless noted otherwise.
- `uint8`  = 1 unsigned byte (0–255)
- `int32`  = 4-byte signed integer
- `uint32` = 4-byte unsigned integer
- `float64`= 8-byte IEEE 754 double-precision float
- `[…]`   = byte sequence

---

## Type Tags

Each encoded value begins with a single **tag byte**.

| Tag char | Hex  | Type    | Description                                   |
|----------|------|---------|-----------------------------------------------|
| `I`      | 0x49 | INT32   | 32-bit signed integer                         |
| `F`      | 0x46 | FLOAT   | 64-bit IEEE 754 float (double)                |
| `S`      | 0x53 | STRING  | UTF-8 string with uint32 length prefix        |
| `T`      | 0x54 | TRUE    | Boolean true (no payload)                     |
| `X`      | 0x58 | FALSE   | Boolean false (no payload)                    |
| `N`      | 0x4E | NULL    | Null / nil (no payload)                       |
| `[`      | 0x5B | ARRAY   | Ordered sequence of values                    |
| `{`      | 0x7B | OBJECT  | Unordered set of string-keyed values          |
| `B`      | 0x42 | BUFFER  | Raw byte sequence with uint32 length prefix   |
| `H`      | 0x48 | HEADER  | Protocol version header (versioned frames)    |

Any byte not listed above is **invalid** and MUST cause a decode error.

---

## Value Encodings

### NULL — `N` (0x4E)

```
[ 0x4E ]
```

Total: **1 byte**.

---

### TRUE — `T` (0x54)

```
[ 0x54 ]
```

Total: **1 byte**.

---

### FALSE — `X` (0x58)

```
[ 0x58 ]
```

Total: **1 byte**.

---

### INT32 — `I` (0x49)

```
[ 0x49 ] [ int32 value (4 bytes, big-endian signed) ]
```

Total: **5 bytes**.  
Range: −2 147 483 648 to 2 147 483 647.

Numbers outside this range MUST be encoded as FLOAT.

---

### FLOAT — `F` (0x46)

```
[ 0x46 ] [ float64 value (8 bytes, IEEE 754, big-endian) ]
```

Total: **9 bytes**.  
Used for: non-integer numbers, numbers outside int32 range, NaN, ±Infinity.

---

### STRING — `S` (0x53)

```
[ 0x53 ] [ uint32 byte-length (4 bytes) ] [ UTF-8 bytes (byte-length bytes) ]
```

Total: **5 + byte-length bytes**.  
The length field counts **bytes**, not Unicode codepoints.

---

### BUFFER — `B` (0x42)

```
[ 0x42 ] [ uint32 byte-length (4 bytes) ] [ raw bytes (byte-length bytes) ]
```

Total: **5 + byte-length bytes**.  
Opaque byte array; no encoding is applied to the payload.

---

### ARRAY — `[` (0x5B)

```
[ 0x5B ] [ uint32 element-count (4 bytes) ] [ element₀ ] [ element₁ ] … [ elementₙ₋₁ ]
```

Total: **5 bytes + sum of encoded element sizes**.  
Each `elementᵢ` is a complete HRBP-encoded value (recursive).

---

### OBJECT — `{` (0x7B)

```
[ 0x7B ] [ uint32 pair-count (4 bytes) ] [ key₀ ] [ value₀ ] [ key₁ ] [ value₁ ] …
```

Total: **5 bytes + sum of encoded key/value sizes**.

- Each `keyᵢ` MUST be a STRING value (i.e. it begins with `0x53`).
- Each `valueᵢ` is any valid HRBP-encoded value.
- Key order is not guaranteed.
- Duplicate keys SHOULD NOT appear; decoders MAY accept or reject them.

---

## Versioned Frame — `H` (0x48)

A versioned frame wraps an HRBP payload with a one-byte version header:

```
[ 0x48 ] [ version (1 byte) ] [ HRBP payload … ]
```

Total: **2 bytes + payload size**.

| Version | Status       |
|---------|--------------|
| 1       | Current      |
| 2–255   | Reserved     |

Decoders MUST reject frames whose version exceeds their maximum supported version.

---

## TCP Framing

When HRBP messages are sent over a stream protocol (e.g. TCP), a 4-byte length prefix MUST be used to delimit message boundaries:

```
[ uint32 payload-length (4 bytes, big-endian) ] [ HRBP payload (payload-length bytes) ]
```

The `payload-length` field counts the bytes of the HRBP payload only (not including the 4-byte header itself).

Receivers MUST buffer incomplete frames and MUST NOT attempt to decode a payload until `payload-length` bytes have been received.

---

## RPC Envelope

The HRBP RPC layer encodes call/reply messages as plain HRBP objects:

### Call

```json
{ "type": "call", "id": <uint32>, "method": <string>, "params": <any> }
```

### Reply

```json
{ "type": "reply", "id": <uint32>, "result": <any> }
```

### Error

```json
{ "type": "error", "id": <uint32>, "message": <string> }
```

- `id` is a monotonically increasing uint32 chosen by the caller.
- A reply or error MUST use the same `id` as the corresponding call.
- Concurrent calls are matched to responses by `id`.

---

## Example: Encoding `{ "name": "Alice", "age": 30 }`

```
7b                   OBJECT tag '{'
00 00 00 02          2 pairs

53                   STRING tag 'S'  (key: "name")
00 00 00 04          4 bytes
6e 61 6d 65          n a m e

53                   STRING tag 'S'  (value: "Alice")
00 00 00 05          5 bytes
41 6c 69 63 65       A l i c e

53                   STRING tag 'S'  (key: "age")
00 00 00 03          3 bytes
61 67 65             a g e

49                   INT32 tag 'I'
00 00 00 1e          30
```

Total: **36 bytes**.

---

## Conformance

An implementation is conformant if it:

1. Encodes all primitive types as specified above.
2. Decodes all valid HRBP byte sequences back to the equivalent native type.
3. Raises an error for unknown tag bytes.
4. Raises an error for truncated payloads.
5. Decodes versioned frames and rejects unsupported versions.

---

## Version Negotiation

### Normative rules

When communicating over a shared channel (TCP stream, file, IPC pipe), both
parties MUST agree on a version before sending payload data.

1. **Sender** MUST wrap every top-level value in a versioned frame
   (`encodeVersioned`) when version negotiation is required.
2. **Receiver** MUST read the `H` (0x48) header byte and the one-byte version
   field before attempting to decode the payload.
3. If the received version is **≤ MAX_SUPPORTED_VERSION**, the receiver MUST
   decode the payload normally.
4. If the received version is **> MAX_SUPPORTED_VERSION**, the receiver MUST
   reject the frame with an error and SHOULD NOT attempt to decode the payload.
5. A receiver that only understands version 1 MAY still parse version-1 frames
   embedded inside a higher-version envelope if the higher version specifies
   backward-compatible framing.

### Negotiation handshake (RECOMMENDED pattern)

```
Client                      Server
  |--- H v=1 { probe } ---->|
  |<-- H v=1 { ok }  -------|  (server echos back its own max version)
  |                          |
  |--- H v=1 { payload } --->|
```

Both sides SHOULD send a probe frame on connect and use the lower of the two
advertised versions for the rest of the session.

---

## Backward Compatibility Policy

### Guarantees (v1 and beyond)

1. **Wire stability** — the byte layout for all v1 type tags (`I`, `F`, `S`,
   `T`, `X`, `N`, `[`, `{`, `B`, `H`) is **frozen**.  No v1 tag will ever be
   reused for a different type.
2. **Additive-only changes** — new type tags MAY be introduced in future
   versions by reserving a byte value in the tag table.  Existing tags will
   not change meaning.
3. **Version field** — the `H` frame version byte guarantees that decoders can
   detect new wire format versions and reject them gracefully instead of
   silently misinterpreting data.
4. **Opt-in extensions** — features that require new wire bytes (e.g. a new
   numeric type) MUST be gated behind an incremented version number.

### Policy for breaking changes

A change is considered **breaking** if it:

- Alters the byte layout of any existing tag.
- Reuses an existing tag byte for a different semantic.
- Changes endianness or field widths for existing types.

Breaking changes MUST increment the version number and MUST be clearly
documented in both SPEC.md and CHANGELOG entries.

### Deprecation path

Deprecated features SHOULD be marked in this document, continue to work for
at least one full major version, and be removed only with a version bump and
migration notes.

---

## Canonical Encoding Rules

Implementations SHOULD produce **canonical** (deterministic) output to make
encoded buffers comparable byte-for-byte across runtimes, languages, and time.

### Rules

1. **Integer selection** — if a number is an integer in [−2³¹, 2³¹−1] it MUST
   be encoded as INT32 (`I`).  It MUST NOT be encoded as FLOAT.
2. **Float selection** — numbers outside the INT32 range, non-integer numbers,
   NaN, and ±Infinity MUST be encoded as FLOAT (`F`).
3. **String encoding** — strings MUST be encoded as UTF-8.  Byte-order marks
   (U+FEFF) SHOULD be stripped before encoding.
4. **Object key order** — for canonical output, object keys MUST be sorted
   lexicographically by their UTF-8 byte sequences before encoding.
   (Non-canonical implementations MAY omit sorting; recipients MUST NOT depend
   on key order for correctness.)
5. **Null representation** — JavaScript `undefined` MUST be encoded as NULL
   (`N`), matching the behavior of `null`.
6. **No redundant wrappers** — a value MUST NOT be double-encoded (e.g.
   encoding an already-encoded HRBP Buffer as a BUFFER containing another
   HRBP payload, unless that is the intended semantics).

### Canonical encoding and deduplication

Two values are considered **byte-equal** if and only if all of the above
canonical rules are applied before encoding.  Cache keys, content hashes, and
deduplication indexes MAY rely on byte-equality of canonical HRBP output.

---

## Security Considerations

### Malformed and truncated data

1. Decoders MUST NOT attempt to read past the end of the supplied buffer.
   Every length field (`uint32`) MUST be validated before advancing the read
   cursor.  Violation raises an `IncompleteBufferError` (extends `RangeError`).
2. Decoders MUST reject unknown tag bytes immediately rather than skipping them,
   to prevent silent data loss.
3. Decoders MUST NOT interpret an unrecognized tag byte as a no-op.

### Resource limits

4. **String and buffer length** — the `uint32` length field allows values up
   to 4 GiB.  Implementations SHOULD enforce a configurable maximum payload
   size (e.g. 64 MiB by default) and MUST document the limit.
5. **Array and object element counts** — similarly capped by `uint32`.
   Deeply nested or extremely large collections can exhaust heap memory.
   Implementations SHOULD enforce a configurable maximum nesting depth
   (RECOMMENDED default: 64) and a maximum element count per collection.
6. **Recursion depth** — recursive decoders MUST guard against stack overflow
   from adversarially nested structures.  Implementations SHOULD use an
   explicit depth counter rather than relying on the call stack.

### Attacker-controlled payloads

7. **Denial of service via length fields** — an attacker can craft a buffer
   where a `uint32` length field claims a very large value.  Decoders MUST
   check that the claimed length does not exceed both the remaining buffer
   length and the configured maximum before allocating memory.
8. **Hash-flooding via object keys** — object keys are arbitrary strings.
   Implementations backed by hash maps SHOULD use hash-randomisation (Node.js
   V8 does this by default) or limit the number of keys per object.
9. **Prototype pollution** — when decoding into plain JavaScript objects,
   implementations MUST NOT allow keys such as `__proto__`, `constructor`, or
   `prototype` to modify the host object's prototype chain.  The reference
   implementation creates plain objects via `{}` literal which is safe in V8,
   but implementors in other languages MUST audit their object construction.
10. **Signed integer overflow** — INT32 values arriving from an untrusted
    source MUST be treated as signed 32-bit integers in the range
    [−2 147 483 648, 2 147 483 647].  Out-of-range values indicate a malformed
    frame and MUST be rejected.
11. **Versioned frame injection** — a malicious peer could send a frame with a
    future version number to force the receiver into an error path.
    Implementations SHOULD log and rate-limit such failures rather than crashing.

