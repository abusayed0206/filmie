---
description: "Task list for Trakt design parity with filters"
---

# Tasks: Trakt design parity with filters

**Input**: Design documents from `/specs/002-trakt-design-parity/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md, trakt-design-reference.md

**Tests**: The project rule is that testable logic lives in `ui/lib.js` with tests in `tests/ui.test.js`, and Rust logic has `cargo test` cases. Each new pure helper and each database function gets a test. Everything visual is checked with [quickstart.md](quickstart.md).

**Order**: Phases follow the plan's delivery order, not story number. US2 comes before US1 because the switch and filter button sit in the top bar. Each phase ends with a checkpoint for review.

**Design values**: Anything not given here comes from [trakt-design-reference.md](trakt-design-reference.md). Write new code from it, and don't copy code, styles, icons or assets from trakt-web.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story the task belongs to

---

## Phase 1: Setup

**Purpose**: Confirm what the API really allows, and that the base from feature 001 works, before building on either.

- [X] T001 Write a throwaway probe outside the repo that calls every endpoint in `specs/002-trakt-design-parity/contracts/api-usage.md` with a free account, using keys read from `.env.local` and never printing them, then record each status in `docs/PLAN.md` with the date. Include `/sync/progress/up_next_nitro`, `statuses` as a filter name, `extended=colors`, the `/sync/watchlist` sort path, filters on `/recommendations`, the notes routes, the search empty state, and the `/stats` and `/watching` rows that research flagged. This needs a signed-in session, so ask the user to run it or to approve running it
- [X] T002 Correct `specs/002-trakt-design-parity/contracts/api-usage.md` from T001's results, replacing or removing anything that isn't free, and note in `specs/002-trakt-design-parity/research.md` any decision that changed
- [X] T003 Ask the user to run the remaining checks in `specs/001-trakt-style-ui/quickstart.md` in the real app, fix what fails in `ui/app.js` or `ui/style.css`, and mark T029 in `specs/001-trakt-style-ui/tasks.md`
- [X] T004 [P] Add `roboto-latin-wght-normal.woff2` from `@fontsource-variable/roboto` 5.3.0 to `ui/fonts/`, and add a Roboto entry with its OFL 1.1 licence and source to `THIRD_PARTY_NOTICES.md`

**Checkpoint**: The API is known and feature 001 is confirmed. If T001 removes something large, tell the user before continuing.

---

## Phase 2: Foundational

**Purpose**: Blocks all stories.

- [X] T005 Split `ui/app.js` without changing behaviour into `ui/core.js`, `ui/controls.js`, `ui/cards.js`, `ui/pages-browse.js`, `ui/pages-title.js` and `ui/pages-me.js` as listed in `specs/002-trakt-design-parity/plan.md`, leaving router, start-up and the player in `ui/app.js`, and load them in order from `ui/index.html`
- [X] T006 Update `tests/ui.test.js` so that the parse and icon checks read every script in `ui/`, not only `app.js`
- [X] T007 Replace the tokens in `ui/style.css` with the reference's colours, type, gaps, radii, shadow and motion, using Filmie's `#e5484d` red in every accent role with hover and text shades derived from it, declare Roboto with `font-display: swap` and a Segoe UI fallback, and set the type scale of text 14, small 12, tag 10, title 18
- [X] T008 Update `.background_color(...)` in `src-tauri/src/main.rs` to the sRGB value of the new `--bg`
- [X] T009 Remove the cross-fade from `route()` in `ui/app.js` and the view transition rules from `ui/style.css`, keeping placeholders, scroll memory, `aria-busy`, focus handling and soft refresh, and update the skeleton pulse to opacity .4 to .8 over 750 ms
- [X] T010 Restyle buttons, inputs, checkboxes and toasts in `ui/style.css` to the reference's button heights, radii, flat style, action buttons, switch and snackbar, and test `appearance: base-select` for `select` in the running app, keeping the styled native select as a fallback under `@supports not`
- [X] T011 Add `drawer({ title, width, body, onClose })` and `modal({ title, body, actions })` on native `<dialog>` with `showModal()` to `ui/controls.js`, with the reference's slide and scale behaviour in `ui/style.css`, closing via Escape and the area outside, and returning focus
- [X] T012 Add `menu(button, items)` using the `popover` attribute and `segmented(name, options, value, onChange)` using radio inputs with a sliding indicator to `ui/controls.js`, with styles in `ui/style.css`

