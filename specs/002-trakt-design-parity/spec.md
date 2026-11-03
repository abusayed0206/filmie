# Feature Specification: Trakt design parity with filters

**Feature Branch**: `002-trakt-design-parity`

**Created**: 2026-11-03

**Status**: Draft

**Input**: User description: "You didnt add the Movies,film etc filter. Recheck the repo, if needed clone that trakt repo and let the agents understand it correctly and must follow as is desgin from trakt app git repo!"

**Decided with the user (2026-11-03)**:

- **Scope**: browsing and tracking, with everything Trakt's free API tier offers. Local data on this PC may be used for better data handling and stats.
- **Look**: Trakt's design as is (greys, type, sizes, shapes, motion), with Filmie's red accent and name.

**Design source**: [trakt-design-reference.md](trakt-design-reference.md) holds the measurements and behaviour read from Trakt's repository. "As Trakt" in this spec means as described there.

**Relation to feature 001**: builds on the rail, placeholders, scroll restore and in-place refresh from `specs/001-trakt-style-ui`. Where they differ, this spec wins, which replaces 001's rail items, palette, card hover, row arrows, title layout and page cross-fade. 001's check in the real app was never finished, so this feature's check covers it too.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Filter everything by Media, Shows or Movies (Priority: P1)

A person switches between Media, Shows and Movies from a switch at the top of the page, and every row on the page changes to match. They can narrow things further with a filter drawer, and save the result as their default.

**Why this priority**: This is the missing piece the request is about, and it changes how every browsing page works.

**Independent Test**: On Home and Discover, change the switch and confirm every row changes type. Open the filter drawer, set a genre and a decade, and confirm results narrow and the button shows a count.

**Acceptance Scenarios**:

1. **Given** Home or Discover, **When** the page opens for the first time, **Then** a Media, Shows, Movies switch is in the top bar with Media selected.
2. **Given** the switch, **When** the person picks Movies, **Then** every row shows only movies, without leaving the page, and Discover's title reads Movies.
3. **Given** a chosen mode, **When** they move to another page or restart the app, **Then** the mode is still applied.
4. **Given** Media mode, **When** a row mixes movies and shows, **Then** each card has an icon showing its type.
5. **Given** a page with filters, **When** the person opens the filter button, **Then** a drawer opens from the right with Simple and Advanced tabs, Reset and Set as default.
6. **Given** filters are set, **When** the drawer closes, **Then** rows show filtered results, the button shows how many filters are active, and row scroll resets.
7. **Given** a saved default, **When** the person presses Reset, **Then** filters return to the default.
8. **Given** Advanced filters are set, **When** they switch to Simple, **Then** they are asked to confirm before those filters are cleared.
9. **Given** a page with no filters, **When** they look at the filter button, **Then** it is disabled and faded.
10. **Given** a filter combination with no results, **When** the page loads, **Then** rows show Trakt's empty placeholder rather than disappearing silently, and the person can reset.
11. **Given** the person is signed out, **When** they use the switch and filters, **Then** they work, except for those that need an account, which are hidden.

---

### User Story 2 - Trakt's app shell (Priority: P1)

The rail and top bar match Trakt's: its items and sub-links, a fixed top bar with the page title, and a blur that appears on scroll.

**Why this priority**: Every other story sits inside this shell, and the new destinations need it.

**Independent Test**: Reach every destination from the rail in both widths and watch the top bar while scrolling.

**Acceptance Scenarios**:

1. **Given** the rail is widened, **When** the person looks at it, **Then** it shows Search; Home with Continue Watching, Calendar and Recommended; Discover with Trending, Releases, Anticipated and Popular; Lists with Watchlist, My Lists, Liked and Shared; and History, Library, Settings and profile at the bottom.
2. **Given** the narrow rail, **When** the person hovers the profile, **Then** the bottom menu opens, and it closes shortly after they leave.
3. **Given** any page, **When** the person scrolls, **Then** the top bar stays and gains a blurred background.
4. **Given** the old Shows or Movies address, **When** it opens, **Then** the person lands on Discover in that mode.
5. **Given** a signed-out person, **When** they look at the rail, **Then** they see only what works without an account, plus sign-in and Settings.

