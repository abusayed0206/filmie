---
description: "Task list for the Trakt-style, near-native UI"
---

# Tasks: Trakt-style, near-native UI

**Input**: Design documents from `/specs/001-trakt-style-ui/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ui-shell.md, quickstart.md

**Tests**: The project rule is that testable logic lives in `ui/lib.js` with tests, so each new pure helper gets one. Everything visual is checked with [quickstart.md](quickstart.md).

**Order**: The plan's delivery order: US2, then US1, then US3. US2 goes first because it carries the two unverified platform facts.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story the task belongs to

## Phase 1: Setup

No project setup is needed: no new files, dependencies or build steps.

- [X] T001 Confirm in a Chromium page running `ui/index.html` that the `navigate` event fires for hash link clicks and for Back, with `navigationType` of `push` and `traverse`, and record the result in `specs/001-trakt-style-ui/research.md`

---

## Phase 2: User Story 2 - Moving around feels like a native app (Priority: P1)

**Goal**: No "Loading…" flash, cross-fading pages, Back restores scroll, and button presses and background sync don't disturb the page.

**Independent Test**: Scenarios 1, 8, 9, 10, 11, 12, 15 and 16 in `quickstart.md`.

- [X] T002 [US2] Add pure `scrollTarget(navType, saved)` to `ui/lib.js`, export it, and test it in `tests/ui.test.js`: returns `saved ?? 0` when `navType` is `'traverse'`, otherwise `0`
- [X] T003 [US2] Add scroll memory to `ui/app.js`: set `history.scrollRestoration = 'manual'`; a `navigate` listener records `navigationType` and saves `scrollY` in an in-memory `Map` under `navigation.currentEntry.key`, guarded so the app still runs without the API
- [X] T004 [US2] Add `skeleton(kind)` for kinds `rows`, `title` and `grid`, and a page-to-kind map per `contracts/ui-shell.md`, in `ui/app.js`, with `.sk` styles in `ui/style.css`
- [X] T005 [US2] Rework `route()` in `ui/app.js` to take `{ soft }`: normal mode swaps in the placeholder inside `document.startViewTransition` with no data awaited in the callback, skips the animation entering or leaving `play`, starts at the top, restores scroll on traversal after the page loads, sets `aria-busy`, and moves focus to `main` unless the search box has focus. Wrap the `hashchange` listener so it doesn't pass the Event as options
- [X] T006 [US2] Implement soft mode in `route()` in `ui/app.js`: render into a hidden sibling of `#app` that comes first in document order, then move the result into `#app` in one step, leaving placeholders, animation and scroll untouched
- [X] T007 [US2] Use `route({ soft: true })` for the title page's watchlist and watched buttons and in `syncInBackground`, and skip the background refresh on Settings so a draft server isn't lost, in `ui/app.js`
- [X] T008 [US2] Make `showTitle` in `ui/app.js` await the first season load so soft refresh and scroll restore see the page's full height
- [X] T009 [US2] Drop results of pages already left: check `routeToken` after the first await in `showTitle` and in `pages.lists`, `pages.list` and `pages.search` in `ui/app.js`
- [X] T010 [US2] Change `renderRows` in `ui/app.js` to show each section straight away with placeholder cards and remove it if it comes back empty or fails
- [X] T011 [P] [US2] Add transition, reduced-motion and text-selection rules to `ui/style.css`: 160 ms root cross-fade, `pointer-events: none` on the overlay, no animation or hover movement under `prefers-reduced-motion`, `user-select: none` on chrome with reading text and fields opted back in, and no outline on focused `main`
- [X] T012 [US2] Add a `contextmenu` listener in `ui/app.js` that allows the menu only on text fields and selected text
- [X] T013 [P] [US2] Add `.background_color(...)` matching `--bg` (`#0f1014`) and `.theme(Some(Theme::Dark))` to the window builder in `src-tauri/src/main.rs`, with a `shortcut:` comment that browser accelerator keys stay on

**Checkpoint**: The app looks the same but behaves natively. Stop and review before continuing.

---

## Phase 3: User Story 1 - Navigate from a Trakt-style side rail (Priority: P1)

**Goal**: A collapsible rail replaces the top header.

**Independent Test**: Scenarios 2 to 7 in `quickstart.md`.