**Checkpoint**: The app looks closer to Trakt and everything still works.

---

## Phase 3: User Story 2 - Trakt's app shell (Priority: P1)

**Goal**: Trakt's top bar and rail.

**Independent Test**: Reach every destination from the rail in both widths and watch the top bar while scrolling. Scenarios 10, 11 and 12 in `quickstart.md`.

- [X] T013 [US2] Add `header.topbar` with `.topbar-left`, `.topbar-center` and `.topbar-right` to `ui/index.html`, styled in `ui/style.css` as fixed, inset by `--rail` and hidden while playing
- [X] T014 [US2] Add a passive scroll listener in `ui/app.js` that sets `body.scrolled`, turning on the blurred layer in `ui/style.css`
- [X] T015 [US2] Make `route()` in `ui/app.js` read `pages.x.bar = { title, meta, back, mode, filters }` before running a page and fill the top bar from it, and give each existing page a `bar`, with a `.sr-only` `<h1>` where the bar shows the title
- [X] T016 [US2] Replace the rail items in `ui/index.html` with Search; Home with Continue Watching, Calendar and Recommended; Discover with Trending, Releases, Anticipated and Popular; Lists with Watchlist, My Lists, Liked and Shared; and History, Library, Settings and profile at the bottom, adding sprite symbols drawn for Filmie
- [X] T017 [US2] Update `navFor` in `ui/lib.js` for the new routes in `specs/002-trakt-design-parity/contracts/ui-shell.md`, with cases in `tests/ui.test.js`
- [X] T018 [US2] Make the rail's bottom group a hover menu when narrow, closing 150 ms after leaving and also opening on keyboard focus, in `ui/app.js` and `ui/style.css`
- [X] T019 [US2] Add temporary pages for routes not built yet in `ui/pages-browse.js` and `ui/pages-me.js`, so that no rail item leads nowhere, and hide items that need an account when signed out
- [X] T020 [US2] Replace `#/shows` and `#/movies` with `#/discover` and set the mode in `ui/app.js`, holding the mode in a simple `getMode` until Phase 4

**Checkpoint**: Trakt's shell works around the existing pages.

---

## Phase 4: User Story 1 - Media switch and filters (Priority: P1)

**Goal**: The Media, Shows, Movies switch and the filter drawer. This is what the request is about.

**Independent Test**: On Home and Discover, change the switch and confirm every row changes type. Open the filter drawer, set a genre and a decade, and confirm results narrow and the button shows a count. Scenarios 1 to 9 in `quickstart.md`.

