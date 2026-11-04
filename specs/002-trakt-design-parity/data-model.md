# Data model: Trakt design parity with filters

The existing `cache` and `history` tables and `library.json` are unchanged.

## SQLite: `filmie.sqlite3`

### `trakt_history`

One row per play in the person's Trakt history. Deleted on sign-out.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Trakt's history id, so repeated fetches are idempotent |
| `kind` | TEXT NOT NULL | `movie` or `episode` |
| `watched_at` | INTEGER NOT NULL | Unix seconds, indexed |
| `trakt_id` | INTEGER NOT NULL | Movie or show id |
| `tmdb_id` | INTEGER | Null when Trakt has none |
| `title` | TEXT NOT NULL | Movie or show title |
| `season` | INTEGER | Episodes only |
| `episode` | INTEGER | Episodes only |
| `runtime` | INTEGER NOT NULL DEFAULT 0 | Minutes, from `extended=full` |
| `genres` | TEXT NOT NULL DEFAULT '[]' | JSON array |

### `trakt_ratings`

The person's ratings. Replaced whenever `rated_at` moves in `/sync/last_activities`. Deleted on sign-out.

| Column | Type | Notes |
|---|---|---|
| `kind` | TEXT NOT NULL | `movie`, `show`, `season` or `episode` |
| `trakt_id` | INTEGER NOT NULL | |
| `rating` | INTEGER NOT NULL | 1 to 10 |
| `rated_at` | INTEGER NOT NULL | Unix seconds |

Primary key: (`kind`, `trakt_id`).

### `sync_state`

Key and value pairs for local sync. Deleted on sign-out.

| Key | Value |
|---|---|
| `history_complete` | `1` once backfill has reached the end |
| `history_total` | Item count from Trakt's last response, for progress and for detecting removals |
| `activity_watched` | The watched stamps last seen in `/sync/last_activities` |

The oldest and newest stored `watched_at` act as the resume and incremental cursors, so they aren't stored separately.

### State transitions: history sync

```text
empty → backfilling → complete → (activity moved) incremental → complete
                                              └── count differs → empty → backfilling
sign-out → all three tables cleared → empty
```

A restart during `backfilling` resumes from `MIN(watched_at)`. Each page is one transaction, so a closed app can't leave half a page.

### Validation

- A history item without `id`, `watched_at` or a movie or show object is skipped and logged, and the sync continues.
- `rating` outside 1 to 10 is skipped.
- Inserts use `INSERT OR REPLACE`.

## Stats: derived, not stored

Returned by the `stats` command. See [contracts/tauri-commands.md](contracts/tauri-commands.md).

| Field | Source |
|---|---|
| `movies` | Distinct movie plays |
| `shows` | Distinct `trakt_id` where `kind = 'episode'` |
| `episodes` | Episode plays |
| `minutes` | `SUM(runtime)` |
| `top_genres` | Plays per genre, top 10, from `json_each(genres)` |
| `ratings` | Count per value, 1 to 10 |
| `by_month` | Plays per local month |
| `days` | Distinct local dates, newest first, for the streak helper |
| `synced`, `total`, `complete` | History sync progress |

## `localStorage`

Each read and write is wrapped in `try/catch`, like the existing preferences. Anything unreadable falls back to the default.

| Key | Value | Default | Validation |
|---|---|---|---|
| `mode` | `media`, `show` or `movie` | `media` | Anything else is the default |
| `filters` | JSON object of active global filters | `{}` | Unknown keys and values are dropped through `cleanFilters` |
| `filters-default` | JSON object saved by Set as default | `{}` | Same |
| `filters-tab` | `simple` or `advanced` | `simple` | Anything else is the default |
| `rows-collapsed` | JSON array of row ids | `[]` | Non-array is the default |
| `rail` | `wide`, or anything else for narrow | Narrow | Existing |
| `sources`, `server`, `quality` | Existing | Existing | Existing |

Trakt's account data stays out of `localStorage`, so sign-out only needs to touch SQLite and `library.json`. `filters` may hold `ignore_watched`, which is a preference rather than account data.

## In memory

| Name | Holds | Lifetime |
|---|---|---|
| Local filter sets | Filters per non-global route | Until the app closes |
| `savedScroll` | Existing | Existing |
