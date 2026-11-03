# Implementation Plan: Trakt-style, near-native UI

**Branch**: `001-trakt-style-ui` (feature label only; no git branch created, work is on `main`) | **Date**: 2026-11-03 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-trakt-style-ui/spec.md`

## Summary

Restyle Filmie's frontend after Trakt's desktop app and make navigation feel native. The top header becomes a collapsible side rail, "Loading…" becomes layout-shaped placeholders, pages cross-fade, Back restores scroll, button presses stop resetting the page, and rows and title pages follow Trakt's layout. Everything is new plain JS and CSS in `ui/`, with Filmie's brand. Nothing is copied from trakt-web, which is GPLv3. See [research.md](research.md).

## Technical Context

**Language/Version**: JavaScript (classic scripts, no modules) and CSS in `ui/`; Rust 2021 for two window settings in `src-tauri/src/main.rs`

**Primary Dependencies**: Tauri 2, WebView2 (evergreen Chromium). No new dependencies.

**Storage**: One new `localStorage` key, `rail`. See [data-model.md](data-model.md).

**Testing**: `node --test tests/ui.test.js` for pure helpers, CI's existing Rust checks, and the manual scenarios in [quickstart.md](quickstart.md)

**Target Platform**: Windows desktop, window 800×500 and up

**Project Type**: Desktop app

**Performance Goals**: Placeholders or content in the first painted frame after a click; page changes finish animating within 200 ms

**Constraints**:

- CSP stays as it is: `script-src 'self'` (no inline scripts or `on*` attributes), `img-src` only `image.tmdb.org`, `data:`, `blob:`, no remote fonts
- No build step
- `innerHTML` rendering, so interpolated data goes through `esc()`
- Never await data inside a view transition callback, because the page is frozen while it is pending
- Watch tracking stays manual

**Scale/Scope**: 3 frontend files reworked (`index.html`, `style.css`, `app.js`), 2 small helpers in `lib.js`, 2 window settings in `main.rs`, about 10 pages restyled through shared CSS

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template, so it defines no gates. In its place, the project rules in `CLAUDE.md` and the two licensing and branding decisions served as the gates:

| Gate | Pre-design | Post-design |
|---|---|---|
| No frontend build step, classic scripts | Pass | Pass: plain JS and CSS |
| Webview does no networking of its own; CSP unchanged | Pass | Pass: no new requests from the page, cast photos come from `image.tmdb.org` |
| Testable logic in `lib.js` with tests | Pass | Pass: `navFor`, `scrollTarget` |
| Interpolated data through `esc()` | Pass | Pass: placeholders hold no data; cast cards use `esc()` |
| Icons in the sprite | Pass | Pass: new symbols added; existing test checks `icon()` uses |
| Watch tracking stays manual | Pass | Pass: no new Trakt writes |
| Window lockdown unchanged | Pass | Pass: `on_navigation`, `on_new_window`, capabilities untouched |
| Player toolbar stays above the iframe | Pass | Pass: player layout untouched |
| Filmie stays MIT; no trakt-web code | Pass | Pass: new code only, checked in quickstart |
| No Trakt logo, no implied endorsement | Pass | Pass: Filmie's brand, Settings sentence kept |

No violations. Running `/speckit-constitution` would replace this table with real gates, and it is optional for this feature.

## Project Structure

### Documentation (this feature)

```text
specs/001-trakt-style-ui/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/ui-shell.md
├── checklists/requirements.md
└── tasks.md             # Created by /speckit-tasks
```

### Source Code (repository root)

```text
ui/
├── index.html           # Header → rail, searchbar, new sprite symbols
├── style.css            # Tokens, rail, skeletons, row sizing, title layout, transitions
├── app.js               # route({soft}), skeleton(), scroll memory, rail toggle, Ctrl+K, renderRows, showTitle
└── lib.js               # navFor(page), scrollTarget(navType, saved)
tests/ui.test.js         # Tests for the two helpers
src-tauri/src/main.rs    # background_color, theme
CLAUDE.md                # Frontend notes on the rail, route({soft}) and scroll memory
```

**Structure Decision**: Keep the existing `ui/` layout and its four files. No new files, since `app.js` is the only place pages are rendered and `lib.js` the only one the tests import.

## Delivery order

Each step leaves a working app:

1. **Native feel first (US2)**: `route({soft})`, scroll memory, placeholders, transitions, window settings, context menu. It needs no visual change, so it is easy to verify in isolation. Start with the two checks in [quickstart.md](quickstart.md).
2. **Shell (US1)**: rail, search bar, Ctrl+K, removal of the header and its responsive rules, focus handling.
3. **Layout (US3)**: tokens, whole-card rows, row headings, title page columns, cast row, and a pass over remaining pages.

US1 is listed first in the spec by importance, but US2 goes first here because it carries the two unverified platform facts. If either fails, the design changes before any visual work is built on it.

## Risks

| Risk | Mitigation |
|---|---|
| `navigate` doesn't fire as expected for hash navigation in WebView2 | Checked first; fallback is a `popstate` flag set just before `hashchange` |
| Transition overlay swallows clicks | Checked first; `pointer-events: none` on the overlay |
| A lookalike reads as an official Trakt app, and Trakt can revoke the client ID | Filmie's brand, no logo, Settings sentence kept |
| Empty rows collapsing after placeholders shift the page | Restore scroll after the page's rows settle |
| Website screenshots go stale | None to update: `site/public` has only `og.png`; check whether it shows the old header at release |

## Complexity Tracking

No violations to justify.
