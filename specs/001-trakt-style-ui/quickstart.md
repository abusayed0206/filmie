# Quickstart: validate the Trakt-style UI

## Prerequisites

- `.env.local` in the repo root (see `CLAUDE.md`).
- Close any running Filmie first, or `cargo build` fails with `Access is denied`.
- A Trakt account for the signed-in checks. A process started from inside the Claude desktop app may use a sandboxed copy of app data, so it may need its own sign-in.

## Automated

From the repo root:

```bash
node --test tests/ui.test.js
```

Expected: all pass, including the new `navFor` and `scrollTarget` tests and the existing check that every icon used exists in the sprite.

From `src-tauri/`:

```bash
cargo fmt --check
```

```bash
cargo clippy --all-targets -- -D warnings
```

```bash
cargo test
```

## Check these two facts first

Before building on them, confirm in the running app from research sections 5 and 6:

1. The `navigate` event fires for hash link clicks and for Back in WebView2, with `navigationType` of `push` and `traverse`.
2. Clicking during the 160 ms cross-fade doesn't lose the click.

## Manual run

From `src-tauri/`:

```bash
cargo run
```

| # | Do | Expect | Covers |
|---|---|---|---|
| 1 | Launch on a light Windows theme | No white flash, dark title bar | US2, FR-013 |
| 2 | Look at any page | Narrow icon rail, no top header | US1, FR-001 |
| 3 | Hover each icon, then Tab through them | Name shows both ways, focus ring visible | FR-004 |
| 4 | Widen the rail, restart | Still wide, rows reflowed | FR-003 |
| 5 | Press Ctrl+K on Home and type a title | Search page, box focused, results as you type; clearing returns Home | FR-005 |
| 6 | Open a list, then the watchlist | Lists highlighted | Data model |
| 7 | Open the player, resize the window, use its menus | No rail; toolbar and video as before | FR-006 |
| 8 | Scroll far down Home, open a title, press Alt+Left | Same position, within 1 px | SC-001 |
| 9 | Do it again with the mouse back button, then click a link back to Home | Mouse back restores; link starts at top | FR-010 |
| 10 | Scroll a title page, press Watchlist (signed in) | No movement, no placeholders, state changes | SC-004 |
| 11 | Clear the cache in Settings, go Home | Placeholders, never "Loading…" | SC-002 |
| 12 | Turn on Windows "Animation effects: off", change pages | No fade, no pulse | SC-006 |
| 13 | Resize from 800 px to maximized with the rail wide and narrow | Only whole cards at rest, at least two per row | SC-005 |
| 14 | Open a title with no providers or cast, then one with both | Layout closes up; wide window shows three columns | FR-018, FR-019 |
| 15 | Right-click empty space, then the search box, then selected overview text | No menu, then a text menu, then a text menu | FR-014 |
| 16 | Go offline, open an uncached page | Existing error text replaces placeholders | Edge cases |
| 17 | Press Mark watched, then check Trakt; open the player and don't press it, then check Trakt | Recorded only for the press | FR-024 |

## Licence and branding check

Run from the repo root, expecting no output:

```bash
git grep -n -i -E "trakt-(side|top)-navbar|trakt-skeleton|svelte" -- ui
```

Then read the diff: no logo files added, `THIRD_PARTY_NOTICES.md` unchanged, and Settings still has the "not endorsed or certified by Trakt" sentence.