- [X] T014 [US1] Add pure `navFor(page)` to `ui/lib.js`, export it, and test it in `tests/ui.test.js` using the table in `specs/001-trakt-style-ui/data-model.md`
- [X] T015 [US1] Replace `<header id="top">` with the rail markup from `contracts/ui-shell.md`, move `#q` into `div.searchbar`, and add sprite symbols for the rail icons in `ui/index.html`
- [X] T016 [US1] Style the rail, tooltips, `.searchbar` and `main` offset in `ui/style.css`, with `--rail` of `72px` narrow and `204px` wide, and remove the old `header`, `nav` and `.search` rules and the header part of the 860 px media query
- [X] T017 [US1] Add the rail toggle in `ui/app.js`: `localStorage` key `rail`, value `'wide'`, or "absent or anything else for narrow", wrapped in `try/catch` like the other preferences and applied as `body.rail-wide`
- [X] T018 [US1] Update `route()` in `ui/app.js` to set `.active` and `aria-current="page"` from `navFor`, and to mark the search page so `.searchbar` shows
- [X] T019 [US1] Update `refreshUser` in `ui/app.js` to write the account label inside `.nav-label`, so signed-out text fits the narrow rail
- [X] T020 [US1] Add Ctrl+K and the empty `#/search` state in `ui/app.js`: go to search and focus the box from anywhere except the player, with no results until a query is typed

**Checkpoint**: Rail works with the old card styles.

---

## Phase 4: User Story 3 - Cards, rows and title pages look like Trakt (Priority: P2)

**Goal**: Whole-card rows and Trakt's title page layout, in Filmie's colours.

**Independent Test**: Scenarios 13 and 14 in `quickstart.md`.

- [X] T021 [US3] Update tokens in `ui/style.css`: `--gutter: 24px`, `--radius: 12px`, `--gap: 12px`, leaving the palette alone
- [X] T022 [US3] Make rows whole-card in `ui/style.css`: `.row` is an inline-size container, stepped `@container` rules set `--n` for portrait (at least 132 px, up to 10) and landscape (at least 200 px, up to 7), and `.poster` and `.ep-card` widths come from the row
- [X] T023 [US3] Make the row heading the "See all" link, with a chevron, in `renderRows` in `ui/app.js` and `ui/style.css`
- [X] T024 [US3] Rework the `showTitle` markup in `ui/app.js` and `.summary*` in `ui/style.css` into poster, details and where-to-watch columns that drop to fewer columns on narrower windows, leaving out where-to-watch when there is no data
- [X] T025 [US3] Replace the cast sentence in `showTitle` in `ui/app.js` with a row of cards (photo from `image.tmdb.org`, name and character through `esc()`, neutral placeholder without a photo), with styles in `ui/style.css`
- [X] T026 [US3] Bring grid pages, lists, Settings and the profile strip in line with the new spacing and radius in `ui/style.css`

**Checkpoint**: Whole feature visible.

---

## Phase 5: Polish

- [X] T027 [P] Update the Frontend and Player notes in `CLAUDE.md` for the rail, `route({ soft })` and scroll memory
- [X] T028 [P] Check whether `site/public/og.png` shows the old header, and tell the user if so
- [X] T029 Run all of `specs/001-trakt-style-ui/quickstart.md`, including the licence and branding check, in the real app The user confirmed launch, real artwork, Back and Forward, the rail and playing from a saved server on 2026-11-03. Remaining scenarios are covered by scenario 37 in `specs/002-trakt-design-parity/quickstart.md`.

---

## Dependencies

- **T001** comes first. If it fails, use the `popstate` fallback in `plan.md` for T003.
- **US2** has no dependencies.
- **US1** needs `route()` from T005.
- **US3** needs the rail for correct row widths, so it follows US1.
- **Polish** follows everything.

Within US2: T002 → T003 → T005 → T006 → T007. T004 before T005. T008, T009, T010 and T012 touch `ui/app.js`, so they run one after another.

## Parallel opportunities

Only tasks in different files: T011 (`ui/style.css`) and T013 (`src-tauri/src/main.rs`) in US2, and T027 and T028 in Polish. Almost everything else touches `ui/app.js`, so it runs in order.

## Implementation strategy

Work through one phase, then stop at its checkpoint and review before starting the next. Commit only when asked.
