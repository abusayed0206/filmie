# Filmie: plan

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
filmie/
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
- **Headers:** `Content-Type: application/json`, `User-Agent: Filmie/<version>`, `trakt-api-key: <client id>`, `trakt-api-version: 2`, plus `Authorization: Bearer <token>` when signed in.
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
  - Trakt's terms limit how its data may be used.
  - Watch the `trakt/trakt-api` GitHub discussions.
  - Add "Filmie uses Trakt but is not endorsed or certified by Trakt" to the About page.
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

### Stats from a local copy of the history (read from trakt-api `090d333`, 2026-11-03; not yet called with a real account)
- `/users/{id}/stats` is VIP only and returned 204 for a free account, so Filmie copies `/sync/history` and `/sync/ratings/{type}` into SQLite and adds them up there. The API use policy allows caching for features people use, and this copy stays on the PC and is deleted on sign-out.
- `/sync/history` takes `start_at` and `end_at`. Imports can stamp up to 276 plays with one second (seen on a real account), so the backfill goes by page with a saved page number, and only picking up newer plays uses `start_at`.
- Trakt's counts disagree with what it lists. On a real account, reading by time and by page both returned exactly 5,889 distinct plays, while `/sync/watched` and `X-Pagination-Item-Count` on `limit=1` said 5,902, and the same header said 5,889 on the last page. So the total always comes from `limit=1`, and the difference is stored as `history_gap`.
- `/sync/last_activities` has no marker for a removed play, so `activities.all` triggers a check and the counts decide. Whether `all` moves on a removal is unconfirmed: run scenario 32 in `specs/002-trakt-design-parity/quickstart.md`.
- [Sync contract](https://github.com/trakt/trakt-api/blob/main/projects/api/src/contracts/sync/index.ts).

### Measured with a real account (2026-11-04, 5,889 listed plays, read-only debug build)
- Ordinary start with data saved: 5 requests, first paint at 172 ms. First start on an empty profile: 40 in the first 8 seconds, plus 67 to copy the history and ratings.
- Every page, scrolled to the end, on an empty cache: 1,400 requests before the `art` command and the art queue, 1,076 after (85 Trakt, 991 TMDB). A later full walk: 0 Trakt, 19 TMDB.
- Profile against Trakt: movies 857 of 857, shows 147 of 147, plays 5,889 of 5,902. Trakt counts 13 plays it doesn't list, so that's as close as a copy can get.
- Not exercised, because they write to the account: Mark watched, ratings, lists, sign-out, and a removal being noticed (quickstart scenarios 20, 24, 32, 33).

### Trailers in an embedded player (checked 2026-11-03)
- A `target="_blank"` link only reaches `on_new_window`, which hands it to the system browser, so trailers now play in an iframe in a dialog.
- [YouTube's required minimum functionality](https://developers.google.com/youtube/terms/required-minimum-functionality): embeds must send a `Referer`, with `strict-origin-when-cross-origin` recommended. Nothing may overlay or obscure the player, the player may not be changed, and its viewport must be at least 200 by 200 (480 by 270 recommended for 16:9). In a WebView the `Referer` defaults to empty and the app must supply it. Here the page's origin, `http://tauri.localhost`, supplies it, and a trailer played in the real app on 2026-11-03.
- [Player parameters](https://developers.google.com/youtube/player_parameters): the format is `https://www.youtube.com/embed/VIDEO_ID`. `rel=0` limits related videos to the same channel. The docs don't cover `youtube-nocookie.com`, so it isn't used.
- Uploaders can disable embedding, so the dialog always offers Open on YouTube.

### Your own tracking pages (read from trakt-api `090d333` and trakt-web `9ebdbff`, 2026-11-03; not yet called with a real account)
- **Shared lists:** `GET /users/{id}/lists/collaborations`. Items of a shared list live under the owner's slug, not `/users/me`. The earlier `/users/me/collaborations` returned 405.
- **Liked lists:** `/users/likes/lists` wraps each one in `{ liked_at, list }`.
- **Progress tabs:** trakt-web asks `/sync/progress/up_next_nitro` with `intent=continue` or `intent=completed`, then splits Completed and Ended on the show's status, where `ended` and `canceled` count as ended. Dropped is `/users/hidden/dropped`.
- **Single types differ by route:** list items take `movie` or `show`, and the sync routes Filmie already uses take `movies` or `shows`.
- **Notes:** `/notes/{id}` takes `PUT` and `DELETE`. `POST /notes` exists, but the contract doesn't say what `item` must hold, and trakt-web uses a private `/v3/users/me/notes` route instead. Filmie shows, edits and deletes notes but can't add one yet.
- **Dropped activity:** `/sync/last_activities` has `shows.dropped_at` and `shows.hidden_at`.
- **Search empty states:** `/search/recent_by_id/global/{movies,shows,people}` returns `{ id, count, type, movie | show | person }`, and `/lists/popular` wraps each one in `{ list }`. The contracts have no route behind Trakt's Birthdays This Month, so Filmie shows Top Searches for People too. Only the movies route was probed.
- **Sources:** [sync contract](https://github.com/trakt/trakt-api/blob/main/projects/api/src/contracts/sync/index.ts), [notes contract](https://github.com/trakt/trakt-api/blob/main/projects/api/src/contracts/notes/index.ts), [user lists contract](https://github.com/trakt/trakt-api/blob/main/projects/api/src/contracts/users/subroutes/userLists.ts).

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

### Offline downloads (checked 2026-11-11)
- **Where the video's address comes from:** the server page is cross-origin, so the app can't read it. Two sources, both tried in a hidden, muted frame like the Auto race's probes:
  - `INJECT_PLAYER` runs in every frame. Once told `{ __filmieCapture }`, it reports `.m3u8`/`.mpd` addresses from a `PerformanceObserver` on resource timing (no fetch or XHR patching), a `<video>`'s non-`blob:` `currentSrc`, and any `navigator.requestMediaKeySystemAccess` call (EME). Addresses seen before the message are kept and sent with it.
  - WebView2's `WebResourceResponseReceived` is raised for every response the WebView receives, including fetches: https://learn.microsoft.com/dotnet/api/microsoft.web.webview2.core.corewebview2.webresourceresponsereceived. Frame-level request interception needs `AddWebResourceRequestedFilterWithRequestSourceKinds` (1.0.2365.46+): https://learn.microsoft.com/microsoft-edge/webview2/concepts/frames. Filmie only reads responses, through `webview2-com` 0.39 (the version wry 0.57 uses). Playlists by type or extension, and video files of 50 MB or more, become a `media-seen` event. It can't tell which frame asked, so it only counts while no other player is open.
  - A `blob:` `currentSrc` is Media Source Extensions fed by a player like hls.js, so the playlist is the downloadable thing, not the video element.
- **Plain streams only:** an EME request with no playlist, `SAMPLE-AES`/`SAMPLE-AES-CTR`, a missing `METHOD`, a non-identity `KEYFORMAT`, and any DASH `ContentProtection` mark the item `protected`, and nothing of it is kept. AES-128 with an identity key is clear-key HLS and is saved with its key. HLS spec: https://datatracker.ietf.org/doc/html/rfc8216
- **Choosing a server:** `download_probe` fetches each captured HLS master with the player headers and returns its tallest `RESOLUTION`. `captureMedia` checks the selected server first, then every other server, stops at the first at or above the download quality, and otherwise keeps the best height seen. `auto` examines all servers and keeps the tallest. This was added so a 720p server doesn't hide a later 1080p one; verified with Rakan (720p), Xayah (800p) and Ekko (1080p).
- **Formats:** a direct file is streamed to disk through a `.part` file, resumed with a Range request. HLS saves the variant at or below the download quality, its separate audio rendition, init segment and segments (4 at a time, 3 retries, renamed to a real extension because some servers disguise segments as images), and writes local playlists. Byte-range playlists keep working since every distinct remote file is saved once. Live playlists (no `#EXT-X-ENDLIST`) are refused. If `ffmpeg` is on PATH, HLS is remuxed into one `video.mp4` (`-c copy`, `-allowed_extensions ALL`); a complete AES-128 episode was verified this way. DASH is handed to ffmpeg but the tested DASH servers (Bard, Ryze) still fail to open their manifests, so DASH downloads are not usable.
- **Headers:** Rust sends the player page as `Referer` and `Origin` and the webview's user agent. Cookies aren't copied, so a server that needs its cookies for the video can't be downloaded yet. Copying them through `ICoreWebView2CookieManager` would fix that.
- **Folder:** picked with `tauri-plugin-dialog`'s Rust API `blocking_pick_folder()` from an async command (blocking on the main thread would hang): https://v2.tauri.app/plugin/dialog/. No `dialog:*` JS permission is granted. `std::fs::canonicalize` resolves junctions and symlinks before the `%SystemDrive%` check. The folder lives in the `settings` table, which signing out leaves alone.
- **Playback:** the `protocol-asset` feature plus `app.security.assetProtocol.enable`, with an empty scope; each finished download's folder is allowed at runtime through `asset_protocol_scope().allow_directory`, again at start-up: https://v2.tauri.app/security/asset-protocol/. Tauri 2.12's asset handler answers Range requests (206), so seeking works. CSP adds `media-src 'self' http://asset.localhost blob:` and `http://asset.localhost` to `connect-src`: https://v2.tauri.app/security/csp/. Saved HLS plays through hls.js 1.7.3 (Apache-2.0, `ui/vendor/`) with `enableWorker: false`, so no `worker-src`. `convertFileSrc` puts the whole path in one URL segment, so relative playlist names are mapped back to the folder in `xhrSetup`.
- **Measured (2026-11-11, debug build):** Big Buck Bunny's public HLS test stream through the hls.js demo page as a "server": found in about 3 s, 480p saved in about 25 s (67 MB), remuxed by ffmpeg 9.0.2; resumed after the app was killed; the saved HLS copy plays and seeks with ffmpeg hidden from PATH.

### Distribution (checked 2026-11-02)
- **Servers:** release builds include no video servers (`DEFAULT_SOURCES` is empty), which keeps §8's "nothing bundled" decision. Users add their own in Settings.
- **Installer:** `cargo tauri build --bundles nsis` with the default WebView2 `downloadBootstrapper` mode, which adds about 0 MB but needs internet: https://tauri.app/distribute/windows-installer/. Crates.io's newest `tauri-cli` is a 3.x alpha, so the workflow pins `^2`.
- **Website:** a static-assets Worker in `site/`, configured in `wrangler.jsonc` and deployed locally with `npx wrangler deploy`. `filmie.sayed.app` is attached as a Workers custom domain (`routes` with `custom_domain: true`), so Cloudflare creates the DNS record and certificate on deploy: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/. Static assets: https://developers.cloudflare.com/workers/static-assets/.
- **Still needed:** TMDB's terms ask for its logo as well as the attribution text, and the app only shows the text.

### Local database and performance (checked 2026-11-02)
- **SQLite:** `filmie.sqlite3` caches TMDB and Trakt GET responses and holds Recently played. Lifetimes are in `cache_policy` (`trakt.rs`) and the `tmdb` command (`main.rs`): movies 7 days, TV 1 day, public Trakt lists 1 hour, search and related 1 day, user data 1 day but cleared by any write or activity change.
- **Trakt sync:** `/sync/last_activities` has a timestamp per area (`movies.watched_at`, `movies.rated_at`, `movies.watchlisted_at`, `movies.paused_at`, `episodes.watched_at`, `episodes.paused_at`, `shows.rated_at`, `shows.watchlisted_at`), so only changed sections refetch: https://github.com/trakt/trakt-api/blob/main/projects/api/src/contracts/sync/schema/response/lastActivitiesResponseSchema.ts
- **Local progress:** the player is cross-origin, so `app.js` can't read it. WebView2 runs `INJECT_PLAYER` in every frame, and that script reports the longest `<video>` over 60 seconds. Nothing is reported for players that hide their video, such as those using closed shadow DOM or EME-only pages.
- **Measured:** 1,000 cache lookups of 20 KB took about 10 ms in a release test. Time to first page in a browser test with 300 ms of simulated network delay fell from about 1,350 ms to about 290 ms, with no network call blocking the first page once the cache is warm. Lighthouse on the website scored 100 in all four categories on mobile and desktop (7 KB total, LCP 1.0 s on mobile).
- **CI:** compiling the Tauri CLI took 20 of the first release run's 31 minutes, so the workflow now installs Tauri's prebuilt binary.

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

- **2026-11-03, the owner's call, overruling the Trakt reference:** the media switch shows on every page listing both movies and shows, including the full grids where Trakt hides it in the filter drawer. Title pages have no external ratings and no Where to Watch, so nothing asks for `/ratings` or TMDB's `watch/providers`, and the JustWatch credit is gone with the data it covered. The person's own stars went too, along with the rate button on History cards, so Filmie no longer rates anything. The Ratings page still lists what was rated on Trakt.
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

**Trakt-style UI (planned 2026-11-03):** recreate Trakt's desktop layout in `ui/`, keeping Filmie's brand. trakt-web is GPLv3 and SvelteKit, so no code is copied. The API use policy (updated 2026-10-20) makes the Trakt logo optional and requires the "not endorsed or certified" sentence, which Settings has. Measurements, platform checks and links are in `specs/001-trakt-style-ui/research.md`.

**Trakt design parity (specified 2026-11-03):** follow Trakt's desktop design as is, with Filmie's red accent and name. Checked against trakt-web `9ebdbff` and trakt-api `090d333`. Desktop uses the side rail plus `NavbarActions`; `TopNavbar` only renders at 768 px and below. Standard tier is free; Limited Access endpoints may need approval, and VIP Only returns `426`. `/users/:id/stats` is VIP only, so stats come from local data. Limits are 500 GET per 5 minutes and 1 write per second. Measurements are in `specs/002-trakt-design-parity/trakt-design-reference.md`. Per-page endpoints are in `specs/002-trakt-design-parity/contracts/api-usage.md`. Limited Access covers per-title `/watchnow` and `/watchnow/sources`, so where to watch stays on TMDB's JustWatch data. 

**Trakt API probe (2026-11-03), with a real account:**
- 156 read-only paths, then a follow-up, using the app's client ID. Public paths ran with no token.
- **Free and working:** `/media/{trending,anticipated,popular,recommendations}`, `/sync/progress/up_next_nitro`, `/sync/history?extended=full` (runtime and genres included, `start_at` works), `extended=colors`, `/{type}/{id}/ratings?extended=all`, `/{type}/{id}/sentiments`, season and episode stats, `/search/recent_by_id/global/{type}`, `/sync/collection/media`, `/sync/favorites/media/rank/asc`, `/users/hidden/dropped`, `/users/me/notes/all`.
- **Blocked:** `/watchnow/sources` and `/{type}/{id}/watchnow/{country}` return 403. `/users/me/stats` returns 204.
- **Missing:** `/movies/hot` and `/{movies,shows}/streaming/{period}` return 404. `/shows/hot` works.
- **Filters:** `statuses` works and `status` is ignored, unlike `filters.md`. Parental filters take numeric ranges such as `0-1`; `none` is ignored. `/recommendations` ignores filters. `/calendars/*` ignores `limit`, and one 30-day response held 1,182 items.
- **Requests need `Content-Type: application/json`** even on GET, or some return 412.
- Full table in `specs/002-trakt-design-parity/contracts/api-usage.md`.

**Original options:**
1. **Video sources:** user-configured templates, nothing bundled. TMDB and Trakt terms both limit how their data may be used, and Trakt can revoke the client ID.
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
- Tauri 2 asset protocol and CSP: https://v2.tauri.app/security/asset-protocol/, https://v2.tauri.app/security/csp/; dialog plugin: https://v2.tauri.app/plugin/dialog/
- WebView2 frames and network events: https://learn.microsoft.com/microsoft-edge/webview2/concepts/frames, https://learn.microsoft.com/dotnet/api/microsoft.web.webview2.core.corewebview2.webresourceresponsereceived
- hls.js: https://github.com/video-dev/hls.js (1.7.3, Apache-2.0)
