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

- A debug build with `FILMIE_DATA_DIR` set keeps its data in that folder, logs each real request to `requests.log` there, and refuses Trakt writes, so a real account can be tested safely. Add `WEBVIEW2_USER_DATA_FOLDER` for an empty profile, and `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` to drive the window.
- `.env.local` in the repo root is required to compile. `build.rs` bakes `TMDB`, `TRAKT` and `TRAKT_REDIRECT_URI` into the binary, so never print their values.
- `scripts/fetch-ubol.ps1` downloads the pinned uBlock Origin Lite into the git-ignored `src-tauri/extensions/`. Without it the app still runs, with no extension adblocking.
- The installer needs the Tauri CLI: `cargo install tauri-cli --version "^2" --locked`, then `cargo tauri build --bundles nsis`. Crates.io's newest tauri-cli is a 3.x alpha, so keep the `^2`.
- `cargo fmt` uses `src-tauri/rustfmt.toml` (140 columns). CI runs `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings`.
- The website is in `site/`, a static-assets Cloudflare Worker configured in `site/wrangler.jsonc` and served on the custom domain `filmie.sayed.app`: `npm ci`, `npx wrangler dev`, then `npx wrangler deploy` (run locally; CI only dry-runs it).

## Running changes

- `ui/` is embedded in the binary at compile time and there is no dev server, so UI edits only appear after a rebuild.
- `cargo build` fails with `Access is denied` on `filmie.exe` while the app is open. Close it first, or the old build keeps running.
- `ui/app.js` needs `window.__TAURI__`, so opening `ui/index.html` in a plain browser fails unless that object is mocked.
- A process started from inside the Claude desktop app can see its own sandboxed copy of app data under `%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Local\app.filmie.desktop`. It can differ from the real `%LOCALAPPDATA%\app.filmie.desktop`, so check which one you are reading.

## Architecture

**The webview does no networking of its own.** The CSP limits `connect-src` to Tauri IPC, so TMDB and Trakt calls go through Rust commands (`tmdb` and `trakt`, both generic path proxies). `img-src` allows only `image.tmdb.org`, `data:` and `blob:`, which is why the Trakt avatar is fetched by the `avatar` command and shown as a `blob:` URL. `script-src 'self'` rules out inline scripts and `on*` attributes.

**Frontend (`ui/`)** is classic scripts sharing globals, with no modules or framework. They load in this order from `index.html`:
- `lib.js`: pure helpers, `FILTERS` and `DEFAULT_SOURCES`. It is the only file the tests import, so testable logic goes there.
- `core.js`: Tauri calls, preferences, mode and filter state, the Trakt library lookups, `refreshUser`, `syncInBackground`, `runHistorySync`.
- `controls.js`: `drawer`, `modal`, `menu`, `segmented`, the filter drawer and the Ctrl+K palette. Drawers and dialogs are native `<dialog>`.
- `cards.js`: every card, `renderRows`, `renderGrid`, skeletons and the card actions.
- `pages-browse.js` (Home, Discover, Search), `pages-title.js` (title and person), `pages-me.js` (the signed-in pages and Settings).
- `app.js`: the player, the top bar, the hash router and start-up. `route()` dispatches to the `pages` object, so `#/play/tv/1396/5/14` calls `pages.play('tv', '1396', '5', '14')`.

How pages work:
- Pages render with `innerHTML` into `app`, so interpolated data must pass through `esc()`. `routeToken` lets async work drop results after the page has changed, so check it after a page's first `await`.
- `pages.x.bar` tells the top bar what to show: `{ title, meta, back, mode, filters }`, or a function of the route arguments returning that. `mode` is `'bar'` for the switch, `'search'` for Search's five-way one, or left out. Any page listing both movies and shows gets the switch. `filters` is `'global'`, `'local'` or left out, and only belongs where Trakt's endpoint takes filters.
- Mode is `getMode()`, `setMode()` and `forMode(media, show, movie)`. Filters are `{ param: value }` exactly as the API takes them, through `activeFilters()` and `withFilters(path)`. People and Lists only exist on Search, in `getSearchMode()`, and never touch the saved mode.
- `route()` shows a `skeleton(kind)` placeholder, then runs the page. `SKELETONS` in `cards.js` picks the shape.
- `route({ soft: true })` refreshes the current page in place, for example after a write or a background sync. It renders into a hidden copy of `#app`, then swaps it in and moves keyboard focus to the same control. A page must await what it loads for the swap to be complete, so use `app`, not `document`, to find what you just rendered.
- `renderRows(defs, into)` builds rows that load near the viewport, and `id` keys their saved collapse state. `renderGrid(into, { load, card, pageSize })` loads more on scroll, and `card` may return `''` to leave an item out.
- Back and Forward restore scroll through the Navigation API's entry key, in `savedScroll`. Other navigation starts at the top. `renderGrid` loads far enough for the saved position to exist.
- The side rail is `nav.rail` in `index.html`, and `navFor` in `lib.js` picks its highlighted items. Its width is the `--rail` token, and `localStorage` key `rail` remembers it. Search's `#q` sits outside `#app` so it keeps focus while results swap.
- `.row` is a container, and `@container` steps in `style.css` set how many whole cards fit.
- Icons are SVG symbols in `index.html`, used through `icon(name)`. A test fails if a symbol is missing.
- The design follows Trakt's desktop app, measured in `specs/002-trakt-design-parity/trakt-design-reference.md`. trakt-web is GPLv3 and Filmie is MIT, so build from that description and never copy its code, styles or assets. There is no Trakt logo, and the accent is Filmie's red. The owner's decisions overrule the reference: every list page has the media switch, and title pages have no ratings of any kind, including the person's own stars, and no Where to Watch.
- The rail's Home, Discover and Lists are `.rail-group`s. On a wide rail `openRailGroup` shows one group's sub-pages at a time, starting with the current page's. On a narrow rail they and the bottom menu open as flyouts, through the `flyout` class.

