# Filmy: plan

Windows desktop app for browsing movies and TV (TMDB), tracking what you watch (Trakt), seeing ratings and links (IMDb, Letterboxd, Rotten Tomatoes, Metacritic, Trakt), and playing video in a built-in player with adblocking.

Last verified against official docs: **2026-11-01**. Re-check the sources at the bottom before changing an integration.

---

## 1. Stack

| Part | Choice | Why |
|---|---|---|
| Shell | **Tauri 2** (2.12.x) | Rust backend, uses Windows' WebView2 (installer ~10 MB), and has built-in hooks for loading extensions and blocking pop-ups. Pure-Rust UI kits (egui, iced, Slint) can't host web video players. |
| Backend | Rust: `tauri`, `reqwest` (rustls), `serde`, `tokio`, `rusqlite` (bundled), `keyring`, `tauri-plugin-opener` | All network calls happen in Rust: no browser cross-origin errors, one place for keys, one cache. |
| Frontend | **Open decision**: Svelte + TS (recommended) or Leptos | See §8. |
| TMDB client | Small hand-written `reqwest` client | `tmdb-client-rs` is generated from an unofficial spec, untested, and requires every parameter. We need about 8 endpoints. |
| Trakt client | Small hand-written `reqwest` client | Trakt changed auth in 2026. Old crates still use client secrets and `api.trakt.tv` for OAuth. |

`mcp-tmdb` is an AI-agent tool (TypeScript MCP server) and isn't used.

## 2. Layout

```
filmy/
  .env.local          TMDB=..., TRAKT=... (never committed)
  docs/PLAN.md        this file
  src-tauri/
    build.rs          reads .env.local, embeds keys at compile time
    src/
      main.rs         window setup, adblock hooks, commands
      tmdb.rs         TMDB client
      trakt.rs        Trakt auth, sync, write queue
      ratings.rs      OMDb + Wikidata
      links.rs        external link builder
      db.rs           SQLite: cache, library mirror, settings
    extensions/ubol/  uBlock Origin Lite, unpacked (GPLv3, shipped unmodified)
    capabilities/     IPC allowed only for local app pages
  src/                frontend
```

The Trakt client ID is public by design (it appears in every sign-in URL), so embedding it is fine. No client secret is used anywhere.

## 3. TMDB

- Base `https://api.themoviedb.org/3`, v3 API key from `TMDB`.
- Detail page in one call: `/movie/{id}` or `/tv/{id}` with `append_to_response=external_ids,videos,credits,recommendations,watch/providers`.
- Also: `/search/multi`, `/trending/all/week`, `/tv/{id}/season/{n}`.
- Cache in SQLite for 7 days. TMDB terms allow up to 6 months.
- Required: TMDB logo and "uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB" on the About page. "Where to watch" data comes from JustWatch and needs JustWatch credit.

## 4. Trakt (2026 API)

### Facts from the official docs
- **Hosts:** API calls use `https://api.trakt.tv`. **All OAuth calls** (authorize, device code, token, refresh, revoke) use `https://auth.trakt.tv`.
- **Headers:** `Content-Type: application/json`, `User-Agent: Filmy/<version>`, `trakt-api-key: <client id>`, `trakt-api-version: 2`, plus `Authorization: Bearer <token>` when signed in.
- **Client secret:** deprecated for user sign-in. Never ship it in a desktop app. PKCE or device flow only.
- **Access token:** valid 7 days.
- **Refresh tokens are single-use:** each refresh returns a new pair and kills the old one. `invalid_grant` + `session not found` means the user must sign in again (this also affects tokens issued before the migration).
- **PKCE redirect URIs:** must be `https://`. The docs say to avoid `localhost`, custom schemes and the `oob` URI.
- **Rate limits (Standard tier):**
  - POST/PUT/DELETE: 1 per second per user
  - GET: 500 per 5 minutes
  - On `429`, honour `Retry-After`; if it's missing, back off with jitter.
