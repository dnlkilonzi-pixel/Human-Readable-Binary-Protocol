//! Quick demo of the HRBP Rust port.

use hrbp::{Value, encode, decode, encode_versioned, decode_versioned, CURRENT_VERSION};

fn main() {
    // Encode a user object
    let user = Value::Object(vec![
        ("name".to_string(),   Value::String("Alice".to_string())),
        ("age".to_string(),    Value::Int32(30)),
        ("active".to_string(), Value::Bool(true)),
        ("scores".to_string(), Value::Array(vec![
            Value::Int32(10), Value::Int32(20), Value::Int32(30),
        ])),
    ]);

    let buf = encode(&user);
    println!("Encoded {} bytes: {:02X?}", buf.len(), &buf[..buf.len().min(16)]);

    let decoded = decode(&buf).expect("decode failed");
    println!("Decoded: {decoded:?}");
    assert_eq!(decoded, user);

    // Versioned frame
    let vbuf = encode_versioned(&user, CURRENT_VERSION);
    let (version, vdecoded) = decode_versioned(&vbuf).expect("versioned decode failed");
    println!("Version: {version}, value matches: {}", vdecoded == user);

    println!("Demo passed.");
}
