# Contract: new Tauri commands

Added to the handler list in `main.rs`. `capabilities/default.json` is unchanged, since these go through the existing IPC for local pages. Remote pages get no access.

## `history_sync() -> { synced, total, complete }`

Runs one step of local history sync and returns progress. The frontend calls it after `sync`, and again while `complete` is false, at most once a second, so it never runs in a tight loop.

| Situation | One step does |
|---|---|
| Signed out | Returns zeros |
| Not complete | Fetches one page, older than `MIN(watched_at)` |
| Complete, activity unchanged | Nothing, with no request beyond `last_activities` |
| Complete, activity moved | Fetches newer than `MAX(watched_at)`, updates ratings if `rated_at` moved, then compares counts |
| Counts differ after that | Clears `trakt_history` and `sync_state`, so the next step starts over |

Errors return `Err(String)` in the existing format and leave stored data alone. The next call retries.

## `stats() -> Stats`

Reads only local data and makes no network request. It works offline and when signed out, returning zeros.

```text
{
  movies, shows, episodes, minutes,
  top_genres: [{ genre, plays }],
  ratings: [{ rating, count }],
  by_month: [{ month: 'YYYY-MM', plays }],
  days: ['YYYY-MM-DD'],
  synced, total, complete
}
```

## `sign_out` (changed)

Also clears `trakt_history`, `trakt_ratings` and `sync_state`. The `history` table for Recently played stays, as it does today.

## `State::request` (changed)

Add a variant that also returns `X-Pagination-Item-Count`, for detecting removed history. `trakt` keeps its current signature.

## `cache_policy` (changed)

`/calendars/my` and any path containing `ignore_` become user-scoped. New filter drawer lookups (`/genres`, `/countries`, `/languages`, `/certifications`) get a day.

## Frontend helpers, pure, in `lib.js`

```text
streakFrom(days, today) → number      consecutive days ending today or yesterday
weekHeatmap(days, today) → [bool × 7]
```
