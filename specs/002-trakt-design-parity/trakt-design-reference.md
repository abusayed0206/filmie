# Trakt design reference

What Trakt's desktop web app does, read from source on 2026-11-03: trakt-web `9ebdbff` and trakt-api `090d333`. Paths are under `projects/client/src` in trakt-web. Nothing here has been checked against the running signed-in app.

This describes behaviour and measurements in our own words. trakt-web is GPLv3 and Filmie is MIT, so build from this file and write new code. Don't copy code, styles, icons or other assets from that repo.

Token names in trakt-web don't always equal their pixel values, so the values below are resolved pixels.

## Layout shell

- **Desktop uses the side rail and `NavbarActions`.** `TopNavbar` only renders at 768 px and below, so don't model anything on it (`routes/+layout.svelte`, `lib/sections/navbar/_internal/NavbarActions.svelte`).
- **Top bar:** fixed, full width, inset past the rail. Left: page title, meta text (often the mode name), optional back caret, page actions. Centre: the media switch, then page actions. Right: header actions, then the filter button. It never hides. Once the page has scrolled, a blurred layer at 75% of the bar colour with a fading mask appears.
- **Rail:** 48 px collapsed, 180 px expanded, collapsed by default, remembered. Sub-links only show when expanded. Collapsed items have tooltips.
- **Rail items, signed in:**
  - Search, with a Ctrl K hint when expanded
  - Home: Continue Watching, Calendar, Recommended
  - Discover: Trending, Releases, Anticipated, Popular
  - Lists: Watchlist, Smart Lists, My Lists, Liked, Shared
  - Bottom: History, Library, Settings, profile. When collapsed, this menu opens on hover and hides after 150 ms.
- **Page:** 16 px gap between sections, 64 px left offset for the rail, 24 px side distance.

## Media switch

- **Options, in order:** Media (default), Shows, Movies, each with an icon and label (`lib/components/toggles/_internal/constants.ts`).
- **Look:** segmented pill track, 4 px padding, 32 px segments, a sliding selector using the spring curve (`lib/sections/navbar/_internal/NavbarContentToggle.svelte`).
- **Search only:** People and Lists unfold as two more segments.
- **State:** the address wins over the saved value, the saved value is remembered, and it carries across internal links (`lib/features/filters/useDiscover.ts`).
- **Where it shows:**
  - Always: Home, Discover, Search, own profile, profile, lists hub.
  - Also: History, Watchlist, Progress, Library, list details and views.
  - Not on the Trending, Anticipated, Popular and Recommended grids, where the mode is meta text and the switch is inside the filter drawer.
- **Effect:** every row swaps to the mode's data. Media mode mixes types and adds a type icon tag to cards. Discover's title becomes Shows, Movies or Discover. `/movies` and `/shows` redirect to Discover with that mode.

## Filter drawer

- **Button:** funnel with a count badge, disabled and faded on pages without filters.
- **Drawer holds:** Reset (red, disabled when nothing differs from saved), Set as default (saves and closes), a compact media switch, Simple and Advanced tabs (remembered), a Display section.
- **Scope:** on Home, Discover, profile and lists hub, filters follow you across pages. Elsewhere they apply to that page and are restored on leaving.
- **Defaults:** saved locally, restored only when the address has no filters. Reset returns to them.
- **Tab switching:** going from Advanced back to Simple with advanced filters set asks for confirmation, then clears them.

| Filter | Simple | Advanced |
|---|---|---|
| Genre | One chip: My favorites, then genres | Multi-select with exclude |
| Availability | My favorites, Streaming now, Free, All digital releases, up to 5 services | Multi-select of the country's services with search |
| Decade / Released | This year, then 1960s onward, newest first | Slider, 1930 to 2030 |
| Runtime | 0-30, 31-60, 61-90, 91-120, 121+ minutes | Slider, 0 to 500 |
| Ratings | Trakt rating slider, 0 to 100% | Also IMDb, Rotten Tomatoes critic and audience |
| Certification | All Ages, Parental Guidance, Teens, Mature, Unrated | Multi-select with exclude |
| Region / Country | 7 regions | Country multi-select |
| Status | Released, Upcoming, Ended, Canceled, Rumored | Multi-select of 10 statuses |
| Parental guide | Not shown | Nudity, violence, profanity, alcohol, frightening: None to Severe |
| Display | Watched and Watchlisted: Default, Yes, No | Same |

