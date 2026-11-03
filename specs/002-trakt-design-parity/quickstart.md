# Quickstart: validate Trakt design parity

## Prerequisites

- `.env.local` in the repo root (see `CLAUDE.md`).
- Close any running Filmie first, or `cargo build` fails with `Access is denied`.
- A free Trakt account with some history, plus a video server added in Settings.
- Run from a terminal outside the Claude app's sandbox, so the app uses real data and sign-in.
- For the side-by-side checks, app.trakt.tv signed in with the same account.

## Automated

From the repo root:

```bash
node --test tests/ui.test.js
```

Expected: all pass, including `filterQuery`, `filterCount`, `cleanFilters`, `streakFrom`, `weekHeatmap`, and the check that every script parses and every icon exists.

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

Expected: all pass, including history paging and resume, count-based reset, `stats` on an in-memory database, sign-out clearing, and the `cache_policy` cases.

## Step 1 probe

Before building on them, call each endpoint in [contracts/api-usage.md](contracts/api-usage.md) with the free account and record the status in `docs/PLAN.md`. Never print the keys.

Check especially:
- `up_next_nitro`
- `statuses` as a filter name
- `extended=colors`
- the watchlist sort path
- the notes routes
- the search empty state
- the `/stats` and `/watching` rows that the classifier flagged

Expected: everything used returns 200 or 204. Replace anything else in the contract before implementing it.

## Manual

From `src-tauri/`:

```bash
cargo run
```

| # | Do | Expect | Covers |
|---|---|---|---|
| 1 | Open Home with a fresh profile | Media selected in a top bar switch | US1, FR-001 |
| 2 | Pick Movies, then Shows | Every row changes type within 1 s on cached data, and the page stays | SC-001 |
| 3 | Restart the app | Mode kept | FR-002 |
| 4 | Open filters, set a genre and a decade, close | Results narrow, badge reads 2, row scroll resets | US1, FR-003 |
| 5 | Set as default, change a filter, press Reset | Returns to the default | FR-004 |
| 6 | Set an Advanced filter, then go to Simple | Asks first, then clears | US1 |
| 7 | Set a filter on Home, go to Discover, then to a list and back | Global filter carries; the list's own filter doesn't leak | FR-005 |
| 8 | Filter to no results | Placeholder, with a way to reset | US1 |
| 9 | Sign out and repeat 2 and 4 | Works, without account-only filters | US1 |
| 10 | Widen the rail, hover profile when narrow | Items and menu as the reference | US2 |
| 11 | Scroll any page | Top bar stays and blurs | US2 |
| 12 | Open `#/movies` | Lands on Discover in Movies | FR-007 |
| 13 | Compare Home, Discover, a title and a grid with Trakt at the same size | Only accent, name, Play and Recently played differ | SC-002 |
| 14 | Collapse a row, restart | Stays collapsed | US3 |
| 15 | Hover a card, open its menu by keyboard | Outline only, menu works | US3, FR-011 |
| 16 | Open a row title, scroll | Grid loads more with a spinner | US4 |
| 17 | Mark watched from Continue Watching | Updates in place | US4 |
| 18 | Open a show, change season, open an episode | Rail opens at next episode, drawer opens, Play works | US5 |
| 19 | Press Escape in a drawer | Closes, focus returns | US5 |
| 20 | Rate with half stars, favourite, add to list | Saved on Trakt | US5 |
| 21 | Open a title with no cast or streaming data | Sections left out, layout closes up | Edge cases |
| 22 | Open a cast member | Person page with movies and shows | US5 |
| 23 | Sort the watchlist | Order changes, sort value on cards | US6 |
| 24 | Remove a History entry | Gone here and on Trakt | US6 |
| 25 | Change calendar view and type | Week and day both work | US6 |
| 26 | Fill a list to its limit, if practical | Limit message | US6 |
| 27 | Ctrl+K, type a title, Enter | Opens by keyboard in under 10 s | SC-005, US7 |
| 28 | Search each of the 5 modes; open a result and go Back | Query and position kept | US7 |
| 29 | Sign in with a long history, close during first sync, reopen | App stays usable, sync resumes | US8 |
| 30 | Compare Profile totals with Trakt | Within 1% | SC-006 |
| 31 | Go offline, open Profile | Stats appear in under 1 s | SC-007 |
| 32 | Remove a play on Trakt's site, then sync | Local totals follow | Edge cases |
| 33 | Sign out, open the database with `sqlite3` | The three new tables are empty, Recently played remains | FR-023 |
| 34 | Browse normally for an hour | No failed page, no 429 in the terminal | SC-008 |
| 35 | Press Mark watched, wait out the runtime without pressing anything else | Only the press was sent, no check-in | FR-026 |
| 36 | Turn on Windows "Animation effects: off" | No slide, pulse or spring | FR-011 |
| 37 | Run the remaining checks in `specs/001-trakt-style-ui/quickstart.md` | Pass, or are replaced by this spec | SC-009 |

## Licence and branding check

Run from the repo root, expecting no output:

```bash
git grep -n -i -E "trakt-(side|top)-navbar|trakt-skeleton|svelte" -- ui
```

Then read the diff: no Trakt logo or asset added, `THIRD_PARTY_NOTICES.md` lists Roboto, and Settings still has the "not endorsed or certified by Trakt" sentence.
