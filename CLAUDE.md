# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Filmie is a Windows desktop app (Tauri 2, WebView2) for browsing movies and TV via TMDB, tracking with Trakt, and playing video from configurable servers in an iframe.

## Commands

Rust and app commands run from `src-tauri/`. The app has no frontend build step and no JS linter.

```bash
cargo run                 # build and launch the app
cargo test                # all Rust tests
cargo test only_app_pages # one Rust test, by name filter
```

From the repo root:

```bash
node --test tests/ui.test.js                                # all UI tests
node --test --test-name-pattern=episodeAfter tests/ui.test.js # one UI test
```

- `.env.local` in the repo root is required to compile. `build.rs` bakes `TMDB`, `TRAKT` and `TRAKT_REDIRECT_URI` into the binary, so never print their values.
- `scripts/fetch-ubol.ps1` downloads the pinned uBlock Origin Lite into the git-ignored `src-tauri/extensions/`. Without it the app still runs, with no extension adblocking.
- The installer needs the Tauri CLI: `cargo install tauri-cli --version "^2" --locked`, then `cargo tauri build --bundles nsis`. Crates.io's newest tauri-cli is a 3.x alpha, so keep the `^2`.
- `cargo fmt` uses `src-tauri/rustfmt.toml` (140 columns). CI runs `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings`.
- The website is in `site/`, a static-assets Cloudflare Worker managed with the `cf` CLI: `npm ci`, `npx cf dev`, `npx cf build --mode production`, then `npx cf deploy --prebuilt --mode production`. The deploy needs the build's `--mode` to match.

## Running changes

- `ui/` is embedded in the binary at compile time and there is no dev server, so UI edits only appear after a rebuild.
- `cargo build` fails with `Access is denied` on `filmie.exe` while the app is open. Close it first, or the old build keeps running.
- `ui/app.js` needs `window.__TAURI__`, so opening `ui/index.html` in a plain browser fails unless that object is mocked.
- A process started from inside the Claude desktop app can see its own sandboxed copy of app data under `%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Local\app.filmie.desktop`. It can differ from the real `%LOCALAPPDATA%\app.filmie.desktop`, so check which one you are reading.

## Architecture

**The webview does no networking of its own.** The CSP limits `connect-src` to Tauri IPC, so TMDB and Trakt calls go through Rust commands (`tmdb` and `trakt`, both generic path proxies). `img-src` allows only `image.tmdb.org`, `data:` and `blob:`, which is why the Trakt avatar is fetched by the `avatar` command and shown as a `blob:` URL. `script-src 'self'` rules out inline scripts and `on*` attributes.

**Frontend (`ui/`)** is classic scripts sharing globals, with no modules or framework.
- `lib.js` holds pure helpers and `DEFAULT_SOURCES`. It is the only file the tests import, so testable logic goes there.
- `app.js` has a hash router (`route()`) dispatching to the `pages` object. `#/play/tv/1396/5/14` calls `pages.play('tv', '1396', '5', '14')`.
- Pages render with `innerHTML`, so interpolated data must pass through `esc()`. `routeToken` lets async work drop results after the page has changed.
- Icons are SVG symbols in `index.html`, used through `icon(name)`. A test fails if a symbol is missing.

**Local database (`src-tauri/src/db.rs`, `filmie.sqlite3` in the app data folder)**
- `Db::through` caches `tmdb` and `trakt` GET responses, and falls back to an expired copy when a fetch fails, except on 401. `ui/app.js` keeps no response cache of its own and only shares in-flight requests.
- User-specific Trakt responses are cleared by any Trakt write, a change in `/sync/last_activities`, and sign-out. `cache_policy` in `trakt.rs` sets the lifetimes.
- The `history` table holds Recently played, one row per movie or show, and survives sign-out. The script in `INJECT_PLAYER` posts `{ __filmieProgress: { t, d } }` to the top frame, where `validProgress` in `lib.js` checks it. It stays at 0 for players that hide their `<video>`.

**Startup:** `refreshUser` draws from the local copies with no network wait, then `syncInBackground` asks Trakt whether anything changed.

**Trakt (`src-tauri/src/trakt.rs`)**
- Sign-in is the device-code flow, with no client secret.
- Tokens live in Windows Credential Manager. Refresh tokens are single-use.
- `State::request` serializes writes to Trakt's limit of 1 per second and retries once on 429.
- `sync` keeps a library mirror in `library.json`. It compares `/sync/last_activities` and refetches only the sections whose timestamps moved. The frontend's `write()` re-syncs after every write, and the lookups in `app.js` read that mirror.
- Items are identified by TMDB id.
- Up next comes from `/sync/progress/watched`, because `/sync/watched/shows` no longer includes episodes.

**Watch tracking is manual by decision.** Opening the player or pressing Next sends nothing to Trakt, and only Mark watched records a watch. Do not add check-ins or scrobbling: a Trakt check-in marks the item watched when its runtime ends, whether or not it was watched.

**Player**
- The iframe is cross-origin, so `app.js` can't read or change it. The toolbar sits above the iframe, and menus overlay it only while open.
- `INJECT_PLAYER` in `main.rs` runs in every frame through `initialization_script_for_all_frames` and does nothing in the top frame. It removes ad nodes, retries autoplay and applies the preferred quality.
- `app.js` sends the quality as a `{ __filmieQuality }` `postMessage`, which the script relays to nested frames.

**Window lockdown (`main.rs`)**
- `on_navigation` keeps the top frame on app pages, and `on_new_window` denies every pop-up.
- Links only open, in the system browser, if their host is in `EXTERNAL_HOSTS`. A new `target="_blank"` destination must be added there.
- `capabilities/default.json` grants IPC to local pages only. Any new Tauri JS API needs its permission added.

**Server list and preferences** live in `localStorage` (`sources`, `server`, `quality`). `DEFAULT_SOURCES` is empty: Filmie ships with no video servers and users add their own. The README, `TERMS.md` and the website all state this, so keep them in step with the code. A saved `sources` value replaces the defaults entirely.

## Docs

- `docs/PLAN.md` is the running record of API facts, decisions and sources. Before changing a Trakt, TMDB, Tauri or WebView2 integration, re-check the official docs, since Trakt changed a lot in 2026 and older sources are often wrong. Record what you find there with links. For Trakt, the source is the guides and contracts in github.com/trakt/trakt-api.
- Parts of the plan describe the original design, not the code. `tmdb.rs`, `ratings.rs`, `links.rs`, `db.rs`, SQLite and a `src/` frontend don't exist. Trust the code. The plan also records that TMDB and Trakt terms forbid use in apps that promote piracy, and that Trakt can revoke the client ID.
- Known limits are marked in code with `shortcut:` comments.

## CI and releases

- `.github/workflows/`: `ci.yml` (format, UI tests, Clippy, Rust tests), `audit.yml` (`cargo audit`), `release.yml` (`v*` tags) and `site.yml` (website deploy). `.github/actions/setup` holds the shared Rust, cache, uBlock and key setup.
- CI compiles with placeholder keys. Only `release.yml` uses the real `TMDB`, `TRAKT` and `TRAKT_REDIRECT_URI` secrets.
- A release tag must match `version` in `src-tauri/tauri.conf.json`. The installer is published as `Filmie-Setup-x64.exe`, and the website and README link to that fixed name through `releases/latest/download/`.