List filters use the placeholder "All" and start with a Reset item. A slider at full range counts as no filter.

Definitions: `lib/features/filters/_internal/constants.ts`, `lib/sections/navbar/components/filter/`.

## Search

- **Ctrl K or `/`:** toggles a command palette, not the search page. Placeholder "Where to?", sections Pages, Movies and Shows, with arrow, Enter and Esc hints (`lib/features/spotlight/`).
- **Search page:** Media, Shows, Movies, People, Lists switch with the input below it, each with its own placeholder, debounced about 0.13 s.
- **Results:** grid of portrait, person or list cards; list cards use 3 columns on desktop. Tags: air date, plus duration in Movies mode or episode count in Shows mode.
- **Empty state:** Top Searches; for People, Birthdays This Month; for Lists, Popular Lists.

## Pages

**Home** (`routes/home/+page.svelte`), in order: banner; Continue Watching (landscape); Start Watching (portrait, 40 px footer: watchlist by release date, unreleased hidden, in-progress removed); streak callout (74 px banner with flame, week heatmap, arrow); Calendar (landscape, 14 days, All/Premieres/Finales); Recommended (portrait, 28 px footer); History (landscape, with rate action).

**Discover:** Trending (portrait, watchers tag), Releases (landscape, 30 days, episode-type switch), Anticipated (portrait, score tag), Popular (portrait).

