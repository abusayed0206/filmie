use std::hash::{BuildHasher, Hasher};

fn main() {
    // Keys live in ../.env.local (git-ignored) and are baked in at compile time.
    // Both are public identifiers (TMDB v3 key, Trakt client ID), not secrets, but the TMDB key and Trakt client ID
    // are XOR-masked with a pad that changes every build, so they don't sit in the exe as plain strings (see keys.rs).
    println!("cargo:rerun-if-changed=../.env.local");
    let env = std::fs::read_to_string("../.env.local").expect("create .env.local with TMDB=... and TRAKT=...");
    let pad: Vec<u8> = (0..4).flat_map(|_| std::collections::hash_map::RandomState::new().build_hasher().finish().to_le_bytes()).collect();
    let mut masked = String::new();
    for line in env.lines() {
        let Some((key, value)) = line.split_once('=') else { continue };
        let (key, value) = (key.trim(), value.trim().trim_matches('"'));
        if key == "TMDB" || key == "TRAKT" {
            let bytes: Vec<u8> = value.bytes().zip(pad.iter().cycle()).map(|(b, p)| b ^ p).collect();
            masked += &format!("const {key}_MASKED: &[u8] = &{bytes:?};\n");
        } else if !key.starts_with('#') {
            println!("cargo:rustc-env={key}={value}");
        }
    }
    masked += &format!("const PAD: &[u8] = &{pad:?};\n");
    std::fs::write(std::path::Path::new(&std::env::var("OUT_DIR").unwrap()).join("keys.rs"), masked).unwrap();
    tauri_build::build();
}
