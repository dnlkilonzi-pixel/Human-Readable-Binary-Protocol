//! HRBP — Human-Readable Binary Protocol (Rust port, v1)
//!
//! Pure-`std` implementation matching SPEC.md exactly.
//! No external crate dependencies.
//!
//! # Example
//! ```rust
//! use hrbp::{Value, encode, decode};
//!
//! let value = Value::Object(vec![
//!     ("name".to_string(), Value::String("Alice".to_string())),
//!     ("age".to_string(),  Value::Int32(30)),
//! ]);
//!
//! let buf = encode(&value);
//! let decoded = decode(&buf).unwrap();
//! assert_eq!(decoded, value);
//! ```

use std::convert::TryInto;

// ---------------------------------------------------------------------------
// Type tags
// ---------------------------------------------------------------------------

const TAG_INT32:  u8 = 0x49; // 'I'
const TAG_FLOAT:  u8 = 0x46; // 'F'
const TAG_STRING: u8 = 0x53; // 'S'
const TAG_TRUE:   u8 = 0x54; // 'T'
const TAG_FALSE:  u8 = 0x58; // 'X'
const TAG_NULL:   u8 = 0x4E; // 'N'
const TAG_ARRAY:  u8 = 0x5B; // '['
const TAG_OBJECT: u8 = 0x7B; // '{'
const TAG_BUFFER: u8 = 0x42; // 'B'
const TAG_HEADER: u8 = 0x48; // 'H'

pub const CURRENT_VERSION: u8 = 1;
pub const MAX_SUPPORTED_VERSION: u8 = 1;

// ---------------------------------------------------------------------------
// Value type
// ---------------------------------------------------------------------------

/// A decoded HRBP value.
#[derive(Debug, PartialEq, Clone)]
pub enum Value {
    Null,
    Bool(bool),
    Int32(i32),
    Float(f64),
    String(std::string::String),
    Buffer(Vec<u8>),
    Array(Vec<Value>),
    /// Object — ordered list of (key, value) pairs.
    Object(Vec<(std::string::String, Value)>),
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

#[derive(Debug, PartialEq, Eq)]
pub enum HrbpError {
    /// Buffer ended before a complete value was read.
    Truncated,
    /// Unknown type tag encountered.
    BadTag(u8),
    /// Object key was not a string.
    BadKey,
    /// Protocol version is too new for this implementation.
    UnsupportedVersion(u8),
    /// Argument was invalid.
    InvalidArg,
}

impl std::fmt::Display for HrbpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HrbpError::Truncated              => write!(f, "buffer truncated"),
            HrbpError::BadTag(t)              => write!(f, "unknown tag 0x{t:02X}"),
            HrbpError::BadKey                 => write!(f, "object key is not a string"),
            HrbpError::UnsupportedVersion(v)  => write!(f, "unsupported version {v}"),
            HrbpError::InvalidArg             => write!(f, "invalid argument"),
        }
    }
}

impl std::error::Error for HrbpError {}

pub type Result<T> = std::result::Result<T, HrbpError>;

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/// Encode a [`Value`] into an HRBP byte vector.
pub fn encode(value: &Value) -> Vec<u8> {
    let mut buf = Vec::new();
    encode_into(value, &mut buf);
    buf
}

fn encode_into(value: &Value, buf: &mut Vec<u8>) {
    match value {
        Value::Null => {
            buf.push(TAG_NULL);
        }
        Value::Bool(true) => {
            buf.push(TAG_TRUE);
        }
        Value::Bool(false) => {
            buf.push(TAG_FALSE);
        }
        Value::Int32(n) => {
            buf.push(TAG_INT32);
            buf.extend_from_slice(&n.to_be_bytes());
        }
        Value::Float(f) => {
            buf.push(TAG_FLOAT);
            buf.extend_from_slice(&f.to_be_bytes());
        }
        Value::String(s) => {
            let bytes = s.as_bytes();
            buf.push(TAG_STRING);
            buf.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
            buf.extend_from_slice(bytes);
        }
        Value::Buffer(b) => {
            buf.push(TAG_BUFFER);
            buf.extend_from_slice(&(b.len() as u32).to_be_bytes());
            buf.extend_from_slice(b);
        }
        Value::Array(items) => {
            buf.push(TAG_ARRAY);
            buf.extend_from_slice(&(items.len() as u32).to_be_bytes());
            for item in items {
                encode_into(item, buf);
            }
        }
        Value::Object(pairs) => {
            buf.push(TAG_OBJECT);
            buf.extend_from_slice(&(pairs.len() as u32).to_be_bytes());
            for (key, val) in pairs {
                let key_bytes = key.as_bytes();
                buf.push(TAG_STRING);
                buf.extend_from_slice(&(key_bytes.len() as u32).to_be_bytes());
                buf.extend_from_slice(key_bytes);
                encode_into(val, buf);
            }
        }
    }
}

