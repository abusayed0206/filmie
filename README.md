# Filmy

[![CI](https://github.com/abusayed0206/filmy/actions/workflows/ci.yml/badge.svg)](https://github.com/abusayed0206/filmy/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/abusayed0206/filmy)](https://github.com/abusayed0206/filmy/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Filmy is a lightweight Windows app for browsing movies and TV shows and keeping your [Trakt](https://trakt.tv) history up to date. It can also play video in a built-in player from servers you add yourself.

**[Download for Windows](https://github.com/abusayed0206/filmy/releases/latest/download/Filmy-Setup-x64.exe)** · [Website](https://filmy.sayed.app) · [All releases](https://github.com/abusayed0206/filmy/releases)

> **Filmy doesn't host, store or serve any content.** It includes no video servers. It only shows information from TMDB and Trakt, and opens servers you add yourself. See the [Terms of Use](TERMS.md).

## Features

- **Browse:** trending, popular and most anticipated titles, with search, cast, trailers and where to stream.
- **Track with Trakt:** up next, continue watching, watchlist, your lists, ratings and recommendations.
- **Stay in control:** nothing is marked as watched until you press **Mark watched**.
- **Move around a show:** switch seasons and jump straight to any episode from the player.
- **Use your own servers:** add as many as you like and switch between them while watching.
- **Find more info:** links to IMDb, Letterboxd, TMDB, Rotten Tomatoes, Metacritic and Trakt.
- **Watch distraction-free:** fullscreen mode, and pop-ups from embedded pages are blocked.

## Install

1. Download [`Filmy-Setup-x64.exe`](https://github.com/abusayed0206/filmy/releases/latest/download/Filmy-Setup-x64.exe). Each release also lists its SHA-256 checksum.
2. Run the installer.

Filmy needs 64-bit Windows 10 or 11. The installer adds Microsoft's WebView2 runtime if it's missing.

The installer isn't code-signed yet, so Windows SmartScreen may warn you. To continue, choose **More info**, then **Run anyway**.

## How to use

### Connect Trakt (optional)

1. Open **Settings** and choose **Sign in with Trakt**.
2. Enter the code shown in the app on the Trakt page that opens. The code is copied for you.

You can browse without an account. Signing in adds your library, recommendations and tracking.

### Add a video server

Open **Settings**, go to **Video servers**, and add one server per line. Only add servers you have the right to use.

```text
Name | movie URL | TV URL | optional note | optional #rrggbb colour
```

URLs must use `https://` and contain `{tmdb_id}`. TV URLs can also use `{season}` and `{episode}`:

```text
My server | https://example.com/movie/{tmdb_id} | https://example.com/tv/{tmdb_id}/{season}/{episode} | Home server | #e5484d
```

### Watch and track

1. Open a title and press **Play**.
2. On a show, use **Episodes** in the player bar to change season or episode.
3. Press **Mark watched** when you finish. You can also add the title to your watchlist or a list from the same bar.

| Shortcut | Action |
|---|---|
| <kbd>F11</kbd> | Toggle fullscreen |
| <kbd>Esc</kbd> | Close a menu, or leave fullscreen |

## Build from source

You need Windows, [Rust](https://rustup.rs) stable and [Node.js](https://nodejs.org) (only for the UI tests).

```powershell
Copy-Item .env.example .env.local   # then fill in your TMDB key and Trakt client ID
./scripts/fetch-ubol.ps1            # downloads the pinned ad blocker
cd src-tauri
cargo run
```

The UI in `ui/` is compiled into the app, so rebuild after changing it. Close any running copy first.

| Task | Command |
|---|---|
| Rust tests | `cargo test` (in `src-tauri`) |
| UI tests | `node --test tests/ui.test.js` |
| Lint and format | `cargo clippy --all-targets -- -D warnings` and `cargo fmt` (in `src-tauri`) |
| Build the installer | `cargo install tauri-cli --version "^2" --locked`, then `cargo tauri build --bundles nsis` (in `src-tauri`) |

Architecture notes are in [CLAUDE.md](CLAUDE.md), and API research and decisions are in [docs/PLAN.md](docs/PLAN.md).

## Releases and deployment

| Workflow | Runs on | What it does |
|---|---|---|
| `ci.yml` | Pushes and pull requests | Format check, UI tests, Clippy and Rust tests |
| `audit.yml` | Dependency changes and weekly | Checks Rust dependencies for known vulnerabilities |
| `release.yml` | `v*` tags | Builds the installer and publishes a GitHub release |
| `site.yml` | Changes in `site/` | Deploys the website to Cloudflare Workers |

To publish a version, set `version` in `src-tauri/tauri.conf.json`, then push a matching tag such as `v0.1.0`.

These repository secrets are needed:

| Secret | Used by |
|---|---|
| `TMDB`, `TRAKT`, `TRAKT_REDIRECT_URI` | `release.yml` |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | `site.yml` |

## Legal

- [MIT License](LICENSE)
- [Terms of Use](TERMS.md)
- [Privacy](PRIVACY.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

Filmy uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB. Filmy uses Trakt but is not endorsed or certified by Trakt. Streaming availability data is provided by JustWatch.
