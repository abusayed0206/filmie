# Research: Trakt design parity with filters

Checked 2026-11-03 against trakt-web `9ebdbff` and trakt-api `090d333`. Design measurements are in [trakt-design-reference.md](trakt-design-reference.md).

## 1. Which endpoints are free

- **Decision**: Use only endpoints with no VIP Only or Limited Access tag. The per-page list is in [contracts/api-usage.md](contracts/api-usage.md).
- **Method**: a script read the description tags of all 301 endpoints in trakt-api's contracts. 23 are tagged VIP Only or Limited Access.
- **Affected features**:
  - Per-title streaming lookup (`/movies/:id/watchnow/:country`, shows, episodes) and `/watchnow/sources` are Limited Access. Where to watch stays on TMDB's JustWatch data, as it is today.
  - `/users/:id/stats` and saved server-side filters are VIP Only. Stats are worked out locally, and saved filters stay in `localStorage`.
  - `/shows/:id/progress/watched/reset` is VIP Only, so there is no "reset progress" control.
- **Limit of this check**: the script reads text around each path, so a nested route can be mislabelled. For example, two `/stats` and `/watching` rows under `shows` read as Limited, and these look like season or episode routes. Step 1 therefore probes the real API with a free account before anything is built on it. `/sync/progress/up_next_nitro` is the one to watch, because trakt-web uses it and its name suggests an internal route, though it carries no Limited tag. `/sync/progress/up_next` is the fallback.
- **Alternatives rejected**: asking for Limited Access approval, because the spec requires every flow to work without it.

## 2. Filters

- **Decision**: Define filters as data in `ui/lib.js`, with a pure function that turns the active set into a query string. Send filters on endpoints tagged as supporting them.
- **Parameters confirmed in the contracts** (`mediaFilterParamsSchema`): `watchnow`, `genres`, `subgenres`, `years`, `ratings`, `runtimes`, `countries`, `statuses`, `certifications`, `parental_nudity`, `parental_violence`, `parental_profanity`, `parental_alcohol`, `parental_frightening`, `parental_include_unrated`. Also `ignore_watched` and `ignore_watchlisted` (`ignoreQuerySchema`), and `imdb_ratings`, `rt_meters`, `rt_user_meters` for Advanced ratings.
- **Availability**: `subscriptions`, `free` and `any` are available. The service list comes from a Limited Access endpoint, so individual service chips are left out unless the probe shows otherwise.
- **`status` or `statuses`**: `filters.md` says `status` and the schema says `statuses`. Follow the schema, which trakt-web also uses, and confirm in the probe.
- **Rejected**: mapping filters per page, because the same set applies everywhere and only the endpoint changes.

## 3. Where mode and filters live

- **Decision**: Mode, saved filters, tab choice and row collapse live in `localStorage`, read through one small state module. They are not in the route.
- **Rationale**: Trakt uses the address for sharing links, and Filmie has no address bar. This keeps routes as they are and needs no query parsing in the router.
- **Scope rule**: global pages share one filter set in `localStorage`. Other pages hold theirs in memory per route, so leaving restores it, as Trakt does.
- **Rejected**: query parameters in the hash, which would add parsing and history entries for each filter change with no benefit here.

## 4. Applying a mode or filter change

- **Decision**: Reuse `route({ soft: true })`. Old rows stay until the new ones are ready, then swap in one step.
- **Rationale**: this code already exists and meets SC-001 on cached data.

## 5. Page changes

- **Decision**: Remove the cross-fade and `startViewTransition` from `route()`. Cards fade in over 150 ms, as Trakt.
- **Rationale**: Trakt has no global transition, per the reference. Removing it also removes the wait for a rendered frame found in feature 001. Placeholders, scroll restore and soft refresh stay.

## 6. Artwork, colours and logos

- **Decision**: Keep TMDB for posters, backdrops, logos, episode stills and person photos. Take the title's colour from Trakt with `extended=colors`. Add `images` to the existing TMDB title request for logos.
- **Rationale**: no CSP change. The API guide says Trakt images must be cached, and `docs/PLAN.md` records that Trakt blocks hotlinking, so using them would need an image proxy with a disk cache. TMDB's rate limits are also far less of a concern here than Trakt's 500 reads per 5 minutes.
- **Comment avatars**: Trakt-hosted, so comments show initials. Mark this with a `shortcut:` comment, to upgrade if an image proxy is ever added.
- **Rating logos**: IMDb and Rotten Tomatoes appear as text labels, since Filmie has no licensed logo assets and can't copy Trakt's.
- **Rejected**: a custom URI scheme image proxy, which is more Rust and a wider CSP for no visible gain.

## 7. Controls