/// Encode a [`Value`] with a version header prefix.
pub fn encode_versioned(value: &Value, version: u8) -> Vec<u8> {
    let mut buf = vec![TAG_HEADER, version];
    encode_into(value, &mut buf);
    buf
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/// Decode the first HRBP value from `buf`.
pub fn decode(buf: &[u8]) -> Result<Value> {
    let (value, _) = decode_at(buf, 0)?;
    Ok(value)
}

/// Decode all HRBP values packed sequentially in `buf`.
pub fn decode_all(buf: &[u8]) -> Result<Vec<Value>> {
    let mut results = Vec::new();
    let mut offset = 0;
    while offset < buf.len() {
        let (value, next) = decode_at(buf, offset)?;
        results.push(value);
        offset = next;
    }
    Ok(results)
}

/// Decode a versioned frame. Returns `(version, value)`.
pub fn decode_versioned(buf: &[u8]) -> Result<(u8, Value)> {
    if buf.len() < 2 {
        return Err(HrbpError::Truncated);
    }
    if buf[0] != TAG_HEADER {
        return Err(HrbpError::BadTag(buf[0]));
    }
    let version = buf[1];
    if version > MAX_SUPPORTED_VERSION {
        return Err(HrbpError::UnsupportedVersion(version));
    }
    let value = decode(&buf[2..])?;
    Ok((version, value))
}

fn read_u32be(buf: &[u8], offset: usize) -> Result<u32> {
    if offset + 4 > buf.len() {
        return Err(HrbpError::Truncated);
    }
    Ok(u32::from_be_bytes([buf[offset], buf[offset+1], buf[offset+2], buf[offset+3]]))
}

fn decode_at(buf: &[u8], offset: usize) -> Result<(Value, usize)> {
    if offset >= buf.len() {
        return Err(HrbpError::Truncated);
    }
    let tag = buf[offset];
    let offset = offset + 1;

    match tag {
        TAG_NULL  => Ok((Value::Null, offset)),
        TAG_TRUE  => Ok((Value::Bool(true),  offset)),
        TAG_FALSE => Ok((Value::Bool(false), offset)),

        TAG_INT32 => {
            if offset + 4 > buf.len() { return Err(HrbpError::Truncated); }
            let n = i32::from_be_bytes([buf[offset], buf[offset+1], buf[offset+2], buf[offset+3]]);
            Ok((Value::Int32(n), offset + 4))
        }

        TAG_FLOAT => {
            if offset + 8 > buf.len() { return Err(HrbpError::Truncated); }
            let f = f64::from_be_bytes(buf[offset..offset+8].try_into().unwrap());
            Ok((Value::Float(f), offset + 8))
        }

        TAG_STRING => {
            let len = read_u32be(buf, offset)? as usize;
            let offset = offset + 4;
            if offset + len > buf.len() { return Err(HrbpError::Truncated); }
            let s = std::str::from_utf8(&buf[offset..offset+len])
                .map_err(|_| HrbpError::BadTag(TAG_STRING))?
                .to_string();
            Ok((Value::String(s), offset + len))
        }

        TAG_BUFFER => {
            let len = read_u32be(buf, offset)? as usize;
            let offset = offset + 4;
            if offset + len > buf.len() { return Err(HrbpError::Truncated); }
            Ok((Value::Buffer(buf[offset..offset+len].to_vec()), offset + len))
        }

        TAG_ARRAY => {
            let count = read_u32be(buf, offset)? as usize;
            let mut offset = offset + 4;
            let mut items = Vec::with_capacity(count);
            for _ in 0..count {
                let (item, next) = decode_at(buf, offset)?;
                items.push(item);
                offset = next;
            }
            Ok((Value::Array(items), offset))
        }

        TAG_OBJECT => {
            let count = read_u32be(buf, offset)? as usize;
            let mut offset = offset + 4;
            let mut pairs = Vec::with_capacity(count);
            for _ in 0..count {
                let (key_val, next) = decode_at(buf, offset)?;
                let key = match key_val {
                    Value::String(s) => s,
                    _ => return Err(HrbpError::BadKey),
                };
                offset = next;
                let (val, next) = decode_at(buf, offset)?;
                pairs.push((key, val));
                offset = next;
            }
            Ok((Value::Object(pairs), offset))
        }

        other => Err(HrbpError::BadTag(other)),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn rt(value: &Value) -> Value {
        decode(&encode(value)).expect("round-trip failed")
    }

    #[test]
    fn test_null() {
        assert_eq!(rt(&Value::Null), Value::Null);
    }

    #[test]
    fn test_bool() {
        assert_eq!(rt(&Value::Bool(true)),  Value::Bool(true));
        assert_eq!(rt(&Value::Bool(false)), Value::Bool(false));
    }

    #[test]
    fn test_int32() {
        for n in [0, 1, -1, 42, i32::MAX, i32::MIN] {
            assert_eq!(rt(&Value::Int32(n)), Value::Int32(n), "int32 {n}");
        }
    }

    #[test]
    fn test_float() {
        let v = Value::Float(3.14);
        assert_eq!(rt(&v), v);
    }

    #[test]
    fn test_string() {
        for s in ["", "hello", "こんにちは"] {
            let v = Value::String(s.to_string());
            assert_eq!(rt(&v), v, "string {s:?}");
        }
    }

    #[test]
    fn test_buffer() {
        let v = Value::Buffer(vec![0x00, 0x01, 0xFF]);
        assert_eq!(rt(&v), v);
    }

    #[test]
    fn test_array() {
        let v = Value::Array(vec![Value::Int32(1), Value::String("two".into()), Value::Null]);
        assert_eq!(rt(&v), v);
    }

    #[test]
    fn test_object() {
        let v = Value::Object(vec![
            ("name".to_string(), Value::String("Alice".into())),
            ("age".to_string(),  Value::Int32(30)),
        ]);
        assert_eq!(rt(&v), v);
    }

    #[test]
    fn test_nested() {
        let v = Value::Object(vec![
            ("scores".to_string(), Value::Array(vec![
                Value::Int32(10), Value::Int32(20), Value::Int32(30),
            ])),
        ]);
        assert_eq!(rt(&v), v);
    }

    #[test]
    fn test_versioned_roundtrip() {
        let v = Value::Int32(99);
        let buf = encode_versioned(&v, CURRENT_VERSION);
        let (ver, decoded) = decode_versioned(&buf).unwrap();
        assert_eq!(ver, CURRENT_VERSION);
        assert_eq!(decoded, v);
    }

    #[test]
    fn test_error_bad_tag() {
        let buf = [0xFF_u8];
        assert_eq!(decode(&buf), Err(HrbpError::BadTag(0xFF)));
    }

    #[test]
    fn test_error_truncated() {
        let buf = [TAG_INT32, 0x00, 0x00]; // only 3 bytes, need 4
        assert_eq!(decode(&buf), Err(HrbpError::Truncated));
    }

    #[test]
    fn test_decode_all() {
        let buf: Vec<u8> = [1i32, 2, 3].iter()
            .flat_map(|&n| encode(&Value::Int32(n)))
            .collect();
        let values = decode_all(&buf).unwrap();
        assert_eq!(values, vec![Value::Int32(1), Value::Int32(2), Value::Int32(3)]);
    }

    #[test]
    fn test_unsupported_version() {
        let buf = [TAG_HEADER, 99, TAG_NULL];
        assert_eq!(decode_versioned(&buf), Err(HrbpError::UnsupportedVersion(99)));
    }
}