---

### User Story 3 - Trakt's look on every page (Priority: P1)

Colours, type, spacing, buttons, selects, cards and rows look like Trakt's, with Filmie's red in place of Trakt's purple.

**Why this priority**: "As is" is the point of the request, and this is what makes it read as the same design.

**Independent Test**: Compare Filmie and Trakt side by side at the same window size against the reference file's measurements.

**Acceptance Scenarios**:

1. **Given** any page, **When** it is compared with the reference, **Then** background, surfaces, borders, text, type scale, radii and gaps match, apart from the accent.
2. **Given** a row, **When** it shows, **Then** it has a collapse button, a title that links to its full page, whole cards and no arrows, and the collapsed state is remembered.
3. **Given** a card, **When** the person hovers it, **Then** an accent outline appears and it does not move.
4. **Given** a card and a signed-in person, **When** they look at it, **Then** a three-dot menu offers watchlist, mark watched and add to list.
5. **Given** a poster card, **When** the title is watched, on the watchlist or in progress, **Then** one status tag straddles the bottom of the cover.
6. **Given** a row with 4 or fewer items, **When** it shows, **Then** a call-to-action card follows them.
7. **Given** native controls today, **When** the redesign is done, **Then** selects, dropdowns, switches, snackbars and dialogs follow Trakt's styles and keep working by keyboard.

---

### User Story 4 - Home and Discover (Priority: P2)

Home and Discover have Trakt's rows and order, and each row leads to a full grid that loads as the person scrolls.

**Why this priority**: These are the most used pages, and they depend on the shell and the switch.

**Independent Test**: Sign in, check row order against the reference, open a row's title and scroll its grid until more loads.

**Acceptance Scenarios**:

1. **Given** a signed-in person, **When** Home opens, **Then** rows are Continue Watching, Start Watching, Calendar, Recommended and History in that order, with Recently played also present.
2. **Given** Discover, **When** it opens, **Then** rows are Trending, Releases, Anticipated and Popular.
3. **Given** a row title, **When** it is pressed, **Then** a grid of summary cards opens and loads more as the person scrolls, with a spinner.
4. **Given** Continue Watching or Start Watching, **When** the person marks an item watched from its card, **Then** it updates without leaving the page.
5. **Given** a signed-out person, **When** Home opens, **Then** they see Recently played and the public rows with a sign-in prompt, not a marketing page.

---

### User Story 5 - Title, episode and people pages with drawers (Priority: P2)

Movie and show pages follow Trakt's order and header. Details open in side drawers rather than new pages, and everything the free API offers about a title is there.

**Why this priority**: This is the page people spend the most time on before playing something.

**Independent Test**: Open a show, change season, open an episode drawer, mark it watched, rate it, read comments, and press Play.

**Acceptance Scenarios**:

1. **Given** a movie or show, **When** the page opens, **Then** it follows Trakt's order, with poster, credits line, one-line metadata, status, ratings, overview, action bar, rating row, and where to watch in its own column.
2. **Given** a title page, **When** it shows, **Then** the background is a colour glow from the title rather than a backdrop image.
3. **Given** the action bar, **When** the person looks at it, **Then** Play is its first and most prominent control, followed by Trakt's track, watchlist, trailer and More controls.
4. **Given** a show, **When** Seasons shows, **Then** it is a horizontal rail that opens on the next episode to watch, with a season dropdown and View All.
5. **Given** an episode card, **When** it is pressed, **Then** a drawer opens with its details and Play, without leaving the page.
6. **Given** the ratings row, **When** it is pressed, **Then** a drawer shows ratings and their breakdown.
7. **Given** a title, **When** the free API has cast, comments, videos, related titles, lists, sentiment or stats for it, **Then** each is shown in Trakt's place, and each section is left out when there is no data.
8. **Given** a cast member, **When** they are pressed, **Then** a person page shows their details and their movies and shows.
9. **Given** an open drawer, **When** the person presses Escape or the area outside it, **Then** it closes and focus returns to where they were.