- **Status codes to handle:**
  - `420`: account limit, e.g. watchlist size. Read `/users/settings` limits.
  - `426`: VIP-only feature. Link to `X-Upgrade-URL`.
  - `423`: locked account.
- **Images:** hotlinking Trakt images is blocked and they must be cached. We use TMDB images instead.
- **Up Next** has limited access for Standard apps, so next-episode logic is computed locally.
- **App terms:**
  - Trakt data can't be used in apps that promote piracy.
  - Watch the `trakt/trakt-api` GitHub discussions.
  - Add "Filmy uses Trakt but is not endorsed or certified by Trakt" to the About page.
  - Write a privacy note.
- **App deletion:** Trakt deletes app registrations after 30 days with no use, or if used only for testing during the first 30 days.

### Sign-in: device code flow
A desktop app has no `https://` callback address it owns, so PKCE's redirect rules don't fit. The device flow needs no redirect and no secret:

1. `POST auth.trakt.tv/oauth/device/code` with `{client_id}` returns `user_code`, `verification_url`, `interval` and `expires_in`.
2. Show the code, copy it to the clipboard, and open `verification_url` in the user's browser.
3. Poll `POST auth.trakt.tv/oauth/device/token` with `{code, client_id}` every `interval` seconds until `expires_in` runs out:
   - `400` pending: keep polling.
   - `429` slow down: increase the interval.
   - `404`, `409`, `410`, `418`: stop and show the reason.
4. Store tokens in **Windows Credential Manager** (`keyring` crate), not in a file.
5. Sign out: `POST auth.trakt.tv/oauth/revoke` with `{token, client_id}`, then delete the stored tokens.

**Refresh rules:**
- One refresh at a time (a mutex), because two parallel refreshes would kill each other's token.
- Save the new pair *before* using it.
- Refresh when less than 1 day is left.
- On `invalid_grant`, show "Sign in to Trakt again".
- ⚠ The refresh request schema requires `redirect_uri`. Phase 0 tests which value device-flow tokens accept.

### Sync
- **Read:** on start, when the window regains focus, and every 15 minutes, call `GET /sync/last_activities` and compare with the saved timestamps. Re-fetch only the sections that changed:
  - `/sync/watched/movies`
  - `/sync/watched/shows`
  - `/sync/watchlist`
  - `/sync/ratings`
  - `/sync/playback`

  Mirror them in SQLite. Use the IDs from Trakt and the metadata from TMDB, as Trakt's caching guide recommends.
- **Write:** one queue, at most 1 request per second, and the UI updates immediately.
  - Mark watched: `POST /sync/history`. Unmark: `POST /sync/history/remove`.
  - Watchlist: `POST /sync/watchlist`, `/sync/watchlist/remove`.
  - Rate 1-10: `POST /sync/ratings`, `/sync/ratings/remove`.
- **IDs:** Trakt accepts `ids: {tmdb: …}` directly, so there's no ID lookup step. Episodes use the episode's TMDB ID from the season endpoint.

### Tracking playback (open decision, §8)
The player is a cross-origin iframe, so the app can't read the playback position.
- **Chosen (2026-11-02): manual only.** "Mark watched" is the only way a watch is recorded, and "Next" just moves to the next episode. Nothing is sent when the player opens.
- **A (rejected): check-in.** `POST /checkin` makes Trakt mark the item watched once its runtime has passed, whether or not it was actually watched, and clients can't turn that off.
- **B: estimated scrobble.** `/scrobble/start` on open and `/scrobble/stop` on close, with progress = elapsed / runtime. It's wrong whenever you pause or skip, and over 80% records a watch.
- **C: real scrobble.** Only for sources that report their playback time. Deferred.

