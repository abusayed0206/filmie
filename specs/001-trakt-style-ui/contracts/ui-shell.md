# UI contract: app shell

What the shell promises the person using the app and the rest of `ui/`. Filmie exposes no external API, and its Tauri commands, routes, CSP and capabilities do not change.

## Routes

Unchanged, plus one empty state:

| Route | Behaviour |
|---|---|
| `#/search` | Search page with the box focused and no results yet. New: today this renders "Results for ''". |
| All others | As today |

## Keyboard and pointer

| Input | Result | Where |
|---|---|---|
| Ctrl+K | Go to `#/search` and focus the box | Everywhere except the player |
| Alt+Left, Alt+Right, mouse back and forward | History traversal, with scroll restored | Everywhere |
| F11, Esc | As today | Everywhere |
| Tab | Rail first, then main content; focus moves to `main` after a page change | Everywhere |
| Right-click | No menu, except on text fields and selected text | App pages only; the video frame is third-party |

## Rail markup

`index.html` replaces `<header id="top">` with:

```text
nav.rail[aria-label="Main"]
├── button#rail-toggle        aria-expanded, aria-label "Expand/Collapse navigation"
├── a.logo                    Filmie's mark; full name when wide
├── a[data-nav] × 5           Search, Home, Shows, Movies, Lists
│   ├── svg.i
│   └── span.nav-label        visually hidden when narrow, so the name stays accessible
├── a.nav-sub[data-nav]       Watchlist; only shown when wide
└── .rail-bottom
    ├── button.fs-btn         existing fullscreen handler
    └── a#account[data-nav="settings"]
```

- `.active` and `aria-current="page"` are set from `navFor(page)`.
- Narrow rail items show their name via a CSS tooltip on `:hover` and `:focus-visible`.
- `#q` moves to `div.searchbar`, shown only on the search page.
- `refreshUser` writes the label inside `.nav-label`, so the signed-out text doesn't overflow the narrow rail.

## CSS tokens

New or changed in `:root`, consumed by the rest of `style.css`:

| Token | Value | Use |
|---|---|---|
| `--rail` | `72px` narrow, `204px` wide (rail width + margins) | `main` left margin; changes via `body.rail-wide` |
| `--gutter` | `24px` | Page side padding |
| `--radius` | `12px` | Cards |
| `--gap` | `12px` | Row card gap |
| `--n` | Set per `@container` step | Cards per row |

`--accent`, `--bg` and the rest of the palette stay as they are (FR-021).

## `route()`

```text
route({ soft: false } = {})
```

| Mode | Placeholder | Cross-fade | Scroll | Focus to `main` |
|---|---|---|---|---|
| Normal | Yes | Yes, except to or from `play` | Restored on traversal, otherwise top | Yes |
| `soft` | No | No | Unchanged | No |

Callers using `soft`: title page watchlist and watched buttons, and `syncInBackground`, which skips Settings so a half-typed server isn't lost. The server card in Settings redraws itself without `route()`.

`routeToken` keeps its role of dropping results from pages already left.

## Placeholders

```text
skeleton(kind) → HTML string, aria-hidden, no data interpolated
kind: 'rows' | 'title' | 'grid'
```

| Pages | Kind |
|---|---|
| home, shows, movies | `rows` |
| title | `title` |
| lists, watchlist, list, search | `grid` |
| settings, play | None; they render immediately or have their own layout |

`renderRows` shows each section with placeholder cards straight away instead of `hidden`, and removes the section if it comes back empty or fails.

## Window

`main.rs` sets the background colour to `--bg` (`#0f1014`) and the theme to dark. `min_inner_size` stays 800×500. On-navigation and new-window rules are untouched.
