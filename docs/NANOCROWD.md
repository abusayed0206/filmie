# Nanocrowd

[Nanocrowd](https://app.nanocrowd.com) groups films and shows by what viewers say about them: weighted mood words ("nanogenres") and a similarity model over those words. Filmie uses it for a title's vibe cloud, its similar titles, its audience rating on cards and title pages, and the Discover → Vibes pages.

> **Verified against the live API on 2026-11-19.** Nanocrowd publishes no documentation or contract, so any of this can change or disappear without notice. Re-probe before relying on a detail that matters.

## Endpoints

The backend is `https://bananastreampie.com`, not `nanocrowd.com`. Every request except token minting carries `Authorization: Bearer <token>` and `Accept: application/json`.

| Endpoint | Returns | Notes |
|---|---|---|
| `GET /api/init/token` | `{ "token": "..." }` | An opaque ~100-character string, not a JWT. No expiry field and no cache headers; the same token came back 13 minutes apart and kept working, so it is long-lived. A bad token gets 401. |
| `GET /api/titlesearch/` | ~32,000 `{ title, ncTitleId }` | The whole catalog, about 1.7 MB. Titles read `"Title (Year)"`, ASCII only (`Amelie (2001)`), with alternative titles as extra entries sharing an id. **`/api/titlesearch/<query>` does not exist**: it answers `{"response":"nope"}` with status 200, as does any unknown path. |
| `GET /api/titles/<ncTitleId>` | a one-element array | `imdbId`, `title`, `releaseYear`, `type` (`"01-Movie"`), `crowdRating` (scale below), `keywords` (15 `{ term, fpm }`), `mostLikeTitles` (80 `{ ncTitleId, title, year, crowdRating }`), `directorList`, `starringActorList`, `mpaa`, `youTubeTrailerId`. |
| `GET /api/fundamentals` | 25 `{ tierKey }` | The genre words. Filmie hardcodes them instead of calling this. |
| `GET /api/tiers/<tierKey>` | a one-element array | `{ tierKey, subtierList: [{ subtier }], titleList }`, up to 1000 titles carrying `imdbId`, `title`, `year`, `type` (`01-Movie`, `13-TVseries`, ...), `crowdRating`, `crowdSize` and `providers`. Only the 25 genres work; any other word, such as a keyword, returns `[]`, and `/api/tiers/<genre>/<subtier>` is `nope`. All 25 together: about 15,300 distinct titles (checked 2026-11-24), roughly 11,400 movies and 2,000 series, fetched in about 5 seconds. |

`{"response":"nope"}` is an error, not an empty result, and Filmie never caches it.

The 25 genres, as `VIBES_GENRES` in `ui/pages-browse.js`:

```
action  adventure  animation  biography  comedy  cops  documentary  drama  fantasy
historical  horror  kids  musical  mystery  quest  relationships  romance
romantic-comedy  sci-fi  sports  spy  superhero  thriller  war  western
```

There is no search by title or mood. Nanocrowd's own web app downloads the catalog and searches it locally, and Filmie does the same.

## What the numbers mean

- **`keywords` / `fpm`** — Frequency Per Million: how often the word appears in verified viewer reviews relative to the general film corpus. It is the weight in the vibe cloud.
- **`mostLikeTitles`** — cosine similarity over the keyword vectors, not shared cast, crew or release metadata.
- **`crowdRating`** — Nanocrowd's own audience score, **0 to 5** (checked 2026-11-24: *Inception* 4.68, *Breaking Bad* 4.95; the highest seen is 5.11, which Filmie caps at 5). Filmie shows it on cards and title pages.
- **`crowdSize`** — 0.1 to 5.1 beside it, apparently a log scale of how many reviews there are. Kept, not shown.
- **`providers`** — streaming availability, from JustWatch.

## How Filmie uses it

`src-tauri/src/nanocrowd.rs` exposes two commands, registered in `main.rs`:

| Command | Arguments | Cached as | For |
|---|---|---|---|
| `nanocrowd_title_info` | `title`, `year`, `imdb_id` | `nanocrowd title <id>`, 30 days | Vibe cloud, similar titles and the title page's rating |
| `nanocrowd_tier` | `genre` | `nanocrowd tier <genre>`, 7 days | The Vibes page |
| `ratings` (in `ratings.rs`) | `items`, `mdblist` | `nanocrowd ratings`, 7 days | Card ratings, and the rating sort and filters |

### Ratings for cards

A page of cards can't afford the catalog lookup per card, so `rating_index` builds an index of every genre list's titles, IMDb id to `[crowdRating, crowdSize]`, and keeps it compactly in the cache table as `nanocrowd ratings` for a week: 25 requests, about once a week, warmed in the background at start-up. It misses some famous films that no list includes (*Inception*, *The Shawshank Redemption*), so a card it misses falls back to the catalog lookup with only the two nearest candidates, three at a time. Those title entries are cached 30 days like any other. A failed index build waits 10 minutes before trying again.

Everything goes through `Db::through()` in `db.rs`, so an expired copy is still served when the network fails.

### Token

Minted at launch by a background task in `main.rs` setup and saved in the cache table under `nanocrowd token` with a 10-year lifetime, because Nanocrowd sends no expiry and hands out the same token for days. Later launches read it from the database with no request. A 401 or 403 drops it — only if no other request has already replaced it — then one new token is fetched under the lock and the request is retried once. Settings → Clear cache removes it, and the next request mints a new one.

### Finding a film's entry

The catalog is downloaded once, cached 30 days under `nanocrowd catalog`, and indexed in memory for the run. `catalog_ids` matches a TMDB title against it:

- Both sides are normalized to lowercase letters and digits, single-spaced, with a leading "the", "a" or "an" dropped, so "The Godfather: Part II" and "The Godfather Part II" agree.
- The part before a subtitle counts too (`:`, an en dash, or ` - `), because the two catalogs disagree about subtitles.
- Years may be up to 3 apart, nearest first: Nanocrowd often uses a later country's release year.
- The six nearest candidates are fetched and the IMDb id decides which one it is, so the loose title match cannot attach the wrong film.

Measured on 116 popular and top-rated TMDB movies: every miss from before 2025 was a film Nanocrowd does not have. **The catalog stops at 2024**, so newer titles have no vibes or rating. It holds movies and TV series ("Breaking Bad (2008)").

### In the UI

- **Title page** (`ui/pages-title.js`), for movies and shows: `vibeCloud` draws the first 20 keywords as a circular word cloud, sized by `fpm` and laid out by `cloudLayout` in `lib.js`. Keywords that are genres link to the Vibes page; the rest are plain text. "More like this" merges the first 20 `mostLikeTitles` (matched to TMDB by title and year, as movies or shows like the page's title) with Trakt's Related, alternating and keeping each title once, and each card names its source. The ratings strip shows `crowdRating`.
- **Cards:** the rating from the index, by default. Settings → Ratings can pick another source.
- **Vibes** (`ui/pages-browse.js`, `#/discover/vibes/<genre>`): the 25 genres as pills, the genre's mood words from `subtierList`, and its films resolved to TMDB through `/find/<imdbId>`, 40 at a time. When signed in, "Hide watched" filters against the Trakt library mirror. It lists movies only, so the page has no media switch and takes no Trakt filters.

## Not used

- `/api/streams/<imdbId>` — JustWatch availability with deep links. Reported by the 2026-11-19 probe, not called by Filmie.
- Shows on the Vibes page, which lists movies only by the owner's decision, though the genre lists hold shows too.