- [X] T021 [US1] Add `getMode`, `setMode` and `forMode(media, show, movie)` to `ui/core.js`, with `localStorage` key `mode`: "`media`, `show` or `movie`", default `media`, "Anything else is the default", wrapped in `try/catch`, and with `setMode` calling `route({ soft: true })`
- [X] T022 [US1] Put the segmented switch in `.topbar-center` from `ui/app.js` when a page's `bar.mode` is `'bar'`, with an icon and label for each option, and draw the three icons in `ui/index.html`
- [X] T023 [US1] Make the existing rows on Home, Discover and Up next use `forMode` per `specs/002-trakt-design-parity/contracts/api-usage.md`, in `ui/pages-browse.js`, and merge results for Media where there's no Media endpoint
- [X] T024 [US1] Add a type icon tag to cards in Media mode in `ui/cards.js`
- [X] T025 [US1] Add `FILTERS` to `ui/lib.js` with every filter in the reference's table: key, label, group, Simple options with preset expansion, Advanced control and valid modes, leaving out individual streaming services, which returned 403 in the probe, and using `statuses` and numeric parental ranges as recorded in `contracts/api-usage.md`
- [X] T026 [US1] Add pure `cleanFilters(obj)`, `filterQuery(filters, mode)` and `filterCount(filters, mode)` to `ui/lib.js`, exported and tested in `tests/ui.test.js` for preset expansion, ranges at full width counting as no filter, exclusion, invert on Watched and Watchlisted, unknown keys dropped, filters invalid for a mode skipped, and URL encoding
- [X] T027 [US1] Add filter state to `ui/core.js`: `localStorage` keys `filters` and `filters-default` as "JSON object", default `{}`, "Unknown keys and values are dropped through `cleanFilters`", and `filters-tab` as "`simple` or `advanced`", default `simple`. Add `activeFilters()` following `bar.filters` scope: `'global'` uses `localStorage`, `'local'` an in-memory set per route
- [X] T028 [US1] Add the filter button with a count badge to `.topbar-right` in `ui/app.js`, disabled and faded when `bar.filters` is false
- [X] T029 [US1] Add a dual-thumb range slider to `ui/controls.js` from two overlaid range inputs, with styles in `ui/style.css`, keyboard support and accessible names
- [X] T030 [US1] Build `openFilterDrawer()` in `ui/controls.js`: Reset, Set as default, compact switch, Simple and Advanced tabs, a Display section and a confirmation when going from Advanced to Simple, loading options from `/genres`, `/countries`, `/certifications` and `/languages`, and applying only on close if something changed
- [X] T031 [US1] Append `filterQuery` to supporting endpoints in `ui/pages-browse.js` and reset row scroll when filters change, hiding account-only filters when signed out
- [X] T032 [US1] Show Trakt's empty placeholder with a reset action when a row or grid is empty because of filters, in `ui/cards.js`
- [X] T033 [P] [US1] Update `cache_policy` in `src-tauri/src/trakt.rs` so `/calendars/my` and any path containing `ignore_` are user-scoped, and `/genres`, `/countries`, `/languages` and `/certifications` last a day, with cases added to `cache_policy_separates_user_and_public_data`

**Checkpoint**: The missing filter is in. Review it with the user before continuing.

---

## Phase 5: User Story 3 - Trakt's look on every page (Priority: P1)

**Goal**: Rows and cards as Trakt.

**Independent Test**: Compare side by side with Trakt at the same window size. Scenarios 13, 14 and 15 in `quickstart.md`.

- [X] T034 [US3] Rework `renderRows` in `ui/cards.js` to take `{ id, title, meta, more, kind, load, actions }`, keyed by stable `id`, loading each row when near the viewport through one shared `IntersectionObserver`, and update all callers
- [X] T035 [US3] Add the row header in `ui/cards.js` and `ui/style.css`: collapse button, 18/22 px title linking to `more` with a caret, actions, meta under the title. Save collapse in `localStorage` key `rows-collapsed` as a JSON array, where "Non-array is the default"
- [X] T036 [US3] Remove row arrows, and give rows with `more` and more than one item `overflow-x: hidden` unlocked by a horizontal wheel, with edge fade and x-proximity snap, in `ui/cards.js` and `ui/style.css`
- [X] T037 [US3] Rebuild `posterCard` and add `episodeCard`, `summaryCard`, `listCard` and `personCard` in `ui/cards.js` with the reference's sizes, covers, footers and fallback title. Never nest a button in a link
- [X] T038 [US3] Add status tags in `ui/cards.js` with one indicator straddling the cover's bottom, in Trakt's priority order, from the sync mirror
- [X] T039 [US3] Add `cardMenu(item)` with watchlist, mark watched and add to list to `ui/cards.js`, using `menu()`, shown when signed in and updating through `write()` and soft refresh
- [X] T040 [US3] Set card hover to a 2 px accent outline with no movement, a 150 ms card fade-in, and 75% opacity on watched covers except on Trending, Popular, Anticipated and Recommended, in `ui/style.css`
- [X] T041 [US3] Add the call-to-action card for rows with 4 or fewer items and a `more` link, and placeholders for empty rows that exist to be filled, in `ui/cards.js`
- [X] T042 [US3] Extend `norm` in `ui/lib.js` for every response shape in `specs/002-trakt-design-parity/contracts/api-usage.md`, with a case per shape in `tests/ui.test.js`
- [X] T043 [US3] Bring Settings, the player toolbar and menus into the new tokens in `ui/style.css`, without changing the player's layout

