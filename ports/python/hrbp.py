"""
HRBP — Human-Readable Binary Protocol  (Python port, v1)

Pure stdlib implementation.  No pip dependencies required.

Wire format matches SPEC.md exactly.

Usage:
    from hrbp import encode, decode

    buf = encode({"name": "Alice", "age": 30})
    value = decode(buf)
    print(value)  # {'name': 'Alice', 'age': 30}

Compression helpers (requires Python 3.2+):
    from hrbp import encode_compressed, decode_compressed
"""

import struct
import gzip
import io
from typing import Any

# ---------------------------------------------------------------------------
# Type tags  (printable ASCII — matches SPEC.md)
# ---------------------------------------------------------------------------
TAG_INT32  = 0x49  # 'I'
TAG_FLOAT  = 0x46  # 'F'
TAG_STRING = 0x53  # 'S'
TAG_TRUE   = 0x54  # 'T'
TAG_FALSE  = 0x58  # 'X'
TAG_NULL   = 0x4E  # 'N'
TAG_ARRAY  = 0x5B  # '['
TAG_OBJECT = 0x7B  # '{'
TAG_BUFFER = 0x42  # 'B'
TAG_HEADER = 0x48  # 'H'

INT32_MIN = -(1 << 31)
INT32_MAX =  (1 << 31) - 1

CURRENT_VERSION = 1
MAX_SUPPORTED_VERSION = 1

# ---------------------------------------------------------------------------
# Encode
# ---------------------------------------------------------------------------

def encode(value: Any) -> bytes:
    """Encode a Python value to HRBP bytes."""
    if value is None:
        return bytes([TAG_NULL])

    if isinstance(value, bool):
        return bytes([TAG_TRUE if value else TAG_FALSE])

    if isinstance(value, int):
        if INT32_MIN <= value <= INT32_MAX:
            return bytes([TAG_INT32]) + struct.pack('>i', value)
        # Fallthrough to float for out-of-range ints.
        return bytes([TAG_FLOAT]) + struct.pack('>d', float(value))

    if isinstance(value, float):
        return bytes([TAG_FLOAT]) + struct.pack('>d', value)

    if isinstance(value, str):
        utf8 = value.encode('utf-8')
        return bytes([TAG_STRING]) + struct.pack('>I', len(utf8)) + utf8

    if isinstance(value, (bytes, bytearray)):
        return bytes([TAG_BUFFER]) + struct.pack('>I', len(value)) + bytes(value)

    if isinstance(value, list):
        encoded_elements = [encode(el) for el in value]
        body = b''.join(encoded_elements)
        return bytes([TAG_ARRAY]) + struct.pack('>I', len(value)) + body

    if isinstance(value, dict):
        pairs = b''
        for k, v in value.items():
            if not isinstance(k, str):
                raise TypeError(f'Object keys must be strings, got {type(k).__name__}')
            pairs += encode(k) + encode(v)
        return bytes([TAG_OBJECT]) + struct.pack('>I', len(value)) + pairs

    raise TypeError(f'Cannot encode value of type {type(value).__name__}')


# ---------------------------------------------------------------------------
# Decode
# ---------------------------------------------------------------------------

class IncompleteBufferError(ValueError):
    """Raised when the buffer ends before a complete value has been read."""


def decode(buf: bytes) -> Any:
    """Decode the first HRBP value from `buf`."""
    value, _ = _decode_at(buf, 0)
    return value


def decode_all(buf: bytes) -> list:
    """Decode all HRBP values packed sequentially in `buf`."""
    results = []
    offset = 0
    while offset < len(buf):
        value, offset = _decode_at(buf, offset)
        results.append(value)
    return results


def _assert_bounds(buf: bytes, offset: int, needed: int) -> None:
    if offset + needed > len(buf):
        raise IncompleteBufferError(
            f'Buffer too short: need {needed} byte(s) at offset {offset}, '
            f'buffer length is {len(buf)}'
        )