---

### User Story 6 - Everything about my own tracking (Priority: P2)

Watchlist, progress, history, library, ratings, favourites, lists and calendar are all available, with Trakt's sorting and layouts.

**Why this priority**: Tracking is half of what Filmie is for, and much of it is free but unused today.

**Independent Test**: Sign in, sort the watchlist, open History and Library, change a progress filter, and view the calendar by week and by day.

**Acceptance Scenarios**:

1. **Given** the watchlist, **When** the person changes the sort, **Then** the order changes and the sort value shows on the cards.
2. **Given** progress, **When** they pick Completed, Ended, In progress or Dropped, **Then** the grid changes, and sort is hidden for Dropped.
3. **Given** History, **When** it opens, **Then** it lists what they watched, newest first, and they can remove an entry.
4. **Given** Library, **When** it opens, **Then** it shows their collection.
5. **Given** the lists hub, **When** it opens, **Then** it shows the Watchlist row and My Lists with Personal, Liked and Shared, and they can create and edit lists, up to their account limit.
6. **Given** the calendar, **When** it opens, **Then** it shows a week of their episodes and movies, with a day view and episode-type switch.
7. **Given** a list is at its limit, **When** they add an item, **Then** they see the limit and how to make room.
8. **Given** tracking, **When** nothing has been pressed, **Then** nothing is sent to Trakt.

---

### User Story 7 - Search and the command palette (Priority: P2)

Ctrl+K opens a command palette for jumping to pages and titles. The search page covers Media, Shows, Movies, People and Lists.

**Why this priority**: It is a defining part of how Trakt is used, and replaces the search behaviour built in 001.

**Independent Test**: Press Ctrl+K, type a title, and open it by keyboard. Then open Search and switch to People.

**Acceptance Scenarios**:

1. **Given** any page but the player, **When** the person presses Ctrl+K, or `/` outside a text field, **Then** a palette opens with Pages, Movies and Shows, usable by arrows, Enter and Escape.
2. **Given** the search page, **When** it opens, **Then** it has a Media, Shows, Movies, People, Lists switch with the box below it.
3. **Given** an empty search, **When** it shows, **Then** it has Top Searches, or the equivalent for People and Lists.
4. **Given** results, **When** the person returns to them with Back, **Then** the query and position are kept.

---

### User Story 8 - Stats from data kept on this PC (Priority: P3)

A profile page shows the person's own stats, and Home shows a streak, all worked out on this PC because Trakt's stats are VIP only.

**Why this priority**: Valuable, but nothing else depends on it, and it needs the person's history stored locally first.

**Independent Test**: Sign in with an account that has history, let it sync, open Profile, and compare totals with Trakt's own counts.

**Acceptance Scenarios**:

1. **Given** a signed-in free account, **When** Profile opens, **Then** it shows totals for movies, shows, episodes and hours watched, top genres, ratings given, and activity over time.
2. **Given** a recent watching streak, **When** Home opens, **Then** a streak callout with a week heatmap shows, and it leads to Profile.
3. **Given** the first sync, **When** a long history is downloading, **Then** the app stays usable and shows progress, and stats fill in when ready.
4. **Given** the person is offline, **When** they open Profile, **Then** stats still show from local data.
5. **Given** the person signs out, **When** sign-out finishes, **Then** their Trakt-derived local data is deleted, while Recently played stays, as it does today.
6. **Given** a signed-out person, **When** they open stats, **Then** only Recently played totals show, with a sign-in prompt.

---

### Edge Cases