### Changing the embedded player page (checked 2026-11-02)
- `ui/app.js` can't read or change it: the same-origin policy limits a cross-origin iframe to `postMessage` and a few `Window` and `Location` members.
- The native side can: WebView2's `AddScriptToExecuteOnDocumentCreated` applies to "all future top level document and child frame navigations", and Tauri exposes `initialization_script_for_all_frames`. Tauri's docs don't mention cross-origin frames, so test it first. The page's sandbox or CSP can still limit the script. Injected fixes depend on the page's markup and can break when it changes.
- A server's direct embed URL can be added as a source in Settings, which skips the wrapper page with no code.

## 5. Ratings and links
| Source | How |
|---|---|
| TMDB | `vote_average` |
| Trakt | `GET /movies/{id}/ratings` or `/shows/{id}/ratings` (by TMDB ID through search, or Trakt ID from sync) |
| IMDb, Rotten Tomatoes, Metacritic | OMDb API by `imdb_id` (free key, 1,000 requests/day, cached) |
| Letterboxd | Link only (`letterboxd.com/tmdb/{id}`). No public API, and scraping breaks its terms. |

Links: IMDb from `imdb_id`. Rotten Tomatoes, Metacritic and Trakt come from Wikidata properties P1258, P1712 and P8013, found through TMDB `wikidata_id`. A search URL is the fallback.

Trakt's policy allows combining scores only if the app labels the result as its own combined score and names the sources.

## 6. Player and adblocking
- **Player:** an iframe loading user-configured URL templates (`{tmdb_id}`, `{season}`, `{episode}`). No sources are bundled. TMDB "where to watch" and trailers are shown on every detail page.
- **Adblock A (recommended):** uBlock Origin Lite through `browser_extensions_enabled(true)` + `extensions_path(...)`.
- **Adblock B (fallback):** Brave's `adblock` crate in WebView2's `WebResourceRequested` event, using the iframe-aware filter API (`RequestSourceKinds`).
- **Always:**
  - `on_new_window` denies pop-ups; external links open in the system browser.
  - `on_navigation` keeps the main window on app pages.
  - Remote content never gets IPC capabilities.

### Distribution (checked 2026-11-02)
- **Servers:** release builds include no video servers (`DEFAULT_SOURCES` is empty), which keeps §8's "nothing bundled" decision. Users add their own in Settings.
- **Installer:** `cargo tauri build --bundles nsis` with the default WebView2 `downloadBootstrapper` mode, which adds about 0 MB but needs internet: https://tauri.app/distribute/windows-installer/. Crates.io's newest `tauri-cli` is a 3.x alpha, so the workflow pins `^2`.
- **Website:** a static-assets Worker in `site/`, using `cf`: https://developers.cloudflare.com/cf/ci/. `cf` is in beta. An assets-only project keeps its asset folder in a generated `wrangler.config.ts`, and `cf deploy --prebuilt --mode production` refuses a build made without `--mode production`.
- **Still needed:** TMDB's terms ask for its logo as well as the attribution text, and the app only shows the text.

## 7. Phases
0. **Test (about 1 day):**
   - uBO Lite blocks requests inside cross-origin iframes.
   - `on_new_window` stops pop-ups.
   - Trakt device sign-in, refresh (which `redirect_uri` value it accepts), revoke.
1. **Skeleton:** Tauri app, `build.rs` key embedding, SQLite, TMDB client, settings.
2. **Browse:** home (trending/popular), search, detail pages, seasons and episodes.
3. **Trakt:** sign-in UI, sync mirror, write queue, watched badges, watchlist, rating, "continue watching" from `/sync/playback`.
4. **Ratings and links:** OMDb, Wikidata, link builder.
5. **Player:** sources in Settings, server switcher, next episode, watch tracking (§4), adblock.
6. **Ship:** NSIS installer with the WebView2 bootstrapper, an About page (TMDB, JustWatch and Trakt credits, privacy note, uBO licence).

