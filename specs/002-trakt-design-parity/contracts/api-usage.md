# Contract: Trakt endpoints per page

Every endpoint here has no VIP Only or Limited Access tag in trakt-api `090d333`. "Auth" means it needs a signed-in person. "F" means it takes filters. Mode columns give the endpoint per mode.

Probed on 2026-11-03 with a real account that made 156 read-only requests, then a follow-up. Paths marked "No sign-in" returned 200 without a token. The results are summarised in `docs/PLAN.md`. Exceptions and things to re-check while building are noted in place.

## Home

| Row | Media | Shows | Movies | Auth | F |
|---|---|---|---|---|---|
| Continue Watching | Both, merged by date | `/sync/progress/up_next_nitro` | `/sync/playback/movies` | Yes | |
| Start Watching | `/sync/watchlist/movie,show/released/asc` | `/sync/watchlist/shows/released/asc` | `/sync/watchlist/movies/released/asc` | Yes | Unclear |
| Calendar | `/calendars/my/media/{date}/14` | `/calendars/my/shows/...` | `/calendars/my/movies/...` | Yes | ✓ |
| Recommended | `/media/recommendations` | `/recommendations/shows` | `/recommendations/movies` | Yes | No |
| History | `/sync/history` | `.../episodes` | `.../movies` | Yes | |
| Recently played | Local, `history_list` | Same | Same | No | |

- **Recommended:** the probe sent genre and year filters and got identical results, so filters don't apply. Recommended ignores the filter set on Home, and the button is disabled on its grid. `/media/recommendations` returned 200, so Media needs no merging.
- **Start Watching:** with `genres=action`, the total stayed at 18 but the results differed, so this is unclear. Check while building T031 by comparing returned genres. If filters don't apply, ignore them on this row.
- **Calendars:** these ignore `limit`, and `/calendars/all/media/{date}/30` returned 1,182 items, so slice to 10 for a row.
- **Continue Watching:** `/sync/progress/up_next_nitro` returned 200 with the same shape as `/sync/progress/up_next`.

## Discover

| Row and grid | Media | Shows | Movies | Auth | F |
|---|---|---|---|---|---|
| Trending | `/media/trending` | `/shows/trending` | `/movies/trending` | No | ✓ |
| Releases | `/calendars/all/media/{date}/30` | `/calendars/all/shows/...` | `/calendars/all/movies/...` | No | ✓ |
| Anticipated | `/media/anticipated` | `/shows/anticipated` | `/movies/anticipated` | No | ✓ |
| Popular | `/media/popular` | `/shows/popular` | `/movies/popular` | No | ✓ |
| Recommended grid | `/media/recommendations` | `/recommendations/shows` | `/recommendations/movies` | Yes | No |

**More free charts**, offered as extra rows at the bottom of Discover under FR-016: `/{movies,shows}/watched/{period}`, `/played/{period}`, `/collected/{period}`, `/favorited/{period}`, `/movies/boxoffice` and `/shows/hot`. These have no Media endpoint, so in Media mode they show movies and shows as two rows.

**Removed by the probe:** `/movies/hot` and `/{movies,shows}/streaming/{period}` returned 404 for every period tried.

## Title page

| Section | Endpoint | Auth |
|---|---|---|
| Details and colour | `/{movies,shows}/{id}?extended=full,colors` | No |
| Seasons and episodes | `/shows/{id}/seasons`, TMDB season for stills | No |
| Episode drawer | `/shows/{id}/seasons/{s}/episodes/{e}` | No |
| Next and last episode | `/shows/{id}/next_episode`, `/last_episode` | No |
| Sentiment | `/{type}/{id}/sentiments` | No |
| Comments | `/{type}/{id}/comments/{sort}`, read-only | Optional |
| Videos | `/{type}/{id}/videos` | No |
| Related | `/{type}/{id}/related` | No |
| Lists | `/{type}/{id}/lists/{type}/{sort}` | No |
| Details drawer | `/stats`, `/studios`, `/aliases`, `/translations`, `/releases/{country}` | No |
| Watching now | `/{type}/{id}/watching` | No |
| Progress | `/shows/{id}/progress/watched` | Yes |
| Cast | TMDB `credits`, unchanged, then `/search/tmdb/{id}?type=person` to open a person | No |

**Actions:**