def _decode_at(buf: bytes, offset: int):
    _assert_bounds(buf, offset, 1)
    tag = buf[offset]
    offset += 1

    if tag == TAG_NULL:
        return None, offset

    if tag == TAG_TRUE:
        return True, offset

    if tag == TAG_FALSE:
        return False, offset

    if tag == TAG_INT32:
        _assert_bounds(buf, offset, 4)
        (value,) = struct.unpack_from('>i', buf, offset)
        return value, offset + 4

    if tag == TAG_FLOAT:
        _assert_bounds(buf, offset, 8)
        (value,) = struct.unpack_from('>d', buf, offset)
        return value, offset + 8

    if tag == TAG_STRING:
        _assert_bounds(buf, offset, 4)
        (length,) = struct.unpack_from('>I', buf, offset)
        offset += 4
        _assert_bounds(buf, offset, length)
        value = buf[offset:offset + length].decode('utf-8')
        return value, offset + length

    if tag == TAG_BUFFER:
        _assert_bounds(buf, offset, 4)
        (length,) = struct.unpack_from('>I', buf, offset)
        offset += 4
        _assert_bounds(buf, offset, length)
        value = buf[offset:offset + length]
        return value, offset + length

    if tag == TAG_ARRAY:
        _assert_bounds(buf, offset, 4)
        (count,) = struct.unpack_from('>I', buf, offset)
        offset += 4
        items = []
        for _ in range(count):
            item, offset = _decode_at(buf, offset)
            items.append(item)
        return items, offset

    if tag == TAG_OBJECT:
        _assert_bounds(buf, offset, 4)
        (count,) = struct.unpack_from('>I', buf, offset)
        offset += 4
        obj = {}
        for _ in range(count):
            key, offset = _decode_at(buf, offset)
            if not isinstance(key, str):
                raise ValueError(f'Object key must be a STRING, got tag 0x{buf[offset]:02X}')
            val, offset = _decode_at(buf, offset)
            obj[key] = val
        return obj, offset

    raise ValueError(f'Unknown HRBP type tag 0x{tag:02X} at offset {offset - 1}')


# ---------------------------------------------------------------------------
# Versioned frames
# ---------------------------------------------------------------------------

def encode_versioned(value: Any, version: int = CURRENT_VERSION) -> bytes:
    """Encode `value` with a version header prefix."""
    if not (0 <= version <= 255):
        raise ValueError(f'Version must be in [0, 255], got {version}')
    return bytes([TAG_HEADER, version]) + encode(value)


def decode_versioned(buf: bytes):
    """Decode a versioned frame.  Returns (version, value)."""
    if len(buf) < 2:
        raise ValueError(f'Versioned frame too short: need 2 bytes, got {len(buf)}')
    if buf[0] != TAG_HEADER:
        raise ValueError(f'Expected HEADER tag 0x{TAG_HEADER:02X}, got 0x{buf[0]:02X}')
    version = buf[1]
    if version > MAX_SUPPORTED_VERSION:
        raise ValueError(
            f'Unsupported protocol version {version}; maximum supported is {MAX_SUPPORTED_VERSION}'
        )
    value = decode(buf[2:])
    return version, value


# ---------------------------------------------------------------------------
# Compression
# ---------------------------------------------------------------------------

def compress(data: bytes) -> bytes:
    """Gzip-compress `data`."""
    out = io.BytesIO()
    with gzip.GzipFile(fileobj=out, mode='wb') as f:
        f.write(data)
    return out.getvalue()


def decompress(data: bytes) -> bytes:
    """Gunzip-decompress `data`."""
    with gzip.GzipFile(fileobj=io.BytesIO(data), mode='rb') as f:
        return f.read()


def encode_compressed(value: Any) -> bytes:
    """Encode `value` and gzip-compress the result."""
    return compress(encode(value))


def decode_compressed(data: bytes) -> Any:
    """Decompress `data` and decode the HRBP payload."""
    return decode(decompress(data))


# ---------------------------------------------------------------------------
# Quick self-test (run with: python hrbp.py)
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    test_cases = [
        None,
        True,
        False,
        0,
        -1,
        2147483647,
        -2147483648,
        3.14,
        '',
        'hello',
        'こんにちは',
        b'\x00\x01\x02',
        [],
        [1, 'two', None, True],
        {},
        {'name': 'Alice', 'age': 30, 'active': True},
        {'nested': {'a': [1, 2, 3]}},
    ]

    passed = 0
    for original in test_cases:
        buf = encode(original)
        recovered = decode(buf)
        if recovered != original:
            print(f'FAIL: {original!r} → {recovered!r}')
        else:
            passed += 1

    # Versioned round-trip
    ver, val = decode_versioned(encode_versioned({'x': 1}))
    assert ver == 1 and val == {'x': 1}, 'versioned round-trip failed'
    passed += 1

    # Compressed round-trip
    orig = {'big': 'data' * 100}
    assert decode_compressed(encode_compressed(orig)) == orig
    passed += 1

    print(f'All {passed} Python port tests passed.')