- A feature turns out to be VIP only or limited for this account or app: it is hidden, with no error and no upgrade prompt, unless the person has VIP.
- The rate limit is reached: cached data keeps showing, loading resumes after the wait, and the person isn't shown an error for background work.
- Filters that don't apply to a mode, such as status for movies: hidden or ignored in that mode, and not counted on the badge.
- Media mode on a page whose data has only one type: it shows what exists without an error.
- A mode or filter in an old saved value that no longer exists: ignored.
- Offline: pages use cached data, with a clear note when results may be old, and writes fail with a message rather than silently.
- A title with no logo, colour, poster or rating: Trakt's fallback for that element applies, and the layout closes up.
- Spoilers: episode titles and images follow Trakt's spoiler setting where it is available.
- Very long history during the first sync: other pages keep working and it can resume after a restart.
- The window at its smallest size: drawers, the top bar and the right-hand title column still fit.
- Opening the player from a drawer, then going Back: the page returns with its scroll position.
- A history entry removed on Trakt's site: the next sync removes it locally, so stats stay right.

## Requirements *(mandatory)*

### Functional Requirements

**Media switch and filters**

- **FR-001**: The app MUST offer a Media, Shows, Movies switch, as Trakt, defaulting to Media, on the pages where Trakt shows it.
- **FR-002**: The chosen mode MUST apply to every row and grid on those pages, persist across restarts, and carry across pages.
- **FR-003**: The app MUST offer the filter button and drawer as Trakt, with the Simple and Advanced filters in the reference, for every filter the free API supports.
- **FR-004**: Users MUST be able to save filters as their default, reset to it, and see a count of active filters.
- **FR-005**: Filters MUST follow Trakt's scope rule: on Home, Discover, profile and the lists hub they carry across pages, and elsewhere they apply to that page only.

**Shell**

- **FR-006**: The app MUST provide Trakt's fixed top bar and rail, with the items in the reference, except VIP-only and limited-access destinations.
- **FR-007**: Old Shows and Movies addresses MUST open Discover in that mode.

**Look**

- **FR-008**: All pages MUST use the design tokens in the reference, with Filmie's red in every accent role.
- **FR-009**: Rows, cards, tags, menus, buttons, selects, switches, drawers, dialogs, snackbars and skeletons MUST follow the reference.
- **FR-010**: Page changes MUST follow Trakt, with no global cross-fade. 001's placeholders, scroll restore and in-place refresh MUST keep working.
- **FR-011**: All controls MUST work by keyboard, have accessible names and honour reduced motion.

**Pages**

- **FR-012**: Home, Discover, the drill-down grids, the title, episode and person pages, Search, Lists, Watchlist, Progress, History, Library, Calendar and Profile MUST exist and follow the reference.
- **FR-013**: Grids MUST load more as the person scrolls, loading only what is needed.
- **FR-014**: Details listed in the reference as drawers MUST open as drawers, for those features in scope.
- **FR-015**: Ctrl+K and `/` MUST open the command palette.

**Free API coverage**

- **FR-016**: The app MUST use everything the free API tier offers for browsing and tracking: trending, popular, anticipated, most watched, played, collected and favourited, box office, new releases and streaming; calendars; recommendations; title details, stats, ratings, sentiment, people, videos, studios, networks, related titles, lists and comments; person pages; list browsing; search; genres, certifications, countries and languages; streaming availability; and the person's own watchlist, history, collection, ratings, favourites, progress, dropped and hidden items, lists, likes and notes.
- **FR-017**: Before anything is built, every data source MUST be classified as free, VIP only or limited access from Trakt's current documentation, and the result recorded in `docs/PLAN.md`.
- **FR-018**: VIP-only and limited-access features MUST NOT be required for any flow. A VIP account MAY see more where Trakt returns it.
- **FR-019**: The app MUST stay within Trakt's rate limits in normal use, and show cached data rather than failing when limited.
- **FR-020**: Comments and other community content MUST be read-only, and writes MUST be limited to the person's own tracking and lists.

**Local data**

