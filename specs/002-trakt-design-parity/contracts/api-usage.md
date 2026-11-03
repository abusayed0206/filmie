# Contract: Trakt endpoints per page

Every endpoint here has no VIP Only or Limited Access tag in trakt-api `090d333`. "Auth" means it needs a signed-in person. "F" means it takes filters. Mode columns give the endpoint per mode.

Step 1 probes these with a free account and records the result in `docs/PLAN.md`. Remove or replace anything that fails, rather than building on it.

## Home

| Row | Media | Shows | Movies | Auth | F |
|---|---|---|---|---|---|
| Continue Watching | Both, merged by date | `/sync/progress/up_next_nitro` | `/sync/playback/movies` | Yes | |
| Start Watching | `/sync/watchlist/movie,show/released` | `.../shows/...` | `.../movies/...` | Yes | ✓ |
| Calendar | `/calendars/my/media/{date}/14` | `/calendars/my/shows/...` | `/calendars/my/movies/...` | Yes | ✓ |
| Recommended | Both, merged | `/recommendations/shows` | `/recommendations/movies` | Yes | Probe |
| History | `/sync/history` | `.../episodes` | `.../movies` | Yes | |
| Recently played | Local, `history_list` | Same | Same | No | |

Confirm the exact watchlist path and sort value in the probe, since the reference names the sort and not its API value. Also confirm whether `/recommendations` accepts filters: trakt-web offers them there, but its contract has no filter tag. If it doesn't, the filter button is disabled on that row's grid.

## Discover

| Row and grid | Media | Shows | Movies | Auth | F |
|---|---|---|---|---|---|
| Trending | `/media/trending` | `/shows/trending` | `/movies/trending` | No | ✓ |
| Releases | `/calendars/all/media/{date}/30` | `/calendars/all/shows/...` | `/calendars/all/movies/...` | No | ✓ |
| Anticipated | `/media/anticipated` | `/shows/anticipated` | `/movies/anticipated` | No | ✓ |
| Popular | `/media/popular` | `/shows/popular` | `/movies/popular` | No | ✓ |
| Recommended grid | Both, merged | `/recommendations/shows` | `/recommendations/movies` | Yes | Probe |

**More free charts**, offered as extra rows at the bottom of Discover under FR-016: `/{movies,shows}/hot`, `/watched/{period}`, `/played/{period}`, `/collected/{period}`, `/favorited/{period}`, `/streaming/{period}`, `/movies/boxoffice`. These have no Media endpoint, so in Media mode they show movies and shows as two rows.

## Title page

| Section | Endpoint | Auth |
|---|---|---|
| Details and colour | `/{movies,shows}/{id}?extended=full,colors` | No |
| Ratings drawer | `/{type}/{id}/ratings` with extended ratings | No |
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
| Where to watch | TMDB `watch/providers`, unchanged | No |
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
| Notes | `/notes` routes, confirm in the probe |

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
| Lists hub | `/users/me/lists`, `/users/likes/lists`, `/users/me/collaborations` | Yes |
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
| Empty state | `/search/recent_by_id/global/{type}` or equivalent, confirm in the probe | No |

## Filter drawer

`/genres/{type}`, `/countries/{type}`, `/languages/{type}`, `/certifications/{type}`. Cache these for a day.

## Response handling

| Status | Meaning | Behaviour |
|---|---|---|
| 204 | Nothing to report | Empty row |
| 420 | Account limit | Message from `/users/settings` limits, as existing |
| 426 | VIP required | Hide the feature. Shouldn't occur on this list, so log it |
| 429 | Rate limit | Existing retry, then cached copy |
| 403 | Limited Access | Hide the feature and log it |
