# Implementation Plan: Trakt design parity with filters

**Branch**: `002-trakt-design-parity` (feature label only; no git branch created, work is on `remove-bundled-servers`) | **Date**: 2026-11-03 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-trakt-design-parity/spec.md`

## Summary

Rebuild Filmie's frontend to follow Trakt's desktop design as measured in [trakt-design-reference.md](trakt-design-reference.md), with Filmie's red accent and name. It adds the missing Media, Shows, Movies switch and filter drawer, Trakt's top bar and rail, its rows, cards and title page, side drawers, a command palette, and pages for everything the free API tier offers for browsing and tracking. Watch history moves into SQLite, so stats work offline and without VIP. It's new plain JS, CSS and a small amount of Rust, and nothing is copied from trakt-web, which is GPLv3. See [research.md](research.md).

## Technical Context

**Language/Version**: JavaScript (classic scripts, no modules) and CSS in `ui/`; Rust 2021 in `src-tauri/src/`

**Primary Dependencies**: Tauri 2, WebView2, rusqlite, reqwest, all existing. One new bundled asset: the Roboto font (OFL 1.1). No new packages or crates.

**Storage**: `filmie.sqlite3` gains `trakt_history`, `trakt_ratings` and `sync_state`. `localStorage` gains `mode`, `filters`, `filters-default`, `filters-tab` and `rows-collapsed`. See [data-model.md](data-model.md).

**Testing**: `node --test tests/ui.test.js` for pure helpers, `cargo test` for sync and stats on an in-memory database, and the manual scenarios in [quickstart.md](quickstart.md)

**Target Platform**: Windows desktop, WebView2, window 800×500 and up

**Project Type**: Desktop app

**Performance Goals**: Mode changes within 1 second on cached data; Profile stats in under 1 second; no failed page from rate limits in an hour of normal use

**Constraints**:

- CSP unchanged: `script-src 'self'`, `img-src` only `image.tmdb.org`, `data:`, `blob:`, `connect-src` IPC only, no remote fonts
- No build step
- Trakt's free tier: 500 reads per 5 minutes, 1 write per second, no VIP Only or Limited Access endpoint
- `innerHTML` rendering, so interpolated data goes through `esc()`, and comments are untrusted text
- Watch tracking stays manual, with no check-in or scrobble
- No code or assets from trakt-web, and no Trakt logo

**Scale/Scope**: About 17 routes, 8 user stories, most of `ui/` rewritten, 6 new script files, about 300 lines of Rust. Local history may reach tens of thousands of rows.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template, so it defines no gates. In its place, the project rules in `CLAUDE.md` and the user's decisions served as the gates:

| Gate | Pre-design | Post-design |
|---|---|---|
| No frontend build step, classic scripts | Pass | Pass: split into more classic scripts |
| Webview does no networking of its own; CSP unchanged | Pass | Pass: Trakt-hosted images deliberately avoided, research 6 |
| Testable logic in `lib.js` with tests | Pass | Pass: filter and streak helpers |
| Interpolated data through `esc()` | Pass | Pass: comments are plain text, research 13 |
| Icons in the sprite; test covers every script | Pass | Pass: test extended to all scripts |
| Watch tracking stays manual | Pass | Pass: no check-in or scrobble, research 14 |
| Window lockdown and capabilities unchanged | Pass | Pass |
| Player toolbar stays above the iframe | Pass | Pass: player layout untouched |
| Re-check official docs before changing integrations; record in `docs/PLAN.md` | Pass | Pass, once step 1's probe records its results |
| Filmie stays MIT; no trakt-web code | Pass | Pass: new code only, checked in quickstart |
| No Trakt logo, no implied endorsement | Pass | Pass: red accent, Filmie's name, Settings sentence kept |
| Free tier only | Pass | Pass: [contracts/api-usage.md](contracts/api-usage.md), confirmed by the probe |
| Trakt policy: no bulk mirroring of the catalogue | Pass | Pass: only the person's own data is stored, research 10 |
| Privacy text matches what's stored | Pass | Pass: research 16 |

No violations. Running `/speckit-constitution` would replace this table with real gates, and it is optional for this feature.

## Project Structure

### Documentation (this feature)

```text
specs/002-trakt-design-parity/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── trakt-design-reference.md
├── contracts/
│   ├── api-usage.md
│   ├── ui-shell.md
│   └── tauri-commands.md
├── checklists/requirements.md
└── tasks.md             # Created by /speckit-tasks
```

### Source Code (repository root)

```text
ui/
├── index.html           # Top bar, rail items, sprite, script list
├── style.css            # Tokens and every component, rewritten
├── fonts/               # Roboto
├── lib.js               # Adds FILTERS, cleanFilters, filterQuery, filterCount, streakFrom, weekHeatmap
├── core.js              # New: invoke wrappers, state, mode, filters state, toast (from app.js)
├── controls.js          # New: drawer, modal, menu, segmented, slider, filter drawer, palette
├── cards.js             # New: cards, card menu, rows, grids, skeletons (from app.js)
├── pages-browse.js      # New: Home, Discover, grids, Search
├── pages-title.js       # New: title, episode drawer, person, Track drawer (from app.js)
├── pages-me.js          # New: progress, watchlist, lists, history, library, calendar, profile, Settings (from app.js)
└── app.js               # Router, top bar, rail and start-up only; player stays here
src-tauri/src/
├── db.rs                # New tables, stats, sign-out clearing
├── trakt.rs             # history_sync, item count, cache_policy, sign-out
└── main.rs              # Handler list, window background
tests/ui.test.js         # New helpers; parse and icon checks over every script
docs/PLAN.md             # Probe results
CLAUDE.md                # Frontend layout, drawers, local history
README.md                # Features
PRIVACY.md               # Local history
site/public/privacy.html # Local history
THIRD_PARTY_NOTICES.md   # Roboto
```

**Structure Decision**: Keep `ui/` flat with classic scripts and shared globals, loaded in order from `index.html`. `app.js` would otherwise reach about 3,000 lines. `lib.js` stays the only file the tests import.

## Delivery order

Each step leaves a working app and ends with a review, as feature 001 did:

1. **Probe and foundation:** run the endpoint probe and record it. Then split the scripts, add tokens and Roboto, restyle the controls, and add the top bar and rail (US2, part of US3).
2. **Switch and filters (US1):** this is what the request is about, so it comes as soon as the top bar exists. Works on the existing rows at first.
3. **Rows, cards, Home, Discover and grids (US3, US4).**
4. **Title, episode and person pages with drawers (US5).**
5. **Own tracking (US6):** progress, watchlist, lists, history, library, calendar.
6. **Search and palette (US7).**
7. **Local history and stats (US8).** Last, since nothing depends on it, except the streak callout, which appears here.

## Risks

| Risk | Mitigation |
|---|---|
| An endpoint fails with a free account despite no tag | Probe first, and each contract row has a fallback or can be left out |
| The classifier mislabelled a nested route | Probe covers the flagged rows |
| A closer look-alike is mistaken for official, and Trakt can revoke the client ID | Red accent, Filmie's name, no logo, Settings sentence kept |
| Trakt's terms limit how its data may be used, and Filmie plays video | Existing project risk, recorded in `docs/PLAN.md`. The bundled servers are removed on this branch, though not yet merged or released |
| Rate limit during a long history backfill | One page per second at most, row loading is lazy, 429 retry stays |
| `appearance: base-select` misbehaves in WebView2 | Test early in step 1; the current styled native select is the fallback |
| Rewriting most of `ui/` regresses player or sign-in | Player markup stays, and each step re-runs the affected checks. `lib.js` tests stay |
| Feature 001 was never tested in the real app | Step 1 includes that check, before more is built on it |
| Removing arrows leaves mouse users unable to scroll rows | As Trakt, the row title leads to the full grid, and rows without a grid scroll normally |
| Row and card data shapes differ across endpoints | `norm()` in `lib.js` is extended with tests per shape |

## Complexity Tracking

No gate violations to justify. The size comes from the scope the user asked for.