- **Decision**:
  - **Drawers and modals**: native `<dialog>` with `showModal()`, which provides focus trapping, Escape, inert background and focus return.
  - **Selects**: native `<select>` with `appearance: base-select`, keeping native keyboard behaviour. [MDN](https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Forms/Customizable_select) lists it as limited availability and doesn't state keyboard behaviour, so test it in WebView2. Unsupported runtimes fall back to the current styled select.
  - **Segmented switch**: radio inputs with a sliding indicator.
  - **Sliders**: two overlaid range inputs for a min and max.
  - **Menus**: the `popover` attribute with `popovertarget`, so no JS is needed to open them or to close on outside click.
- **Rationale**: fewer lines and correct accessibility. FR-011 can't be cut, and these provide it for free.
- **Rejected**: a component library, because Filmie has no build step and doesn't add dependencies for this.

## 8. Roboto

- **Decision**: Commit `roboto-latin-wght-normal.woff2` (43 KB) from `@fontsource-variable/roboto` 5.3.0 to `ui/fonts/`, declare it with `font-display: swap`, and fall back to Segoe UI for other scripts. Add it to `THIRD_PARTY_NOTICES.md`.
- **Rationale**: OFL 1.1 allows bundling. `default-src 'self'` already permits it, and Google Fonts is blocked by CSP.

## 9. Local history

- **Decision**: New tables in `filmie.sqlite3` for history and ratings, filled by a Rust `history_sync` command.
- **Fetch**: `/sync/history` with `extended=full`, which the contract allows, so runtime and genres arrive with each item. Pages of 100.
- **Resume**: the API returns newest first, so backfill walks backwards with `end_at` set to the oldest stored date. This survives restarts, and new items don't shift the position.
- **Incremental**: when `/sync/last_activities` shows a change, fetch with `start_at` set to the newest stored date.
- **Removals**: read `X-Pagination-Item-Count` from a one-item request. If it differs from the local count after the incremental fetch, refetch from scratch. Trakt's activity stamps don't say what was removed, so the count is the reliable signal.
- **Pacing**: at most one page per second, so a long backfill can't use up the shared read limit.
- **Rejected**:
  - `/users/:id/stats`, which is VIP Only.
  - Keeping it in `library.json`, because stats need SQL and history can be large.
  - `/sync/watched`, which gives play counts but no dates, so no streak or activity over time.

## 10. Stats

- **Decision**: A Rust `stats` command runs SQL over the local tables. The streak logic is a pure helper in `lib.js`, fed a list of local dates.
- **Local dates**: `date(watched_at, 'unixepoch', 'localtime')`, so a streak follows the person's own day.
- **Check**: SC-006 compares totals with `/sync/watched` play counts and the profile's own numbers.
- **Policy**: this only stores the person's own data, which Trakt's API policy allows. FR-024 keeps the catalogue out of it.

## 11. Staying under the rate limit

- **Decision**:
  - Rows fetch only when near the viewport. Home has 6 rows, but those below the fold don't call until scrolled to.
  - Rows ask for 10 items, as Trakt. Grids ask for 100 per page.
  - Filter changes apply when the drawer closes, not per control.
  - The existing SQLite cache handles repeats, and `ui/app.js` already shares in-flight requests.
- **Rationale**: reads are limited to 500 per 5 minutes, and `State::request` already retries once on 429.

## 12. Cache policy changes

- **Finding**: `cache_policy` marks a path as user-specific only under `/sync/`, `/users/`, `/recommendations` or `/progress/`.
- **Decision**: also treat `/calendars/my` and any path with `ignore_` as user-scoped. Otherwise one person's filtered results would survive sign-out. Add test cases to the existing `cache_policy_separates_user_and_public_data`.

## 13. Community content

- **Decision**: Comments render as plain text through `esc()`, with no markdown. Spoiler-flagged ones stay hidden until pressed.
- **Rationale**: this is untrusted text going through `innerHTML`.

## 14. Marking watched

- **Decision**: Track opens a drawer offering Just now, Release date or Other date, and posts to `/sync/history`. There's no check-in item.
- **Rationale**: `CLAUDE.md` records manual tracking as a decision, and a check-in marks an item watched when its runtime ends.

## 15. Frontend file structure

- **Decision**: Split `ui/app.js` into classic scripts by area: `core.js`, `controls.js`, `cards.js`, `pages-browse.js`, `pages-title.js`, `pages-me.js`, `app.js` (router and start-up). The test that parses `app.js` and checks icons must read all of them.
- **Rationale**: `app.js` is about 950 lines now and this feature would roughly triple it. Classic scripts with shared globals match the project's rule and need no build step.

## 16. Privacy text

- **Decision**: Update `PRIVACY.md`, `site/public/privacy.html` and the Settings text. They list what is stored, and watch history is new.

## Resolved unknowns

All Technical Context items are resolved. Step 1's probe covers what reading alone can't confirm: `up_next_nitro`, the `statuses` name, `extended=colors`, and the mislabelled rows.