**Checkpoint**: Combined with Phase 6 for review.

---

## Phase 6: User Story 4 - Home and Discover (Priority: P2)

**Goal**: Trakt's rows and full grids.

**Independent Test**: Sign in, check row order against the reference, open a row's title and scroll until more loads. Scenarios 16 and 17 in `quickstart.md`.

- [X] T044 [US4] Rebuild `pages.home` in `ui/pages-browse.js` with Continue Watching, Start Watching, Calendar, Recommended, History and Recently played per `api-usage.md`, and for signed-out people Recently played and public rows with a sign-in prompt
- [X] T045 [US4] Add `renderGrid(into, { pageSize, load, card })` to `ui/cards.js`, with 100 per page, the next page past 50% scroll or when content doesn't fill the view, a spinner, and a stop at a short page
- [X] T046 [US4] Build `pages.discover` in `ui/pages-browse.js` with Trending, Releases, Anticipated and Popular, the title following the mode, then the other free charts in `api-usage.md`
- [X] T047 [US4] Add grid pages for `#/discover/{trending,anticipated,popular,recommended}` in `ui/pages-browse.js`, with mode as meta text and the switch only in the filter drawer
- [X] T048 [US4] Add the `#/discover/releases` calendar view in `ui/pages-browse.js`
- [X] T049 [US4] Add inline mark watched on Continue Watching and Start Watching, and rate on History, in `ui/cards.js`, updating in place through soft refresh
- [X] T050 [US4] Add the `#/progress` Continue Watching grid with its sort drawer in `ui/pages-me.js`

**Checkpoint**: Browsing matches Trakt. Review with the user.

---

## Phase 7: User Story 5 - Title, episode and person pages (Priority: P2)

**Goal**: Trakt's title page and drawers, with everything the free API has.

**Independent Test**: Open a show, change season, open an episode drawer, mark it watched, rate it, read comments and press Play. Scenarios 18 to 22 in `quickstart.md`.

- [ ] T051 [US5] Rebuild the `showTitle` header in `ui/pages-title.js` and `ui/style.css`: poster up to 320 px radius 24, middle column in Trakt's order, 320 px right column, dropping below 1024 px
- [ ] T052 [US5] Fetch `extended=full,colors` and replace the backdrop with the radial glow in the title's colour, falling back to the accent, in `ui/pages-title.js` and `ui/style.css`
- [ ] T053 [US5] Add the floating action bar in `ui/pages-title.js` with Play first, then Track, watchlist, trailer and More, with More's panel for list, notes, history, drop and collection
- [ ] T054 [US5] Add the Track drawer with Just now, Release date and Other date posting to `/sync/history`, and a confirmation when already watched, in `ui/pages-title.js`. No check-in
- [ ] T055 [US5] Add the rating row with 5 half-step stars on a 10-point scale and Favourite, keyboard-operable, in `ui/pages-title.js` and `ui/style.css`
- [ ] T056 [US5] Add the ratings row and Ratings drawer with text labels for Trakt, IMDb and Rotten Tomatoes and the distribution, plus Details drawer from `/stats`, `/studios`, `/aliases`, `/translations` and `/releases/{country}`, in `ui/pages-title.js`
- [ ] T057 [US5] Rework Where to Watch into 96 × 96 tiles on existing TMDB data with the JustWatch line and a drawer, and add Sentiment below it, in `ui/pages-title.js`
- [ ] T058 [US5] Replace the episode list with a season rail opening on the next episode, a season dropdown and View All with a Seasons drawer, in `ui/pages-title.js`, keeping per-episode watched state
- [ ] T059 [US5] Add the episode drawer with details, Play, Track and rating, opened from episode cards, in `ui/pages-title.js`
- [ ] T060 [US5] Add Actors, Comments, Videos, Related and Lists in Trakt's order in `ui/pages-title.js`, leaving out any without data. Comments are plain text through `esc()`, with spoilers hidden until pressed and initials instead of avatars, marked with a `shortcut:` comment
- [ ] T061 [US5] Add `#/person/{id}` with details, TMDB photo, and movies and shows rows in `ui/pages-title.js`, opening from cast cards via `/search/tmdb/{id}?type=person`
- [ ] T062 [US5] Add any new external hosts to `EXTERNAL_HOSTS` in `src-tauri/src/main.rs` if links from these pages need them