## 8. Decisions
**Chosen for v1 (2026-11-02, recommended defaults):**
- Plain HTML/JS frontend in `ui/`, no build step.
- Device-code sign-in.
- Manual watch tracking: a "Mark watched" button, no check-in or scrobble.
- uBO Lite, loaded if `src-tauri/extensions/ubol/` exists.
- No OMDb until a key is added.
- Search links instead of Wikidata.
- External links open in the system browser through an allowlist.

Run tests with `cargo test` (in `src-tauri/`) and `node --test tests/ui.test.js`.

**Trakt-first UI (2026-11-02):**
- **Data sources:** browsing, lists and search come from Trakt. TMDB is used only for artwork, details, episodes and "where to watch".
- **Endpoints used** (checked against trakt-api `3f7ea1a`):
  - `/movies|shows/trending|popular|anticipated`, `/movies/boxoffice`
  - `/recommendations/movies|shows` (signed in)
  - `/users/me/lists` and `/users/me/lists/{id}/items/movie,show`
  - `/{type}s/{id}/related`
  - `/search/tmdb/{id}?type=`
  - search: `/search/movie|show/exact`, then `/search/movie,show`
  - the `/sync/*` mirror for watchlist, watched, ratings and playback
- **Pages (Trakt-style, not a streaming clone):**
  - **Home:** profile strip with the cached avatar and stats counted from the sync mirror (`/users/{id}/stats` is VIP-only now), then Up next, Continue watching, Watchlist, Your lists, recommendations and trending.
  - **Shows** and **Movies**.
  - **Lists** and list pages (60 per page, "Load more").
  - **Watchlist**.
  - **Title summary:** poster, ratings, episodes, Related.
  - Full-screen player.
- **Avatar:** Trakt blocks hotlinked images, so the `avatar` command caches the file in the app data folder and the page shows it as a `blob:` URL.
- **Redirect URI:** `TRAKT_REDIRECT_URI` in `.env.local` must equal the redirect URI registered on the Trakt app. Sign-in never uses it, but token refresh must send it.

**API behaviour found with a real account (2026-11-02):**
- `/sync/watched/*`, ratings and watchlist return 100 items per page by default, so sync loops `page=` until a short page.
- `/sync/watched/shows` no longer includes `seasons`/`episodes`. Up next and the Play target come from `/sync/progress/watched?hide_completed=true`. Episode checkmarks come from `/shows/{trakt_id}/progress/watched`.

**Adblock status (2026-11-02):** adblock-tester.com, loaded inside an iframe in the app, scored 90/100. That covers ad requests made by an embedded page, not only by the app itself. uBO Lite 2026.1026.1812 (Edge build) loads through WebView2. It blocked `googlesyndication` and `doubleclick` requests from iframes (`net::ERR_BLOCKED_BY_CLIENT`), while normal pages loaded. Install it with `scripts/fetch-ubol.ps1`; the version and SHA-256 are pinned there. The `extensions/` folder is git-ignored and bundled as a Tauri resource.

**Original options:**
1. **Video sources:** user-configured templates, nothing bundled. TMDB and Trakt terms both forbid use in apps that promote piracy, and Trakt can revoke the client ID.
2. **Frontend:** Svelte + TypeScript (recommended) or Leptos (all Rust).
3. **Watch tracking:** manual "Mark watched" (chosen), estimated scrobble B, or real scrobble C later.
4. **Adblock:** A, falling back to B if the test fails.
5. **Ratings:** OMDb (needs a free key) plus Letterboxd as a link only.
6. **External links:** system browser (recommended) or in-app.

## Sources
- Trakt guides and contracts (back developer.trakt.tv): https://github.com/trakt/trakt-api — `projects/developer/src/lib/guides/*.md`, `projects/api/src/contracts/{oauth,sync,scrobble,checkin}` (commit `3f7ea1a`, 2026-10-30)
- Trakt API use policy: guide `api-use-policy.md` (updated 2026-10-20)
- Tauri 2 `WebviewWindowBuilder`: https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindowBuilder.html
- TMDB API terms: https://www.themoviedb.org/api-terms-of-use