**Local database (`src-tauri/src/db.rs`, `filmie.sqlite3` in the app data folder)**
- Cards get pictures from the `art` command, a small entry per title lasting a month. `loadArt` in `cards.js` asks a few at a time, for cards still near the screen. Don't call `tmdb` per card.
- `Db::through` caches `tmdb` and `trakt` GET responses, and falls back to an expired copy when a fetch fails, except on 401. `ui/app.js` keeps no response cache of its own and only shares in-flight requests.
- User-specific Trakt responses are cleared by any Trakt write, a change in `/sync/last_activities`, and sign-out. `cache_policy` in `trakt.rs` sets the lifetimes.
- The `history` table holds Recently played, one row per movie or show, and survives sign-out. The script in `INJECT_PLAYER` posts `{ __filmieProgress: { t, d } }` to the top frame, where `validProgress` in `lib.js` checks it. It stays at 0 for players that hide their `<video>`.
- `trakt_history`, `trakt_ratings` and `sync_state` are a copy of the Trakt account, because `/users/{id}/stats` is VIP only. The `stats` command works everything out from them with no network. Signing out or signing in deletes them, and every write to them goes through `while_signed_in` so a fetch in flight can't restore them after sign-out.
- `history_sync` in `trakt.rs` does one step per call, and `runHistorySync` in `core.js` repeats it once a second until `complete`. It backfills page by page with a saved page number, then picks up new plays with `start_at` when `activities.all` moves. Removals have no marker, so it compares Trakt's total with the local count, allowing for `history_gap`, and starts over if they differ.

**Startup:** `refreshUser` draws from the local copies with no network wait, then `syncInBackground` asks Trakt whether anything changed and runs `runHistorySync`.

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
- `INJECT_PLAYER` in `main.rs` runs in every frame through `initialization_script_for_all_frames` and does nothing in the top frame or on YouTube. It removes ad nodes, retries autoplay and applies the preferred quality.
- Trailers and videos play in `playVideo` in `controls.js`, an embedded YouTube player in a dialog. YouTube's terms require the `Referer` it gets from `strict-origin-when-cross-origin`, and forbid covering or changing the player.
- `app.js` sends the quality as a `{ __filmieQuality }` `postMessage`, which the script relays to nested frames.

**Window lockdown (`main.rs`)**
- `on_navigation` keeps the top frame on app pages, and `on_new_window` denies every pop-up.
- Links only open, in the system browser, if their host is in `EXTERNAL_HOSTS`. A new `target="_blank"` destination must be added there.
- `capabilities/default.json` grants IPC to local pages only. Any new Tauri JS API needs its permission added.

**Server list and preferences** live in `localStorage` (`sources`, `server`, `quality`). `DEFAULT_SOURCES` is empty: Filmie ships with no video servers and users add their own. The README, `TERMS.md` and the website all state this, so keep them in step with the code. A saved `sources` value replaces the defaults entirely. `renderServers` in `app.js` is the Settings form: `buildServer` in `lib.js` joins the server link and structures into the saved `{ name, movie, tv, note, accent }` shape, and `MOVIE_STRUCTURES` and `TV_STRUCTURES` are host-free suggestions only.

## Docs

- `docs/PLAN.md` is the running record of API facts, decisions and sources. Before changing a Trakt, TMDB, Tauri or WebView2 integration, re-check the official docs, since Trakt changed a lot in 2026 and older sources are often wrong. Record what you find there with links. For Trakt, the source is the guides and contracts in github.com/trakt/trakt-api.
- `specs/002-trakt-design-parity/` holds the spec, contracts and task list for the Trakt redesign, and `contracts/api-usage.md` lists which endpoint each page uses.
- Parts of the plan describe the original design, not the code. `tmdb.rs`, `ratings.rs`, `links.rs` and a `src/` frontend don't exist. Trust the code. The plan also records that TMDB and Trakt terms forbid use in apps that promote piracy, and that Trakt can revoke the client ID.
- Known limits are marked in code with `shortcut:` comments.

## CI and releases

- `.github/workflows/`: `ci.yml` (format, UI tests, Clippy, Rust tests), `audit.yml` (`cargo audit`), `release.yml` (`v*` tags) and `site.yml` (website dry-run deploy check). `.github/actions/setup` holds the shared Rust, cache, uBlock and key setup.
- CI compiles with placeholder keys. Only `release.yml` uses the real `TMDB`, `TRAKT` and `TRAKT_REDIRECT_URI` secrets.
- A release tag must match `version` in `src-tauri/tauri.conf.json`. The installer is published as `Filmie-Setup-x64.exe`, and the website and README link to that fixed name through `releases/latest/download/`.