**Checkpoint**: Title pages match Trakt. Review with the user.

---

## Phase 8: User Story 6 - Own tracking (Priority: P2)

**Goal**: Everything about the person's own tracking.

**Independent Test**: Sort the watchlist, open History and Library, change a progress filter and view the calendar by week and day. Scenarios 23 to 26 in `quickstart.md`.

- [ ] T063 [US6] Build `#/watchlist` in `ui/pages-me.js` as a summary grid with Trakt's sorts through a drawer, where the sort value replaces the rating on cards
- [ ] T064 [US6] Build the progress view with Completed, Ended, In progress and Dropped in `ui/pages-me.js`, hiding sort on Dropped
- [ ] T065 [US6] Build `#/history` in `ui/pages-me.js`, newest first and paged, with mode applied and a remove action
- [ ] T066 [US6] Build `#/library` from `/sync/collection/{type}` in `ui/pages-me.js`
- [ ] T067 [US6] Rebuild `#/lists` in `ui/pages-me.js`: Watchlist row, then My Lists with Personal, Liked and Shared, plus create, edit and delete, and handling for 420 using limits from `/users/settings`
- [ ] T068 [US6] Build `#/lists/{personal,liked,shared}` and rework `#/list/{id}` with sorts in `ui/pages-me.js`, using `renderGrid`
- [ ] T069 [US6] Build `#/calendar` in `ui/pages-me.js` and `ui/style.css`: week view by default, day view, pinned toolbar, episode-type switch and more on scroll
- [ ] T070 [US6] Add ratings, favourites and notes views reachable from Profile in `ui/pages-me.js`, and hidden items from Settings, only as T001 confirmed

**Checkpoint**: Tracking is complete. Review with the user.

---

## Phase 9: User Story 7 - Search and the command palette (Priority: P2)

**Goal**: Ctrl+K palette, and Trakt's search page.

**Independent Test**: Press Ctrl+K, type a title and open it by keyboard, then open Search and switch to People. Scenarios 27 and 28 in `quickstart.md`.

- [ ] T071 [US7] Build the palette in `ui/controls.js` and `ui/style.css` with placeholder "Where to?", sections Pages, Movies and Shows, and arrow, Enter and Esc hints, using ARIA combobox and listbox roles
- [ ] T072 [US7] Change the shortcuts in `ui/app.js` so Ctrl+K toggles the palette and `/` opens it outside text fields, neither of them in the player, replacing the behaviour from feature 001
- [ ] T073 [US7] Rebuild `pages.search` in `ui/pages-browse.js` with a Media, Shows, Movies, People, Lists switch and the box below it, moving the input out of `ui/index.html` to a container the router doesn't replace per query, keeping focus while typing, and debouncing about 0.13 s
- [ ] T074 [US7] Add results per mode and the empty states in `ui/pages-browse.js`, including 3-column list cards, and keep the query and position on Back

**Checkpoint**: Search is complete. Review with the user.

---

## Phase 10: User Story 8 - Stats from local data (Priority: P3)

**Goal**: Stats and a streak worked out on this PC, without VIP.

**Independent Test**: Sign in with an account that has history, let it sync, open Profile and compare totals with Trakt. Scenarios 29 to 33 in `quickstart.md`.

