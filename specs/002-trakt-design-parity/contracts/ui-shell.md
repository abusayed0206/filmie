# Contract: app shell and shared UI

Design values come from [trakt-design-reference.md](../trakt-design-reference.md). This file covers how the parts fit Filmie's code.

## Routes

| Route | Page | Mode switch | Filters |
|---|---|---|---|
| `#/` | Home | Yes | Yes, global |
| `#/discover` | Discover | Yes | Yes, global |
| `#/discover/{trending,anticipated,popular,recommended}` | Grid | In drawer | Yes |
| `#/discover/releases` | Calendar view | Yes | Yes |
| `#/progress` | Continue Watching grid | Yes | Yes |
| `#/calendar` | Calendar | Yes | Yes |
| `#/lists` | Lists hub | Yes | Global, list rows only |
| `#/lists/{personal,liked,shared}` | Lists by type | Yes | No |
| `#/list/{id}` | List page | Yes | Yes |
| `#/watchlist` | Watchlist | Yes | Yes |
| `#/history` | History | Yes | No |
| `#/library` | Library | Yes | No |
| `#/profile` | Profile and stats | Yes | Yes, global |
| `#/title/{type}/{id}[/{season}]` | Title, unchanged | No | No |
| `#/person/{id}` | Person | No | No |
| `#/search[/{query}]` | Search | Search version | No |
| `#/settings` | Settings, unchanged | No | No |
| `#/play/...` | Player, unchanged | No | No |
| `#/shows`, `#/movies` | Replace with `#/discover` and set the mode | | |

## Page definition

Each page tells the shell what the top bar shows:

```text
pages.x.bar = { title, meta?, back?, mode: 'bar' | 'drawer' | false, filters: 'global' | 'local' | false }
```

`route()` reads this after resolving the page and before running it, so the bar is right from the first frame.

## Top bar

```text
header.topbar
├── .topbar-left    title, meta, optional back, page actions
├── .topbar-center  mode switch
└── .topbar-right   header actions, filter button
```

- Fixed, inset by `--rail`, hidden while playing.
- `body.scrolled` is set by a passive scroll listener and turns on the blur layer.
- Pages must not render their own `<h1>` where the bar shows the title, but they keep one for screen readers through `.sr-only`.

## Mode

```text
getMode() → 'media' | 'show' | 'movie'
setMode(mode)  saves, then route({ soft: true })
forMode(media, show, movie) → the argument for the current mode
```

Media mode adds a type tag to cards.

## Filters

Pure, in `lib.js`, with tests:

```text
FILTERS                       definitions: key, label, group, simple options, advanced control, modes
cleanFilters(obj) → obj       drops unknown keys and invalid values
filterQuery(filters, mode) → query string   skips filters not valid in the mode, expands presets
filterCount(filters, mode) → number         the badge
```

The shell in `controls.js`:

```text
activeFilters() → current set for this page's scope
openFilterDrawer()   applies on close, and only re-renders if something changed
```

## Controls

```text
drawer({ title, width?, body, onClose? }) → dialog   native <dialog>, right edge, stacked ones scale the lower to .95
modal({ title, body, actions }) → dialog
menu(button, items)     popover
segmented(name, options, value, onChange) → HTML
```

Each lives in `controls.js`, and interpolated data must go through `esc()`.

## Rows and cards

```text
renderRows(defs, into)
def = { id, title, meta?, more?, kind: 'portrait' | 'landscape' | 'list', load, actions? }
```

- `id` is stable and keys the collapse state. It replaces the index-based row id.
- Each row loads when near the viewport, using one shared `IntersectionObserver`.
- Empty rows show Trakt's placeholder when they exist to be filled, such as Continue Watching, and are removed otherwise, such as a chart with no data. Failed rows are removed.
- Fewer than 5 items adds a call-to-action card if the row has a `more` link.

Rows with `more` and more than one item have `overflow-x: hidden`, unlocked by a horizontal wheel. Rows without `more` scroll normally. There are no arrows.

```text
posterCard(item, { label, status }) → HTML
episodeCard(item) → HTML
summaryCard(item, { sortValue }) → HTML
listCard(list) → HTML
personCard(person) → HTML
cardMenu(item) → HTML   three-dot, signed in only
```

Card markup never nests a button inside a link. The menu and inline actions are siblings of the card's link, positioned over it.

## Grids

```text
renderGrid(into, { pageSize: 100, load: page => items, card })
```

Loads the next page past 50% scroll or when content doesn't fill the view, shows a spinner, and stops at a short page.

## Keyboard

| Input | Result |
|---|---|
| Ctrl+K | Toggle the command palette, except in the player |
| `/` | Open the palette, outside text fields and the player |
| Escape | Close the top drawer, palette or menu, before leaving fullscreen |
| Arrows, Enter | Move and choose in the palette |

## Kept from feature 001

`route({ soft })`, `skeleton(kind)`, scroll memory, `aria-busy`, focus moving to `main`, and the right-click and text-selection rules.

## Removed from feature 001

The cross-fade and `startViewTransition`, row arrows, the search bar in `index.html` (moved into the search page, using a new input that the router doesn't replace on every query), and hover lift on cards.

## Window

`main.rs` background colour changes to match the new `--bg`. The window's minimum size is unchanged.
