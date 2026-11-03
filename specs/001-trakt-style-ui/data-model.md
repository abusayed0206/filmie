# Data model: Trakt-style, near-native UI

No SQLite, `library.json` or Trakt data changes, and no new Tauri commands. There are two small pieces of client state.

## Rail preference

| | |
|---|---|
| Stored in | `localStorage`, key `rail`, alongside `sources`, `server` and `quality` |
| Values | `'wide'`, or absent or anything else for narrow |
| Default | Narrow |
| Access | Wrapped in `try/catch` like the other preferences. If it can't be read, the rail is narrow; if it can't be written, the choice lasts for this run. |
| Applied as | `body.rail-wide` class |

Transition: the menu button toggles narrow ↔ wide and writes the value.

## Scroll memory

| | |
|---|---|
| Stored in | An in-memory `Map` in `app.js`, gone when the app closes |
| Key | `navigation.currentEntry.key` of the entry being left |
| Value | `scrollY` in pixels |
| Written | In the `navigate` listener, before the page changes |
| Read | By `route()`, only when the navigation type is `traverse` |

Validation: the browser clamps `scrollTo` to the page height, so a page that has shrunk needs no extra handling.

Size: one number per history entry visited in one run, so it needs no eviction.

Rule, as a pure helper in `lib.js`:

```text
scrollTarget(navType, saved) → saved ?? 0 when navType is 'traverse', otherwise 0
```

## Rail destination

Derived from the route with no storage. A pure helper in `lib.js` maps a route's first segment to the rail item it highlights:

| Route segment | Rail item |
|---|---|
| `''` | Home |
| `shows`, `movies`, `settings` | Same name (account item for `settings`) |
| `search` | Search |
| `lists`, `list` | Lists |
| `watchlist` | Watchlist and Lists |
| `title`, `play`, anything else | None |