- [ ] T075 [US8] Add `trakt_history`, `trakt_ratings` and `sync_state` to `SCHEMA` in `src-tauri/src/db.rs` with the columns in `specs/002-trakt-design-parity/data-model.md`, and an index on `watched_at`
- [ ] T076 [US8] Add methods to `Db` in `src-tauri/src/db.rs` to store a page of history in one transaction, using `INSERT OR REPLACE` and skipping and logging items without "`id`, `watched_at` or a movie or show object", to replace ratings, skipping any "outside 1 to 10", and to clear all three tables, with tests on an in-memory database
- [ ] T077 [US8] Add a variant of `State::request` in `src-tauri/src/trakt.rs` that also returns `X-Pagination-Item-Count`, leaving `trakt` unchanged
- [ ] T078 [US8] Add the `history_sync` command in `src-tauri/src/trakt.rs` with the behaviour in `specs/002-trakt-design-parity/contracts/tauri-commands.md`, using `end_at` for backfill, `start_at` for incremental and a count comparison for removals, and register it in `src-tauri/src/main.rs`
- [ ] T079 [US8] Add the `stats` command and its SQL to `src-tauri/src/db.rs` per `contracts/tauri-commands.md`, using `date(watched_at, 'unixepoch', 'localtime')`, with tests for totals, genres, months and zeros when empty, and register it in `src-tauri/src/main.rs`
- [ ] T080 [US8] Clear the three tables in `sign_out` in `src-tauri/src/trakt.rs`, keeping the `history` table, with a test on `Db`
- [ ] T081 [P] [US8] Add pure `streakFrom(days, today)` and `weekHeatmap(days, today)` to `ui/lib.js`, exported and tested in `tests/ui.test.js`, including a streak ending yesterday and a gap
- [ ] T082 [US8] Drive `history_sync` from `syncInBackground` in `ui/app.js`, at most once a second while `complete` is false, stopping when the page's token changes or on sign-out
- [ ] T083 [US8] Build `#/profile` in `ui/pages-me.js` with totals, top genres, ratings and activity over time, progress during first sync, and Recently played totals with a sign-in prompt when signed out. Charts are CSS bars, with no new dependency
- [ ] T084 [US8] Add the streak callout with week heatmap to `pages.home` in `ui/pages-browse.js`, linking to Profile, shown only with a streak
- [ ] T085 [P] [US8] Describe local history and ratings in `PRIVACY.md`, `site/public/privacy.html` and the Saved on this PC card in `ui/pages-me.js`, including that signing out deletes them

**Checkpoint**: Stats work offline. Review with the user.

---

## Phase 11: Polish

- [ ] T086 [P] Update `CLAUDE.md` for the new script layout, `bar`, mode and filters, drawers, rows and local history, and correct anything from feature 001 that this replaced
- [ ] T087 [P] Update the feature list in `README.md`
- [ ] T088 Check that every destination works at the 800 × 500 minimum window with the rail wide and narrow, and fix `ui/style.css`
- [ ] T089 Check keyboard access and reduced motion across pages and fix `ui/style.css` and `ui/controls.js`, including 001's rule that the context menu stays only on text fields and selected text
- [ ] T090 Remove temporary pages and unused CSS and code left over from feature 001 in `ui/`
- [ ] T091 Run all of `specs/002-trakt-design-parity/quickstart.md`, including the licence and branding check, in the real app, with the user for signed-in scenarios

---

## Dependencies

- **Phase 1** comes first. T001 can change what later phases build, and needs the user.
- **Phase 2** blocks all stories. T005 goes first because every later task relies on the file split.
- **US2** needs Phase 2.
- **US1** needs US2's top bar.
- **US3** needs Phase 2 and is easiest after US1, since `renderRows` is rewritten.
- **US4** needs US1 and US3.
- **US5** needs US3 and Phase 2's drawer. Its rows reuse `renderRows`.
- **US6** needs US3 and US4's `renderGrid`.
- **US7** needs US3's cards and Phase 2's dialog.
- **US8** needs only Phase 2 and can move earlier if wanted. The Profile page needs US2's route.
- **Polish** follows everything.

## Parallel opportunities

Little runs in parallel, because most tasks touch the same files in order.

- **Phase 1:** T004 alongside T001 to T003.
- **Phase 4:** T033 in Rust alongside any frontend task.
- **Phase 10:** T081 in `lib.js` and T085 in the privacy docs alongside the Rust tasks. T075 to T080 run in order.
- **Phase 11:** T086 and T087.
- **Whole stories:** after Phase 5, US5, US6 and US7 could proceed separately, but they share `ui/cards.js` and `ui/style.css`. Running them in order is safer.

## Implementation strategy

**Smallest useful result**: Phases 1 to 4. That delivers the shell and the switch and filters you asked for, on the existing pages.

**Then**, one phase at a time with a review at each checkpoint, in the order above. Commit only when asked, and commit the current work on this branch before starting, since Phase 2 reorganises `ui/`.