**Drill-down grids:** auto-fill columns at least 276 px wide of summary cards, infinite scroll (next page past 50% scroll or if content doesn't fill the view, with a spinner), title and mode in the top bar. Releases is a calendar page, not a grid.

**Up next:** summary-card grid, filters, sort drawer: default, smart, release date, remaining.

**Profile progress:** own profile. Switch: Completed, Ended, In progress, Dropped. No sort on Dropped.

**Watchlist:** summary grid, item count, sort: default, added, runtime, rating, my rating, release, title, rank. The sort value replaces the rating on the card.

**Lists hub:** Watchlist row, then My Lists row with Smart, Personal, Liked, Shared switch and a create menu. Per-type pages stack each list as its own row. Personal sorts: rank, name, updated, created.

**Calendar:** week view by default, day/week switch, pinned toolbar, mini month, episode-type switch, infinite loading.

**Signed out in Trakt:** a marketing landing page. Filmie doesn't follow this; see the spec.

## Rows

- **Header:** at least 40 px high, inset 24 px. Left to right: collapse button, title, row actions beside the title, meta text under the title.
- **Collapse:** ghost circled caret that rotates 180°, saved per row, 150 ms height animation.
- **Title:** 18/22 px. It is the drill-down link with a trailing caret and turns the active link colour on hover. There is no "See all".
- **Filters:** global, not per row. Changing them resets row scroll.
- **Content:** 10 items, then a call-to-action card if 4 or fewer. Skeleton while loading, placeholder when empty, cross-faded. Loads when in view.
- **Scroll:** no arrows. Rows with a drill-down and more than one item don't scroll with the mouse on desktop, except for a horizontal trackpad wheel. Snap x-proximity, edge fade mask.
- **Width:** whole cards, at most 10 portrait or 7 landscape.

## Cards

| Type | Size |
|---|---|
| Portrait | At least 132 px wide, cover 1.5× width |
| Landscape | At least 200 px wide, cover width ÷ 1.786 |
| Footer | 40 px, or 28 px in small rows |
| Summary | 276 × 208 |
| Compact | 96 tall |
| List | At least 340 × 256 |

- **Radius:** 12 px.
- **Cover:** object-fit cover, top aligned. Top badge, bottom-left tag at 20 px high (status, progress or date). Landscape adds a centred logo at 60% width over a gradient tinted from the title's colours. A missing image shows the title in uppercase.
- **Indicator:** one centred tag straddling the cover's bottom edge. Priority: rewatching, dropped, watched, started, post-credits, watchlisted.
- **Footer:** default portrait shows tags only and no title. Start Watching: title, then S/E or runtime. Episode landscape: show title, then number and episode title. Activity: title, then type. Episode titles respect spoiler settings.
- **Hover:** 150 ms accent outline, 2 px, no movement. Watched covers sit at 75% opacity, back to 100% on Trending, Popular, Anticipated and Recommended.
- **Menu:** a three-dot menu always shows top-right when signed in: watchlist, mark watched, add to list. Mark watched is inline only on Start Watching and Continue Watching, and rate only on History.
- **Click:** media cards open the page. Episodes open a drawer. Footer show titles link to the show.
- **Summary card:** opaque, backdrop behind, poster left. Title clamped to 2 lines, then original title and genres. Tags in a 2-column grid, rating or sort value bottom-right.
- **List card:** 40% tinted surface, avatar, name, meta, actions, up to 8 overlapping 120 × 180 posters.
- **Skeleton:** cover plus a half-width 12 px bar, shimmer staggered by index.

## Title page

**Order:** header, Seasons (shows), Actors, Comments, Videos, Soundtrack, Related, Lists, Trivia.

**Header:** poster, flexible column, 320 px right column. Gap 32, max width 1280, top padding 38, minimum height 400. At 769 to 1023 px the right column drops.

**Middle column, in order:**
1. Title, 24 to 48 px.
2. "Directed by" or "Created by" plus one more name, underlined links.
3. Secondary line: year • runtime • episode count (shows) • certification • first genre only, then a small Details button.
4. Status, bold in the emphasis colour.
5. Ratings: Trakt, IMDb, MAL (anime only), Rotten Tomatoes critic and audience. Logo plus bold value, with a caret. The row opens the Ratings drawer. Vote counts are hidden.
6. Social row (signed in).
7. Overview, 14 px, 150% line height, clamped to 6 lines.
8. Actions (signed in), left aligned at the bottom.

**Action bar:** a 280 × 56 floating pill with a raised shadow. Track button fills the bar, with a progress fill, and opens the mark-as-watched drawer or a confirmation. Then ghost watchlist, trailer and More. More (icon rotates 90°) drops a panel attached under the bar: list, share, notes, cover, history, drop, report.

**Rate:** a 40 px row under the bar with 5 half-step stars (10-point scale) and Favourite beside it. Stars preview in orange, scale 1.15 and show a tooltip.

**Poster:** up to 320 px, 2:3, radius 24, raised shadow. Links to the preferred service, otherwise the trailer. Hover desaturates to 30% with a 2 px light border and overlay. Tags straddle the bottom edge.

**Background:** no backdrop image at this width. A 920 × 920 radial gradient from the top-left, opacity .35, in the title's primary colour, falling back to the accent.

**Where to Watch:** 96 × 96 tiles, radius 12, 60 px logos, a JustWatch meta line and a drawer link. Sentiment sits below it.

**Seasons:** a horizontal rail of landscape episode cards, opening on the next episode to watch, with hidden-count labels at the edges. The header has a season dropdown and View All, which opens the Seasons drawer. Episode cards open the Episode drawer.

**Episode page:** same grid with a 16:9 image and the show's colour glow, and an episode title block above the title. Below the header: Actors, Comments, current-season rail, Related.

**Drawers over the page:** sentiment, details, cast, videos, trivia, soundtrack, history, social, where to watch, seasons, episode, notes, comments, review, ratings, rewatching, season recap, plus mark as watched and manage lists.

## Design tokens

| Role | Value |
|---|---|
| Background | `oklch(19.5% .009 300)` with 3% accent tint |
| Card, floating | `oklch(16.5% ...)` same family |
| Menus | `oklch(22% ...)` same family |
| Border | `oklch(38% ...)` same family |
| Primary text | 99% lightness |
| Secondary text | 67% lightness |
| Drawer | Background at 94% plus blur |
| Raised shadow | 0 6px 24px at 40% |

- **Accent (Trakt):** purple `oklch(56.1% .205 289)`, hover darker, lighter for accent text and active links. **Filmie uses its red here, with the same role for each shade.**
- **Type:** Roboto 300 to 700, Roboto Mono. Text 14, small 12, tag 10, title 18. Weights 400 and 600.
- **Gaps:** 44, 32, 24, 16, 12, 6, 4, 2.
- **Radii:** 4, 6, 12, 16, 20, 24. Pill 24, field 16, menu item 10.
- **Motion:** 150 ms step, 300 ms short, spring 420 ms `cubic-bezier(.34,1.56,.64,1)`. All zero under reduced motion.

## Controls

- **Button:** 48 high, or 40 small, 32 ghost compact, 20 tag. Radius 24, bold capitalised text.
- **Flat style:** primary is a 14% tint with a 2 px inset ring and accent text; hover 26%, press 36%. Secondary is transparent with a 1 px ring. Disabled controls jiggle when pressed. Focus is a 2 px outline, offset 2.
- **Action button:** 40 px circle, ghost hover is a 10% fill, press scales to .92.
- **Select:** 40 high, radius 16, 1 px border, accent border when chosen. Menu scales from .96 in 150 ms, maximum height 276. There is also a 32 px pill chip.
- **Dropdown item:** 14/16 padding, separators, 20 px icons.
- **Switch:** 44 × 24.
- **Drawer:** right edge, 400, 440 or 480 wide, left radius 24. In over 260 ms and out over 200 ms with a 36 px overshoot. Closes via the underlay or Escape. Stacked drawers scale the lower one to .95.
- **Modal:** centred, 480 wide, radius 24, padding 24, blurred overlay.
- **Snackbar:** centred, 480 wide, radius 16, blur; errors get a red border.

## Motion and loading

- **Skeleton pulse:** opacity .4 to .8 over 750 ms. Rating values get in-place skeletons, so nothing jumps.
- **Page transitions:** none globally. Cards fade in over 150 ms.
- **Boot splash:** appears after a 1 s delay, for web asset loading. Not needed in a desktop app.

## What the free API tier offers

From the trakt-api guides, updated 2026-05 to 2026-10.

- **Standard tier:** public endpoints on `api.trakt.tv`, free. Premium is a paid developer plan.
- **Limited Access (🫣):** may need approval and can fail even with correct syntax. Don't depend on these.
- **VIP Only (🔥):** returns `426` for non-VIP users. **VIP Enhanced** raises allowances, and `420` means an account limit was hit. Read limits from `/users/settings`.
- **Rate limits:** 500 GET calls per 5 minutes (signed in, or per client ID and IP), 1 write per second.
- **Filters:** `movies`, `shows`, `calendars` and `search` methods tagged with filters take common, rating, movie, show and episode filters (`filters.md`).
- **Caching:** allowed and encouraged for the features people use. Scraping or mirroring to build a reusable copy of the catalogue isn't allowed (`api-use-policy.md`).
- **Stats:** `/users/:id/stats` is VIP only and returns `204` otherwise, so Filmie's stats must come from local data.

**Areas with endpoints in the contracts:** media, movies, shows, seasons, episodes, people, calendars, recommendations, comments, lists, search, notes, genres, networks, certifications, countries, languages, watchnow, sync, users.

The plan must classify each endpoint Filmie uses as free, VIP or limited access from its contract, since this file doesn't list that per endpoint.
