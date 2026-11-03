# Filmie

[![CI](https://github.com/abusayed0206/filmie/actions/workflows/ci.yml/badge.svg)](https://github.com/abusayed0206/filmie/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/abusayed0206/filmie)](https://github.com/abusayed0206/filmie/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Filmie is a lightweight Windows app for browsing movies and TV shows and keeping your [Trakt](https://trakt.tv) history up to date. It can also play video in a built-in player from servers you add yourself.

**[Download for Windows](https://github.com/abusayed0206/filmie/releases/latest/download/Filmie-Setup-x64.exe)** · [Website](https://filmie.sayed.app) · [All releases](https://github.com/abusayed0206/filmie/releases)

> **Filmie doesn't host, store or serve any content.** It includes no video servers. It only shows information from TMDB and Trakt, and opens servers you add yourself. See the [Terms of Use](TERMS.md).

## Features

- **Browse:** trending, releases, anticipated, popular and more charts, switching between Media, Shows and Movies, with filters for genre, decade, runtime, rating and more.
- **Find anything:** press **Ctrl+K** to jump to a page or title, or search movies, shows, people and lists.
- **See the details:** ratings, seasons and episodes, cast and person pages, comments, videos, related titles, lists and where to stream.
- **Track with Trakt:** continue watching, calendar, watchlist, history, library, progress, your lists, ratings, favorites, notes and recommendations.
- **See your stats:** totals, top genres, ratings, activity and a watching streak, worked out on your PC with no VIP needed. They work offline too.
- **Stay in control:** nothing is marked as watched until you ask, with no check-ins or scrobbling.
- **Recently played:** your own list and progress, kept on your PC and separate from Trakt. Progress shows when the player exposes its video.
- **Fast and offline-friendly:** TMDB and Trakt responses are cached in a local SQLite database.
- **Move around a show:** switch seasons and jump straight to any episode from the player.
- **Use your own servers:** add as many as you like and switch between them while watching.
- **Find more info:** links to IMDb, Letterboxd, TMDB, Rotten Tomatoes, Metacritic and Trakt.
- **Watch distraction-free:** fullscreen mode, and pop-ups from embedded pages are blocked.

## Install

1. Download [`Filmie-Setup-x64.exe`](https://github.com/abusayed0206/filmie/releases/latest/download/Filmie-Setup-x64.exe). Each release also lists its SHA-256 checksum.
2. Run the installer.

Filmie needs 64-bit Windows 10 or 11. The installer adds Microsoft's WebView2 runtime if it's missing.

The installer isn't code-signed yet, so Windows SmartScreen may warn you. To continue, choose **More info**, then **Run anyway**.

## How to use

### Connect Trakt (optional)

1. Open **Settings** and choose **Sign in with Trakt**.
2. Enter the code shown in the app on the Trakt page that opens. The code is copied for you.

You can browse without an account. Signing in adds your library, recommendations and tracking.

### Add a video server

Open **Settings**, go to **Video servers**, and fill in the form. Only add servers you have the right to use.

You need three things:

- **Server link:** the address, starting with `https://`, such as `https://example.com`.
- **Movie structure:** the rest of a movie's link, containing `{tmdb_id}`, such as `/movie/{tmdb_id}`.
- **TV structure:** the rest of an episode's link, containing `{tmdb_id}`, `{season}` and `{episode}`, such as `/tv/{tmdb_id}/{season}/{episode}`.

The form suggests common structures and shows example links before you save. A name, note and accent colour are optional.

To back up your list or add several servers at once, choose **Edit as text**, with one server per line:

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

Filmie uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB. Filmie uses Trakt but is not endorsed or certified by Trakt. Streaming availability data is provided by JustWatch.
