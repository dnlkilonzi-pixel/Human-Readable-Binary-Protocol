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
