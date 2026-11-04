//! The TMDB key and Trakt client ID, unmasked at run time from what build.rs wrote.
//! shortcut: masking only stops `strings`-style scraping of the exe. Both values still travel in every request, so anyone
//! watching their own traffic can read them. A server-side proxy holding the TMDB key is the real fix if abuse appears.
use std::sync::LazyLock;

include!(concat!(env!("OUT_DIR"), "/keys.rs"));

fn reveal(masked: &[u8]) -> String {
    // black_box stops the optimizer from folding the XOR at compile time, which would put the plain text back in the exe.
    let pad = std::hint::black_box(PAD);
    String::from_utf8(masked.iter().zip(pad.iter().cycle()).map(|(b, p)| b ^ p).collect()).expect(".env.local keys are ASCII")
}

pub static TMDB: LazyLock<String> = LazyLock::new(|| reveal(TMDB_MASKED));
pub static TRAKT: LazyLock<String> = LazyLock::new(|| reveal(TRAKT_MASKED));

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_unmask_to_text() {
        assert!(!TMDB.is_empty() && TMDB.is_ascii());
        assert!(!TRAKT.is_empty() && TRAKT.is_ascii());
        assert_ne!(TMDB.as_bytes(), TMDB_MASKED);
    }
}
