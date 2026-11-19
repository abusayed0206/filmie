# Nanocrowd Integration — Implementation Guide

> **Updated 2026-11-19 after testing against the live API.** The first draft relied on `/api/titlesearch/<query>`, which doesn't exist (see the top of NANOCROWD_API.md). Where the sections below disagree with this, this is right:
>
> - **Commands** (`src-tauri/src/nanocrowd.rs`): `nanocrowd_title_info(title, year, imdbId)` and `nanocrowd_tier(genre)`. `nanocrowd_search` and `nanocrowd_fundamentals` are gone.
> - **Title lookup:** `catalog_ids` compares normalized titles (punctuation, case and a leading article ignored; the part before a subtitle on either side) in the cached catalog (30 days), with years up to 3 apart, nearest first, at most 6 candidates; the IMDb id in `/api/titles/<id>` decides which one it is. Measured on 116 popular and top-rated TMDB movies: every miss from before 2025 was a film missing from Nanocrowd; the catalog has nothing after 2024. The UI strips accents before sending the title, and only asks for movies that have an IMDb id and a year.
> - **Vibes page:** `#/discover/vibes/<genre>`, one of the 25 genres in `VIBES_GENRES`. It shows the genre's mood words and its films (`/api/tiers/<genre>`, cached 7 days), matched to TMDB with `/find/<imdbId>`, 40 at a time. There is no free-text search, because the API has none.
> - **Title page:** tags link to the Vibes page only when the keyword is a genre; the rest are plain text. Similar Vibes shows the first 20 of `mostLikeTitles`, matched to TMDB by title and year.
> - A `{"response":"nope"}` answer is an error, so it is never cached.
> - **Token:** fetched once, at the first launch, by a background task in `main.rs` setup, and saved in the cache table under `nanocrowd token` with no practical expiry. Later launches read it from there with no request. It is used until Nanocrowd answers 401 or 403; then `refused` drops it (only if no other request has already replaced it), one new token is fetched under the lock, and the request is retried once. Settings → Clear cache removes it, and the next request fetches a new one.


> Written: 2026-11-19  
> Status: Complete (UI tests pending manual run — see §8)

---

## 1. What Was Built

