# Ratings & Ranking Sources — Research

> Researched 2026-11-24. Verify any endpoint or policy before implementing.

> **Built 2026-11-24** with Nanocrowd (always on) and MDBList (with the person's own key). What was built, and what live checks corrected below, is in [PLAN.md §5](PLAN.md#5-ratings-and-links). Corrections: Nanocrowd's `crowdRating` is on a 0 to 5 scale, not 0 to 100 (§7), and MDBList calls RT's audience score `popcorn` and gives Letterboxd out of 10 in batch answers (§8).

This document records what each source offers, how their scores work, and what implementation would look like.

---

## 1. TMDB — `vote_average` and `popularity`

### What they are

| Field | Type | Description |
|---|---|---|
| `vote_average` | float (0–10) | Arithmetic mean of all TMDB user votes for this title. |
| `vote_count` | integer | Number of votes cast. Low counts mean the average is noisy. |
| `popularity` | float | A proprietary daily-decay score (see below). |

### How `vote_average` works
TMDB accepts votes from registered users (1–10). The average is a plain mean, not Bayesian-adjusted, so a title with two 10/10 votes shows as 10.0. `vote_count` is the only noise indicator you get — a threshold of around 100–200 votes is common before showing the score.

### How `popularity` works
Popularity is recalculated daily by TMDB. Per the official [Popularity & Trending page](https://developer.themoviedb.org/docs/popularity-and-trending), the score is a "lifetime" score influenced by:
- Number of votes for the day
- Number of views on the title's TMDB page
- Number of users who marked it as a "favourite" or added it to a list
- The previous day's score, decayed

A separate **trending** score uses a much shorter window (daily or weekly) to surface newly popular content. Trending is not the same as popularity.

### Where the fields appear

Every movie and TV details response (`/3/movie/{id}`, `/3/tv/{id}`) returns all three fields. The Discover endpoint (`/3/discover/movie`) supports `sort_by=vote_average.desc`, `vote_average.gte`, and `vote_count.gte` for filtering well-rated titles.

### Source
- Official reference: [developer.themoviedb.org](https://developer.themoviedb.org/reference/movie-details)
- Popularity algorithm overview: [developer.themoviedb.org/docs/popularity-and-trending](https://developer.themoviedb.org/docs/popularity-and-trending)

### Implementation notes
Already fetched. `vote_average` and `vote_count` arrive in the existing `/movie/{id}` and `/tv/{id}` responses with no extra API call. Displaying it only requires reading the field and skipping display below a vote-count threshold. No new Rust command needed.

---

## 2. Trakt — Community Ratings

### What they are
Trakt has two distinct rating concepts:

| Concept | Endpoint | Description |
|---|---|---|
| **Community rating** | `GET /{type}s/{id}/ratings` | Aggregate of all Trakt users' votes, 1–10 scale. |
| **My rating** | local sync mirror (`ratings_movies`, `ratings_shows`) | The signed-in user's own rating, already in `lib.json`. |

### Community rating response shape
```json
{
  "rating": 8.4,
  "votes": 51232,
  "distribution": {
    "1": 125,
    "2": 89,
    "3": 211,
    ...
    "10": 9821
  }
}
```
The `distribution` object has 10 keys (1–10), each giving how many users gave that score. The main `rating` field is 0–10.

**Note:** Trakt's UI displays this as a 0–100% score (multiply by 10), but the API returns 0–10. The filter parameter `ratings` on Discover endpoints is 0–100.

### Where to find the endpoint in the contracts
`/{type}s/{id}/ratings` — documented in [github.com/trakt/trakt-api](https://github.com/trakt/trakt-api), confirmed working in the 2026-11-03 probe (`extended=all` variant also confirmed free and working).

### Rate limit
500 GET per 5 minutes. One call per title page, cached with the existing TMDB response cache.

### My rating
Already available without any new endpoint: `myRating(tt, id)` in `core.js:176` reads from the library mirror. Filmie removed the rating UI (rate button), so this field is display-only if shown.

### Source
- Contract: [github.com/trakt/trakt-api](https://github.com/trakt/trakt-api/blob/main/projects/api/src/contracts)
- Probe results: `docs/PLAN.md` §4 (confirmed `/{type}/{id}/ratings?extended=all` free and working)

### Implementation notes
One new Tauri command wrapping `GET /movies/{id}/ratings` or `/shows/{id}/ratings` (Trakt ID from the library sync, or TMDB ID via `/search/tmdb/{id}?type=movie|show`). Cache alongside the TMDB response. The owner's current decision removed this — confirm before adding.

---

## 3. IMDb — Weighted Average

### What it is
IMDb's user rating is the most recognized score worldwide. It is a **weighted average** (not a plain mean) on a 1–10 scale, recalculated multiple times per day.

### How it works
- Every registered IMDb user can vote 1–10.
- IMDb applies secret weighting — votes from "regular" voters are weighted more than casual ones, to resist ballot-stuffing.
- The raw arithmetic mean and vote distribution are shown on the detailed breakdown page, but the displayed rating is the weighted version.
- The original formula was a credibility/Bayesian shrinkage formula (shrinks scores with few votes toward the global mean), but the current exact formula is not published.
- A TV series rating is independent of its episode ratings; they are calculated separately.
- **Top 250** uses a stricter formula (minimum votes threshold, only regular voters counted).

### How to get it in Filmie
IMDb does not offer a public API. The practical route is **OMDb**, which mirrors IMDb data:

#### OMDb API
- Base URL: `https://www.omdbapi.com/`
- Auth: free API key from [omdbapi.com](https://www.omdbapi.com/apikey.aspx), limit **1,000 requests/day**; paid tier removes the cap.
- Lookup by IMDb ID: `?apikey=KEY&i=tt1234567`

Response fields relevant to ratings:
```json
{
  "imdbRating": "8.4",
  "imdbVotes": "2,345,678",
  "Metascore": "74",
  "Ratings": [
    { "Source": "Internet Movie Database", "Value": "8.4/10" },
    { "Source": "Rotten Tomatoes",         "Value": "92%" },
    { "Source": "Metacritic",              "Value": "74/100" }
  ]
}
```
All values are **strings** — parse them as numbers before use. `imdbRating` and `Metascore` are also top-level fields alongside the `Ratings` array.

**TV shows:** Rotten Tomatoes and Metacritic data may not appear for TV shows in some OMDb responses (confirmed limitation from GitHub issues; verify before relying on it).

**IMDb ID source:** Already present in TMDB's `external_ids.imdb_id` field (returned when `external_ids` is appended to the details request, which Filmie already does).

### Source
- OMDb API: [omdbapi.com](https://www.omdbapi.com/)
- IMDb rating FAQ: [help.imdb.com — Weighted Average Ratings](https://help.imdb.com/article/imdb/track-movies-tv/weighted-average-ratings/GWT2DSBYVT2F25SK)
- IMDb rating FAQ: [help.imdb.com — FAQ for IMDb Ratings](https://help.imdb.com/article/imdb/track-movies-tv/faq-for-imdb-ratings/G67Y87TFYYP6TWAV)

### Implementation notes
`docs/PLAN.md` §5 already documents the OMDb integration plan. Filmie's `§8 Decisions` says "No OMDb until a key is added." A key needs to be added to `.env.local` and embedded in `build.rs`. Results should be cached in SQLite (1 day TTL is reasonable; OMDb data changes infrequently). The IMDb ID is already available from the TMDB response.

---

## 4. Rotten Tomatoes — Tomatometer & Popcornmeter

### What they are
RT has two distinct scores that measure different things:

| Score | What it measures |
|---|---|
| **Tomatometer** | % of approved critic reviews that are "Fresh" (positive) |
| **Audience Score / Popcornmeter** | % of audience ratings that are positive (3.5+ out of 5) |

### How Tomatometer works
- Only reviews from RT-approved critics count.
- Each review is classified as Fresh (positive) or Rotten (negative) based on a star rating or tone judgment by RT editors.
- The score is the percentage of Fresh reviews, **not** an average of the star ratings.
- Threshold: ≥60% = Fresh (green tomato), <60% = Rotten (splat).
- A "Certified Fresh" badge requires ≥75% with a minimum number of reviews.
- RT removed the 0–10 average in April 2025, then restored it in 2026 as "Average of Rated Reviews" alongside the percentage.

### How Audience Score works
- Any user who creates a free RT account can rate.
- Since 2019, RT moved toward "Verified Ratings" for new titles, requiring proof of purchase (ticket).
- Rating scale is 0–5 stars; ≥3.5 = positive.
- The score is the percentage of positive ratings, not an average.

### Where to get it
- **No public RT API.** RT shut down its public API around 2011.
- **Via OMDb:** The `Ratings` array includes a Rotten Tomatoes entry (percentage) when available. The older `tomatoMeter` top-level field is deprecated and returns N/A.
- **RT URL pattern:** `rottentomatoes.com/m/{slug}` for movies and `rottentomatoes.com/tv/{slug}` for shows. Slugs are not easily derivable from TMDB data — Wikidata property P1258 holds the canonical RT slug.

### Source
- Tomatometer methodology: [rottentomatoes.com/about](https://www.rottentomatoes.com/about)
- Rotten Tomatoes FAQ: [rottentomatoes.com/faq](https://www.rottentomatoes.com/faq)

### Implementation notes
OMDb is the practical source. See §3 above. For the RT URL, `docs/PLAN.md` §5 describes using Wikidata property P1258 to get the canonical slug; the current code uses a search URL as fallback. No separate API call needed if OMDb is already integrated.

---

## 5. Metacritic — Metascore

### What it is
Metascore is a **weighted average of approved critic scores**, normalized to 0–100.

### How it works
- Metacritic staff collect numeric scores from an approved list of publications.
- Each score is converted to a 0–100 scale.
- Metacritic assigns secret weights to each publication — high-prestige outlets count up to 6× more than lower-weight ones.
- For movies and music, the weighted average is additionally **normalized** before display, so the displayed Metascore may differ from the raw weighted average.
- Minimum threshold: **4 critic reviews** before a score appears (shows "tbd" until then).
- User scores are calculated separately and never enter the Metascore.

### Score ranges and color coding
| Range | Color | Meaning |
|---|---|---|
| 61–100 | Green (Universal Acclaim / Generally Favorable) | |
| 40–60 | Yellow (Mixed or Average) | |
| 0–39 | Red (Generally Unfavorable / Overwhelming Dislike) | |

### Where to get it
- **Via OMDb:** `Metascore` field (top-level string, 0–100) and an entry in the `Ratings` array.
- **Via Metacritic:** No public API. The website blocks automated access.
- **Metacritic URL:** `metacritic.com/movie/{slug}` or `/tv/{slug}`. Wikidata property P1712 holds the canonical slug.

### Source
- Metacritic methodology: [legacy.prod.metacritic.com/about-metascores](https://legacy.prod.metacritic.com/about-metascores)
- Metacritic help: [metacritichelp.zendesk.com — Why does the term weighted average matter](https://metacritichelp.zendesk.com/hc/en-us/articles/15456539457175)
- Metacritic help: [metacritichelp.zendesk.com — Can you tell me how each of the different critics are weighted in your formula](https://metacritichelp.zendesk.com/hc/en-us/articles/14482824029079)

### Implementation notes
Same as OMDb (§3). The Metascore arrives in the same OMDb response with no extra call.

---

## 6. Letterboxd — Community Average

### What it is
Letterboxd lets users rate films 0.5–5.0 stars (in 0.5 steps). The site shows the average and a histogram.

### Access situation
- **No public API.** Letterboxd's official API is [invite-only](https://letterboxd.com/api-beta/), granted case-by-case by emailing Letterboxd.
- **Terms (updated December 2025) prohibit scraping** — automated tools, spiders, and scrapers are explicitly barred.
- Link-only is the safest approach: `letterboxd.com/tmdb/{tmdb_id}` redirects to the film's page. `docs/PLAN.md` §5 already records this decision.

### Source
- API page: [letterboxd.com/api-beta](https://letterboxd.com/api-beta/)
- Terms: [letterboxd.com/terms](https://letterboxd.com/terms)

### Implementation notes
Keep as link-only. Do not scrape. If a rating is wanted, apply for official API access via email.

---

## 7. Nanocrowd — `crowdRating`

### What it is
Nanocrowd returns a `crowdRating` (0–100 integer scale) alongside each title's keyword/vibe data. It appears on individual title objects and in `mostLikeTitles` entries.

### How it works
The score is undocumented — the API is undocumented in general. It appears to be an audience satisfaction score computed from the same viewer review corpus that generates the nanogenre keywords. The catalog ends at 2024, so newer titles have no score.

**Checked live 2026-11-24: the scale is 0 to 5, not 0 to 100.** *Inception* 4.68, *Breaking Bad* 4.95, *Interstellar* 4.00, *The Dark Knight* 4.87. Across two genre lists (2,000 titles) the 10th, 50th and 90th percentiles were 1.48, 2.98 and 3.91, and the top was 5.11, so Filmie caps it at 5. A `crowdSize` field (0.1 to 5.1) sits beside it and looks like a log scale of how many reviews there are. The earlier 0-100 figures were wrong.

### Where the field appears
- `GET /api/titles/{ncTitleId}` → `[{ crowdRating, ... }]`
- `GET /api/tiers/{genre}` → title list items include `crowdRating` and `crowdSize`. The lists hold TV series as well as movies: the 25 together cover about 15,300 titles, 11,400 of them movies, 2,000 series.
- `mostLikeTitles` entries include `crowdRating`

### Source
- `docs/NANOCROWD.md` (internally documented from live API probing, 2026-11-19)
- Live API: `bananastreampie.com` (undocumented, may change)

### Implementation notes
Already fetched as part of the Nanocrowd integration (`nanocrowd.rs`). Displaying it requires no new API calls — read it from the response Filmie already caches. It could be shown alongside other scores, labeled "Nanocrowd" or "Vibe Score," but the undocumented nature means it may change or disappear.

---

## 8. MDBList — Aggregated Ratings from All Sources

### What it is
MDBList is a list-management and ratings aggregation service. Its public API is the **single most practical source** for getting all major scores (IMDb, RT Tomatometer, RT Audience, Metacritic, Letterboxd, Trakt, TMDB, MyAnimeList, Roger Ebert) in one call. It also publishes its own aggregated `score` (0–100).

**Base URL:** `https://api.mdblist.com`  
**OpenAPI spec:** `https://api.mdblist.com/schema/?format=json`  
**Docs:** `https://api.mdblist.com/docs/`  
**Auth page:** `https://api.mdblist.com/docs/authentication/`

### Rate limits
| Tier | Daily limit | 5-min reads | 5-min writes |
|---|---|---|---|
| Free | 1,000 req/day | 1,000 | 300 |
| Supporter (paid) | Higher (see `/user`) | 1,000 | 300 |

Limits reset at 00:00 UTC. Responses include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`. On 429 respond with `Retry-After`.

### Authentication
Four methods — Device Code is the best fit for Filmie:
| Method | Best for |
|---|---|
| **API key** (`?apikey=KEY`) | Personal scripts, testing |
| **Device Code** (OAuth) | TVs, CLIs, desktop apps — no redirect URI needed |
| **Public PKCE** | Desktop/mobile apps that need user sign-in |
| OAuth 2.0 | Server-side apps with a client secret |

**Device Code flow** (identical pattern to Trakt's):
1. `POST /oauth/device-authorization/` with `client_id` → get `device_code`, `user_code`, `verification_uri`, `interval`
2. Show code, open `verification_uri_complete` in browser
3. Poll `POST /oauth/token/` every `interval` seconds
4. Store `access_token` (expires 30 days) + `refresh_token`
5. Use `Authorization: Bearer <token>` on all requests

Refresh: `POST /oauth/token/` with `grant_type=refresh_token` and `refresh_token`.

Register an app at `mdblist.com/developer`. An API key (no user auth) is enough for read-only ratings — register at `mdblist.com/preferences/#api`.

### Ratings coverage
The API aggregates these sources in one response:

| Source key | What it represents | Range |
|---|---|---|
| `imdb` | IMDb weighted user average | 0–10 |
| `tmdb` | TMDB user vote average | 0–10 |
| `trakt` | Trakt community rating | 0–10 |
| `metacritic` | Metacritic Metascore (critic weighted avg) | 0–100 |
| `tomatoes` | Rotten Tomatoes Tomatometer (% Fresh critics) | 0–100 |
| `audience` / `popcorn` | RT Audience Score / Popcornmeter | 0–100 |
| `letterboxd` | Letterboxd average stars, normalized | 0–10 |
| `rogerebert` | Roger Ebert / RogerEbert.com star average | 0–4 |
| `myanimelist` / `mal` | MyAnimeList score (anime only) | 0–10 |
| `score` | **MDBList's own weighted aggregate** | 0–100 |
| `score_average` | Unweighted average of all available source scores | 0–100 |

### Key endpoints

#### 1. Single-title lookup with all ratings
```
GET /{provider}/{type}/{id}/
```
- `provider`: `imdb`, `tmdb`, `trakt`, `tvdb`, `mal`, `mdblist`
- `type`: `movie`, `show`, `any`
- Returns: `id`, `imdb_id`, `title`, `year`, `type`, `score`, `ratings[]`, `streams[]`
- The `ratings` array holds one object per source with `source`, `score`, `votes` (shape not fully typed in OpenAPI, verify live)
- `append_to_response`: `review`, `keyword`, `extra`, `recommendations`, `releases`, `episode_ratings`

Example using TMDB ID:
```
GET /tmdb/movie/278/?apikey=KEY   ← The Shawshank Redemption
```

#### 2. Batch rating lookup (read-only, counts as read)
```
POST /rating/{media_type}/{return_rating}
```
- `return_rating` enum: `imdb`, `tmdb`, `trakt`, `metacritic`, `tomatoes`, `audience`, `letterboxd`, `mal`, `rogerebert`, `score`, `score_average`
- Request body: `{ ids: ["278", "238"], provider: "tmdb" }`
- Limits: **10 IDs per request (free), 100 (Supporter)**
- Returns: array of `{ provider_id, provider_rating, mediatype, ratings[] }`

This is useful for **card-level rating badges** without loading a full title object per card.

#### 3. Catalog with ratings
```
GET /catalog/movie?append_to_response=ratings
GET /catalog/movie?append_to_response=ratings_all
```
- `ratings`: imdb, tmdb, mdblist scores only
- `ratings_all`: **every source** including tomatoes, popcorn, metacritic, trakt, letterboxd
- `score_min` / `score_max`: filter by MDBList score (0–100)
- Sort options: `score`, `score_average`, `imdbrating`, `imdbvotes`, `metacritic`, `rtomatoes`, `rtaudience`, `letterrating`, `rogerebert`, `myanimelist`, `tmdbpopular`

### ID cross-reference
Every MDBList media object includes a cross-provider ID block:
```json
"ids": {
  "imdb": "tt0111161",
  "tmdb": 278,
  "trakt": 389,
  "tvdb": 832,
  "mal": 999,
  "mdblist": "a0"
}
```
Lookup by any of these IDs, so the TMDB ID Filmie already has is enough.

### MDBList `score` vs `score_average`
- **`score`** (0–100): MDBList's weighted aggregate, formula not published. It likely weights IMDb and RT Tomatometer more heavily. This is what the catalog sorts by default.
- **`score_average`** (0–100): simple unweighted mean of all sources that have data, normalized to 0–100. More transparent but less curated.

### Source
- API landing page: [api.mdblist.com](https://api.mdblist.com/)
- Interactive docs: [api.mdblist.com/docs](https://api.mdblist.com/docs/)
- Authentication guide: [api.mdblist.com/docs/authentication](https://api.mdblist.com/docs/authentication/)
- OpenAPI spec (live): [api.mdblist.com/schema/?format=json](https://api.mdblist.com/schema/?format=json)

### Implementation notes
MDBList can **replace OMDb** as the ratings source, with broader coverage (adds Letterboxd, Roger Ebert, Trakt, MAL, RT Audience) and batch support. The tradeoff is that OMDb's free limit is also 1,000/day — both are equally constrained on the free tier.

For Filmie the simplest integration is:
1. Register an API key at `mdblist.com/preferences/#api` — no user auth needed for reading ratings.
2. Add `MDBLIST` to `.env.local` and `build.rs`.
3. New Tauri command `mdblist_ratings(tmdb_id, media_type)` → calls `GET /tmdb/{type}/{id}/` and returns the `ratings` array + `score`.
4. Cache in SQLite for 1 day (ratings change slowly).
5. Display on the title page with per-source labels.

For signed-in users, Device Code OAuth unlocks user-specific features (watchlist sync, scrobble, ratings sync) — Filmie's Trakt integration already covers those features, so for ratings only the API key path is enough.

---

## 9. Summary Table

| Source | Score type | Range | Method | API access | In Filmie already? |
|---|---|---|---|---|---|
| TMDB | User average | 0–10 | Plain mean | Free, in every details response | Yes (field fetched, not displayed) |
| TMDB | Popularity | float | Proprietary daily decay | Free, in every details response | Yes (not displayed) |
| Trakt | Community rating | 0–10 (shown as 0–100%) | Aggregate user votes | Free, `/{type}s/{id}/ratings` | Endpoint not called |
| Trakt | My rating | 1–10 | Your own vote | In library sync mirror | Yes (`myRating()` in core.js) |
| IMDb | Weighted average | 0–10 | Secret-weighted user votes | Via OMDb or MDBList (1,000 req/day free) | Planned but no key yet |
| Rotten Tomatoes | Tomatometer | 0–100% | % of Fresh critic reviews | Via OMDb or MDBList | Planned but no key yet |
| Rotten Tomatoes | Audience Score | 0–100% | % of positive audience ratings | Via MDBList (`audience`) | No |
| Metacritic | Metascore | 0–100 | Weighted critic average | Via OMDb or MDBList | Planned but no key yet |
| Letterboxd | Average stars | 0.5–5.0 | Plain mean | Via MDBList (`letterboxd`); link-only otherwise | Link in Details drawer |
| Roger Ebert | Star average | 0–4 | Critic star rating | Via MDBList (`rogerebert`) | No |
| MyAnimeList | Score | 0–10 | Community average (anime) | Via MDBList (`mal`) | No |
| MDBList | Aggregate score | 0–100 | Weighted multi-source formula | Free API key, 1,000 req/day | No |
| Nanocrowd | Crowd rating | 0–100 | Undocumented viewer corpus | Already fetched by nanocrowd.rs | Fetched, not displayed |

---

## 10. Combining Scores — Policy Notes

Trakt's API use policy (confirmed 2026-10-20) says:
> Combining Trakt scores with scores from other sources is allowed **only if the combined result is labeled as your own combined score and names the sources**.

IMDb and OMDb have no such restriction, but IMDb's brand guidelines require accurate attribution (do not say something "has an IMDb rating" — that phrasing is a trademark).

A simple display showing each source separately with its logo/name avoids all policy issues.

---

## 11. What to Implement Next

Listed in order of decreasing bang-for-buck:

1. **Display `vote_average` from TMDB** — zero API cost, field already in the response. Add a threshold (e.g. `vote_count >= 100`) before showing it. Show as `8.4 / 10` or convert to 0–100%.

2. **Add a MDBList API key** — single key unlocks all major scores (IMDb, RT Tomatometer + Audience, Metacritic, Letterboxd, Trakt, Roger Ebert, MDBList Score) in one API call. Strictly better than OMDb alone for coverage. Register a free key at `mdblist.com/preferences/#api`, add `MDBLIST` to `.env.local` and `build.rs`, write `mdblist.rs`. The TMDB ID Filmie already has is enough for lookup. Cache for 1 day.

3. **Add an OMDb key as fallback** — still useful if MDBList is down or the daily limit is hit; covers the same IMDb/RT/Metacritic data. The two keys together give a fallback path.

4. **Display Nanocrowd `crowdRating`** — zero cost, already fetched. Show it on title pages that have Nanocrowd data. Caveat: undocumented, may change.

5. **Display Trakt community rating** — requires one new `GET /{type}s/{id}/ratings` call per title page, cached. Use the Trakt ID from the library sync. No new auth needed. (MDBList also returns the Trakt rating in its response, so this call may become redundant once MDBList is integrated.)

6. **My Trakt rating** — already available from `myRating()` in `core.js`. Display-only since the rating UI was removed.

The owner's current decision (§8 of `docs/PLAN.md`) removed all external ratings from title pages. Revisit that decision before implementing any of the above.