| Action | Endpoint |
|---|---|
| Mark watched and undo | `POST /sync/history`, `/sync/history/remove` |
| Watchlist | `POST /sync/watchlist`, `/remove` |
| Rate | `POST /sync/ratings`, `/remove` |
| Favourite | `POST /sync/favorites`, `/remove` |
| Add to list | `POST /users/me/lists/{id}/items`, `/items/remove` |
| Collection | `POST /sync/collection`, `/remove` |
| Drop or hide | `POST /users/hidden/{section}`, `/remove` |
| Notes | Read with `/users/me/notes/all`, which returned 200. Write routes were not probed, so confirm them against the contract when building |

**Not used:** `/{type}/{id}/watchnow/*` (Limited), `/shows/{id}/progress/watched/reset` (VIP Only), `/checkin`, `/scrobble`.

## Person page

`/people/{id}`, `/people/{id}/movies`, `/people/{id}/shows`, `/people/{id}/lists/{type}/{sort}`, plus TMDB for the photo.

## My pages

| Page | Endpoint | Auth |
|---|---|---|
| Continue Watching grid | As Home | Yes |
| Progress | `/sync/progress/watched`, `/users/hidden/dropped` | Yes |
| Watchlist | `/sync/watchlist/{type}/{sort_by}/{sort_how}` | Yes |
| History | `/sync/history`, `/sync/history/remove` | Yes |
| Library | `/sync/collection/{type}` | Yes |
| Ratings | `/sync/ratings/{type}` | Yes |
| Favourites | `/sync/favorites/{type}/{sort_by}/{sort_how}` | Yes |
| Lists hub | `/users/me/lists`, `/users/likes/lists`. Shared: `/users/me/collaborations` returned 405, so try `/users/me/lists/collaborations` when building T067, and hide Shared if it fails | Yes |
| List page | `/users/me/lists/{id}/items/{type}/{sort_by}/{sort_how}` | Yes |
| Browse lists | `/lists/trending`, `/lists/popular`, `/lists/{id}/items` | No |
| Calendar | `/calendars/my/{media,shows,movies}/{date}/{days}`, plus `premieres`, `finales`, `new` | Yes |
| Profile | `/users/settings`, local `stats` | Yes |

## Search

| Mode | Endpoint | Auth |
|---|---|---|
| Media | `/search/movie,show` | No |
| Shows, Movies | `/search/show`, `/search/movie`, with `/exact` first as today | No |
| People | `/search/person` | No |
| Lists | `/search/list` | No |
| Empty state | `/search/recent_by_id/global/{type}` returned 200 for movies | No |

## Filter drawer

`/genres/{type}`, `/countries/{type}`, `/languages/{type}`, `/certifications/{type}`. Cache these for a day.

**Filter values confirmed by comparing results:**

| Filter | Value form | Baseline, then filtered |
|---|---|---|
| `genres` | Slug | 236 → 96 |
| `years` | `2020-2029` | 236 → 127 |
| `runtimes` | `0-60` | 236 → 2 |
| `ratings` | `90-100` | 236 → 2 |
| `certifications` | `pg` | 236 → 37 |
| `countries` | `fr` | 236 → 2 |
| `imdb_ratings` | `9.0-10.0` | 236 → 5 |
| `rt_meters`, `rt_user_meters` | `90-100` | 236 → 78, 85 |
| `parental_violence` and others | **A numeric range**, `0-0` for None, `0-1` up to Mild. `none` is ignored | 236 → 14, 73 |
| `parental_include_unrated` | `false`, sent with a parental filter | Combined 236 → 108 |
| `watchnow` | `subscriptions`, `free` | 236 → 218, 19 |
| `statuses` | `ended`. **`status` is ignored**, despite `filters.md` | 775 → 305 |
| `ignore_watched` | `true`, signed in | 236 → 135 |

`ignore_watchlisted` returned 200 with no change on this account, whose watchlist may not overlap. Filters also apply on `/media/*` (775 → 182). A calendar with `genres` returned 200, but its effect wasn't measured.

## Response handling

| Status | Meaning | Behaviour |
|---|---|---|
| 204 | Nothing to report | Empty row |
| 420 | Account limit | Message from `/users/settings` limits, as existing |
| 426 | VIP required | Hide the feature. Shouldn't occur on this list, so log it |
| 429 | Rate limit | Existing retry, then cached copy |
| 403 | Limited Access, confirmed on `/watchnow/sources` and `/movies/{id}/watchnow/us` | Hide the feature and log it |
| 412 | Missing JSON content type | Shouldn't occur, since `State::request` always sends it |