Filmie now integrates **Nanocrowd** ([app.nanocrowd.com](https://app.nanocrowd.com)), a semantic film-relevancy service, via two surfaces:

| Surface | Location | What it shows |
|---|---|---|
| **Title page — Vibes tags** | Below the overview paragraph | Up to 10 `#nanogenre` keyword tags linking to the Discover Vibes page |
| **Title page — Similar Vibes row** | Poster rail section | Films Nanocrowd considers semantically similar (`mostLikeTitles`), resolved to TMDB poster cards |
| **Discover → Vibes page** | `#/discover/vibes` | Full mood/genre text search + 25 preset pill buttons; deep-linkable as `#/discover/vibes/<term>` |

No new Cargo dependencies were added. No user credentials are required — Nanocrowd grants anonymous guest JWTs.

---

## 2. Nanocrowd API Basics

> See [`docs/NANOCROWD_API.md`](./NANOCROWD_API.md) for the full reverse-engineered spec.

| Detail | Value |
|---|---|
| Real backend host | `https://bananastreampie.com` (not nanocrowd.com) |
| Auth | Guest JWT: `GET /api/init/token` → `{ token: "..." }` |
| Token TTL | ~1 hour (Filmie caches in memory, refreshes on 401) |
| Key endpoints | `/api/titlesearch/:query`, `/api/titles/:ncTitleId`, `/api/fundamentals` |
| ID system | Nanocrowd uses its own integer `ncTitleId` (e.g. `27320` for *Lucy*). IMDb IDs are present in responses for cross-referencing. |
| `fpm` field | Frequency Per Million — semantic weight of a keyword; used for tag font-size in Nanocrowd's own UI. Not currently used in Filmie. |

---

## 3. Rust Backend — `src-tauri/src/nanocrowd.rs`

**File:** [`src-tauri/src/nanocrowd.rs`](../src-tauri/src/nanocrowd.rs)

### 3.1 `NanocrowdState`

Holds the in-memory JWT token cache, wrapped in `tokio::sync::Mutex`:

```rust
pub struct NanocrowdState {
    token: Mutex<Option<(String, Instant)>>,
}
```

Stored as managed Tauri state; accessible in commands via `tauri::State<'_, NanocrowdState>`.

**Token lifecycle:**
1. `get_token()` checks the cached `(token_str, created_at)` tuple.
2. If `created_at.elapsed() < 1 hour`, the cached token is returned.
3. Otherwise, it hits `GET /api/init/token`, stores the result, returns fresh token.
4. `invalidate_token()` clears the cache (called on 401 responses).

### 3.2 `fetch_with_auth()`

Generic authenticated request helper:

```
fetch_with_auth(client, nc_state, "/api/titles/27320")
```

1. Gets token via `get_token()`.
2. Issues `GET {BASE_URL}{path}` with `Authorization: Bearer <token>`.
3. On **401**: calls `invalidate_token()`, gets a new token, retries **once**.
4. On non-2xx after retry: returns `Err(...)`.

### 3.3 `pick_best_match()`

Nanocrowd's title search returns multiple candidates (e.g. three films all named "Lucy"). This function picks the right one:

```
Priority 1: exact IMDb ID match (case-insensitive)
Priority 2: matching release year
Priority 3: first item in the list (fallback)
```

Returns `Option<u64>` — the winning `ncTitleId`, or `None` if the list is empty.

### 3.4 `percent_encode()`

Manual URL-encoder (no `urlencoding` crate) — RFC 3986 unreserved chars pass through; everything else is `%XX`-encoded.

### 3.5 Tauri Commands

| Command | Signature | Cache TTL | Cache key |
|---|---|---|---|
| `nanocrowd_title_info` | `(title, year?, imdb_id?)` → `Value` | 30 days | `nanocrowd info <lc-title> <year> <imdb_id>` |
| `nanocrowd_search` | `(query)` → `Value` (array) | 7 days | `nanocrowd search <lc-query>` |
| `nanocrowd_fundamentals` | `()` → `Value` | 30 days | `nanocrowd fundamentals` |

All caching goes through `Db::through()` — the existing SQLite-backed cache layer in `src-tauri/src/db.rs`.

**`nanocrowd_title_info` flow:**
```
1. Search: GET /api/titlesearch/:encoded_title
2. pick_best_match(results, year, imdb_id) → ncTitleId
3. Fetch: GET /api/titles/:ncTitleId
4. Unwrap array response → first element
5. Return full object { title, keywords, mostLikeTitles, ... }
```

**`nanocrowd_search` flow:**
```
1. GET /api/titlesearch/:encoded_query
2. Return raw array of { ncTitleId, title, releaseYear, imdbId, ... }
```

### 3.6 Unit Tests

Three tests in `mod tests` at the bottom of `nanocrowd.rs`:

| Test | What it checks |
|---|---|
| `test_pick_best_match_by_imdb` | IMDb ID match takes priority over year |
| `test_pick_best_match_by_year_fallback` | Year match when no IMDb ID |
| `test_pick_best_match_empty` | Empty input → `None` |

---

## 4. Registering the Module — `src-tauri/src/main.rs`

Three additions are needed when adding a new Tauri module. For Nanocrowd these are already in place:

**[Line 5]** — declare the module:
```rust
mod nanocrowd;
```

**[Line 275]** — add to the CSP external hosts allowlist:
```rust
"nanocrowd.com",
```

**[Line 361]** — manage state in Tauri setup:
```rust
app.manage(nanocrowd::NanocrowdState::new());
```

**[Lines 409–411]** — register commands in `invoke_handler!`:
```rust
nanocrowd::nanocrowd_title_info,
nanocrowd::nanocrowd_search,
nanocrowd::nanocrowd_fundamentals
```

> [!NOTE]
> `NanocrowdState` requires `trakt::State` to be managed first (it borrows `s.http` from the Trakt state's shared HTTP client). The `trakt::State::new()` call is on line 360, one line before `NanocrowdState::new()`.

---

## 5. Frontend — Title Page

**File:** [`ui/pages-title.js`](../ui/pages-title.js)

### 5.1 Vibes Tags (Nanogenre keywords)

**Where injected:** A `<div id="nanocrowd-tags" class="vibe-tags-wrap"></div>` placeholder is placed inside the summary HTML string, immediately after the `<p class="overview">` element (line 183).

**Filled in async (line 241–247):**
```js
if (type === 'movie') {
  invoke('nanocrowd_title_info', { title: name, year: yearOf(d), imdbId: imdb }).then(info => {
    const box = $('nanocrowd-tags');
    if (!box || token !== routeToken || !info?.keywords?.length) return;
    const tags = info.keywords.slice(0, 10).map(k =>
      `<a class="vibe-tag" href="#/discover/vibes/${encodeURIComponent(k.term)}">
         <span class="vibe-hash">#</span>${esc(k.term)}
       </a>`
    ).join('');
    box.innerHTML = `<span class="vibe-label">Vibes</span><div class="vibe-list">${tags}</div>`;
  });
}
```

- Clicking a tag navigates to `#/discover/vibes/<term>` (deep-links into the Vibes page).
- `routeToken` check prevents stale updates after navigation.
- Currently **movies only** — TV support is a future enhancement.

### 5.2 Similar Vibes Row

**Where declared:** In the `renderRows([...])` call, alongside other poster rails (line 259):

```js
type === 'movie' && {
  id: 'nanocrowd', title: 'Similar Vibes (Nanocrowd)', bright: true,
  load: async () => {
    const info = await invoke('nanocrowd_title_info', { title: name, year: yearOf(d), imdbId: imdb })
      .catch(() => null);
    const recs = info?.mostLikeTitles ?? [];
    if (!recs.length) return '';
    const resolved = await Promise.all(recs.map(async rec => {
      // resolve Nanocrowd title → TMDB movie → poster card
      ...
    }));
    return resolved.filter(Boolean).join('');
  }
}
```

**Resolution strategy:** Each `mostLikeTitles` entry (`{ ncTitleId, title, year }`) is searched on TMDB via `tmdb('/search/movie', { query: rec.title, primary_release_year: rec.year })`. The first TMDB result is used for the poster image, TMDB ID, and play link. This avoids adding a Nanocrowd CDN image source to the CSP.

---

## 6. Frontend — Discover Vibes Page

**File:** [`ui/pages-browse.js`](../ui/pages-browse.js)

### 6.1 Route Dispatch (line 114)

Inside the `discover()` page function:
```js
if (sub === 'vibes') return vibesPage(into);
```

The `sub` value is derived from the URL hash: `#/discover/vibes` → `sub = 'vibes'`.

### 6.2 `VIBES_GENRES` (line 192)

25 hardcoded genre pill labels (lowercase strings):
```js
const VIBES_GENRES = [
  'action', 'adventure', 'animation', 'biography', 'comedy',
  'cops', 'documentary', 'drama', 'fantasy', 'historical',
  'horror', 'independent', 'musical', 'mystery', 'noir',
  'period', 'political', 'romance', 'sci-fi', 'sports',
  'superhero', 'suspense', 'thriller', 'war', 'western',
];
```

These are static — they can be replaced with live data from `nanocrowd_fundamentals` as a future enhancement.

### 6.3 `vibesPage(into)` (line 200)

1. **Deep-link:** takes `<term>` from the route as the second argument of `pages.discover` → `initialQuery`.
2. **Renders HTML:** hero div with `<h2>`, search bar (`#vibes-input` + `#vibes-submit`), and 25 pill buttons. Pills with `data-vibe="<genre>"` get `.on` class if `genre === initialQuery`.
3. **Event listeners:**
   - Submit button / Enter key on input → `executeSearch(inputValue)`.
   - Pill click → sets `.on` on clicked pill, populates input, calls `executeSearch(genre)`.
4. **`executeSearch(q)`:**
   ```
   invoke('nanocrowd_search', { query: q })
     → array of { ncTitleId, title, releaseYear }
     → for each: tmdb('/search/movie', { query: title, primary_release_year: year })
     → first TMDB result → posterCard(movie)
     → grid in #vibes-results
   ```
5. **Auto-trigger:** if `initialQuery` is set (came from a vibe tag link), `executeSearch(initialQuery)` runs immediately after render.

### 6.4 Title & Filter Bar Wiring (line 275, 279)

```js
const DISCOVER_TITLES = { ..., vibes: 'Vibes' };

pages.discover.bar = sub => ({
  title: discoverTitle(sub),
  mode: 'bar',
  filters: sub === 'recommended' || sub === 'vibes' ? false : sub ? 'local' : 'global'
});
```

The `vibes` sub-page suppresses the global/local filter controls (they don't apply to Nanocrowd results).

---

## 7. Navigation Wiring

### Sidebar Rail — `ui/index.html`

```html
<a href="#/discover/vibes" class="rail-item nav-sub" data-nav="discover/vibes">Vibes</a>
```

Place this inside the existing `<!-- discover group -->` rail section, after the last existing rail item (e.g. "Anticipated").

### Ctrl+K Command Palette — `ui/controls.js`

```js
['Vibes', '#/discover/vibes'],
```

Add to the `PALETTE_PAGES` array alongside the other Discover entries.

---

## 8. CSS — `ui/style.css`

All Nanocrowd styles are appended at the **end** of `style.css`.

### Title Page Tag Classes

| Class | Purpose |
|---|---|
| `.vibe-tags-wrap` | Flex row container for the whole tag block |
| `.vibe-label` | "Vibes" label text (muted, small caps) |
| `.vibe-list` | Wrapping flex row of tag chips |
| `.vibe-tag` | Individual `<a>` chip (pill shape, muted border) |
| `.vibe-tag:hover` | Accent color highlight on hover |
| `.vibe-tag .vibe-hash` | The `#` prefix (accent color) |

### Discover Vibes Page Classes

| Class | Purpose |
|---|---|
| `.vibes-hero` | Full-width hero container (centered content) |
| `.vibes-header` | `<h2>` + subtitle paragraph |
| `.vibes-search-bar` | Flex row: input + button |
| `.vibes-search-bar .search-input` | Grows to fill available width |
| `.vibes-pills` | Flex wrap of genre pills |
| `.vibe-pill` | Genre pill button |
| `.vibe-pill:hover` | Hover highlight |
| `.vibe-pill.on` | Active/selected state (accent background) |

---

## 9. What's Not Done Yet

| Item | Effort | Notes |
|---|---|---|
| **Run UI tests** | Trivial | `node --test tests/ui.test.js` — requires nvm active outside sandbox. Must be run manually. |
| **`navFor` for `discover/vibes`** | Small | Check `ui/lib.js` lines 257–261; `vibes` may need to be added to the sub-route handling so the sidebar highlight works correctly. Add a test case in `tests/ui.test.js` line ~272. |
| **TV show support** | Medium | The `if (type === 'movie')` guard in `pages-title.js` (lines 242, 259) blocks TV. Nanocrowd's API does return `type: "TV"` — the guard just needs relaxing once validated. |
| **Live fundamentals pills** | Small | `VIBES_GENRES` is hardcoded. Could call `invoke('nanocrowd_fundamentals')` on page load and render pills from the live API instead. |
| **Error state polish** | Small | The Vibes page shows a plain `<p class="error">` on failure. Use the existing `toast()` pattern for consistency. |
| **`fpm`-weighted tag sizes** | Cosmetic | Nanocrowd's own UI scales keyword tags by `fpm` (Frequency Per Million). We could do `font-size: calc(0.75rem + fpm * 0.0001rem)` to replicate this. |
| **Commit changes** | Trivial | All changes are unstaged. Run: `git add -A && git commit -m "Add Nanocrowd Vibes integration"` |

---

## 10. Build & Verify

```powershell
# From D:\filmy

# Rust: format check
cargo fmt --check

# Rust: lints (must be 0 errors, 0 warnings)
cargo clippy --all-targets -- -D warnings

# Rust: tests (should show 24/24 or more passing)
cargo test

# UI tests (must run outside sandbox with nvm active)
node --test tests/ui.test.js

# Full dev build
pnpm tauri dev
```

> [!IMPORTANT]
> The `cargo test` suite includes 3 new Nanocrowd unit tests: `test_pick_best_match_by_imdb`, `test_pick_best_match_by_year_fallback`, `test_pick_best_match_empty`. All 24 tests pass as of this writing.

---

## 11. File Change Summary

| File | Change type | What changed |
|---|---|---|
| `src-tauri/src/nanocrowd.rs` | **New** | Full Nanocrowd integration module |
| `src-tauri/src/main.rs` | Modified | `mod nanocrowd`, `NanocrowdState::new()`, 3 commands in `invoke_handler!`, `"nanocrowd.com"` in `EXTERNAL_HOSTS` |
| `ui/pages-title.js` | Modified | Vibe tags placeholder in HTML, async tag fill block, Similar Vibes poster row |
| `ui/pages-browse.js` | Modified | `vibesPage()` function, `VIBES_GENRES`, route dispatch, `DISCOVER_TITLES`, filter bar rule |
| `ui/index.html` | Modified | Vibes rail item in Discover group |
| `ui/controls.js` | Modified | `['Vibes', '#/discover/vibes']` in `PALETTE_PAGES` |
| `ui/style.css` | Modified | Tag and Vibes page CSS appended at end |
| `docs/NANOCROWD_API.md` | **New** | Full reverse-engineered API spec |