- **FR-021**: The person's own history and ratings MUST be kept in the local database so that stats work offline and without VIP. It MUST sync only what changed since last time.
- **FR-022**: The app MUST show the stats in Story 8, worked out only from the person's own data.
- **FR-023**: Signing out MUST delete Trakt-derived local data. The privacy text in the app and in `PRIVACY.md` MUST describe what is stored.
- **FR-024**: Catalogue data MUST only be cached for features the person uses, and MUST NOT be collected in bulk to build a copy of Trakt's catalogue, per Trakt's API policy.

**Filmie's own behaviour, which stays**

- **FR-025**: Play, the player, video servers, Recently played and signed-out browsing MUST keep working. These are the only additions to Trakt's design.
- **FR-026**: Watch tracking MUST stay manual. Check-ins and scrobbling MUST NOT be added.
- **FR-027**: The app MUST keep Filmie's name and logo, MUST NOT use Trakt logos or other Trakt brand assets, and MUST keep the "not endorsed or certified by Trakt" sentence.
- **FR-028**: No code, styles, icons or assets may be copied from trakt-web, so Filmie stays MIT.

### Key Entities

- **Media mode**: Media, Shows or Movies. One choice per person, kept on this PC.
- **Filter set**: the active filter values, plus a saved default. Kept on this PC.
- **Row state**: whether each row is collapsed. Kept on this PC.
- **Local history**: the person's watched items with dates and runtimes, from their Trakt account. Deleted on sign-out.
- **Local ratings**: the person's ratings with dates. Deleted on sign-out.
- **Sync position**: how far local history has synced, so it can resume.
- **Stats**: totals and breakdowns worked out from local history and ratings, not stored as a separate source of truth.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Changing Media, Shows or Movies updates every row on the page within 1 second on cached data, and 100% of cards shown match the chosen mode.
- **SC-002**: Side by side with Trakt at the same window size, a reviewer finds no difference from the reference in layout, sizes, type or greys on Home, Discover, a title page and a grid, apart from the accent, name, Play and Recently played.
- **SC-003**: Every filter in the reference that the free API supports is usable, and narrows results in 100% of test combinations.
- **SC-004**: A free account can complete every flow in this spec with no VIP-only or limited-access errors.
- **SC-005**: A person can go from any page to a title's Play button with the keyboard alone, using the palette, in under 10 seconds.
- **SC-006**: Local stats totals match the counts on the person's Trakt account within 1% after a full sync.
- **SC-007**: After the first sync, opening Profile shows stats in under 1 second, online or offline.
- **SC-008**: An hour of normal browsing produces no failed page because of rate limiting.
- **SC-009**: Scenarios from feature 001's quickstart still pass where this spec doesn't replace them, in the real app.
- **SC-010**: A check of the shipped UI finds no file or asset from trakt-web and no Trakt logo.

## Assumptions

- "As is" covers design and behaviour on desktop widths. Filmie's smallest window is 800 px wide, so Trakt's phone layout isn't needed.
- "Everything the free API offers" is read as browsing and tracking, per the user's scope answer. Posting comments, reactions, following people and social feeds are left out, since they are neither. Comments are shown read-only. This can be widened if the user wants.
- Check-ins and scrobbling are free in the API but stay out, because `CLAUDE.md` records manual tracking as a project decision. Trakt's Track control marks an item watched and doesn't check in.
- Play has no equivalent in Trakt's design. It goes first in the action bar, since playing is Filmie's main action.
- Signed-out browsing stays, unlike Trakt, which shows a marketing page, because Filmie's player works without an account.
- Left out because they are VIP only, paid, web-specific or unrelated: Smart Lists unless the classification shows them free, Year in Review, Mixtape, Today, Plex, promotions, the boot splash, seasonal themes, translations.
- Roboto can be bundled with the app, since remote fonts are blocked and its licence allows it.
- Artwork keeps coming from TMDB where it does today, and Trakt's images and colours are used where free and allowed by the app's content rules.
- The person's region for streaming availability comes from the system locale, as it does today.
- This is a large feature. It's expected to be delivered in steps, with a review after each, as 001 was.
