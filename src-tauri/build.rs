fn main() {
    // Keys live in ../.env.local (git-ignored) and are baked in at compile time.
    // Both are public identifiers (TMDB v3 key, Trakt client ID), not secrets.
    println!("cargo:rerun-if-changed=../.env.local");
    let env = std::fs::read_to_string("../.env.local").expect("create .env.local with TMDB=... and TRAKT=...");
    for line in env.lines() {
        if let Some((key, value)) = line.split_once('=') {
            println!("cargo:rustc-env={}={}", key.trim(), value.trim().trim_matches('"'));
        }
    }
    tauri_build::build();
}
