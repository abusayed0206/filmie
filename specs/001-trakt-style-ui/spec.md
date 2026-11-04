# Feature Specification: Trakt-style, near-native UI

**Feature Branch**: `001-trakt-style-ui`

**Created**: 2026-11-03

**Status**: Draft

**Input**: User description: "I want to add the near native UI from TRAKT! Here the trakt repo if needed: https://github.com/trakt/trakt-web"

**Decided with the user (2026-11-03)**:

- **Approach**: recreate Trakt's layout and interaction patterns in Filmie's own UI. Nothing is copied from trakt-web.
- **Identity**: Trakt's layout with Filmie's brand. Filmie keeps its name, logo and colours.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Navigate from a Trakt-style side rail (Priority: P1)

A person using Filmie moves around the app from a slim rail on the left of the window, the way they do in Trakt, rather than from a header across the top. The rail can be widened to show labels, and it stays the way they left it.

**Why this priority**: The rail is the most visible difference between Filmie and Trakt, and it frees vertical space for content. Every other story sits inside it.

**Independent Test**: Launch the app, visit each destination from the rail, widen and narrow the rail, restart the app. All pages remain reachable and the rail width is remembered.

**Acceptance Scenarios**:

1. **Given** the app has just been opened for the first time, **When** any page shows, **Then** a narrow icon rail is at the left and there is no header across the top.
2. **Given** the narrow rail, **When** the person hovers or keyboard-focuses an icon, **Then** that destination's name appears.
3. **Given** the narrow rail, **When** the person presses the menu button, **Then** the rail widens to show labels, the content area shrinks to fit, and the choice survives a restart.
4. **Given** any page, **When** the person presses Ctrl+K, **Then** they land on search with the search box focused and can start typing at once.
5. **Given** the person is on a list or the watchlist, **When** they look at the rail, **Then** Lists is marked as the current destination.
6. **Given** the player is open, **When** it is showing, **Then** the rail is hidden and the video keeps its full area.
7. **Given** the person is signed out, **When** they look at the bottom of the rail, **Then** they can reach sign-in; when signed in, they see their avatar and can reach Settings.

---

### User Story 2 - Moving around feels like a native app (Priority: P1)

Moving between pages feels like a desktop app rather than a web page. Content does not flash a "Loading…" line, pages cross-fade, Back returns to the same scroll position, and pressing a button on a page does not throw the person to the top.

**Why this priority**: This is the "near native" half of the request, and it is worth having even before the visual restyle lands.

**Independent Test**: Open a title from far down a row page, press Back, and check the position. Add a title to the watchlist while scrolled down. Throttle nothing and watch for flashes when moving between cached pages.

**Acceptance Scenarios**:

1. **Given** a page is loading, **When** content is not ready yet, **Then** placeholder shapes matching that page's layout show instead of a "Loading…" line.
2. **Given** the person scrolled down a page and opened a title, **When** they go Back (button, Alt+Left, or mouse back button), **Then** the earlier page returns at the same scroll position.
3. **Given** the person follows a link to a new page, **When** it opens, **Then** it starts at the top.
4. **Given** the person is scrolled down a title page, **When** they change watchlist or watched state, **Then** the page updates without moving and without showing placeholders.
5. **Given** Trakt reports a change during a background sync while the person is reading a page, **When** the page refreshes, **Then** it does so without a flash or a scroll jump.
6. **Given** the person has asked the system to reduce motion, **When** they change pages, **Then** pages switch without animation and placeholders do not pulse.
7. **Given** the app window opens, **When** it first paints, **Then** there is no white flash and the title bar is dark, regardless of the Windows theme.
8. **Given** a right-click on the app's own pages, **When** the target is not a text field or selected text, **Then** no browser context menu appears.

---

### User Story 3 - Cards, rows and title pages look like Trakt (Priority: P2)

Rows of posters fill the width with evenly sized cards. Title pages follow Trakt's layout: poster, details and where-to-watch side by side, then cast with faces, then related titles. The colours and name remain Filmie's.

**Why this priority**: This completes the look, but it depends on the shell from Story 1 and has value only after it.

**Independent Test**: Resize the window from 800 px wide to a maximized 4K window on Home and on a title page. Rows show only whole cards at rest, and the title page rearranges without overlap.

**Acceptance Scenarios**:

1. **Given** any row, **When** the window or rail width changes, **Then** cards resize so that a whole number of cards fits the row at its starting position.
2. **Given** a row with a "See all" destination, **When** the person looks at its heading, **Then** the heading itself is the link, with a chevron.
3. **Given** a title with streaming data for the person's region, **When** its page shows on a wide window, **Then** where-to-watch sits in its own column beside the details.
4. **Given** a title with cast data, **When** its page shows, **Then** cast is a scrolling row of faces with names and character names.
5. **Given** the finished UI, **When** it is compared with Trakt, **Then** no Trakt logo or other Trakt brand asset appears and Filmie's name and colours are used throughout. The existing "not endorsed or certified by Trakt" statement stays in Settings.

---

### Edge Cases

- A row that turns out empty, or fails, disappears after showing placeholders. Rows below move up, and a restored scroll position is applied after this settles.
- Back to a page whose content has changed or shortened: the scroll position is clamped to what exists.
- Rapid navigation: results from a page the person has left are dropped, and only the latest page animates.
- Offline, or a failed fetch: the page shows the existing error text in place of the placeholders.
- A slow page must never freeze the window while waiting for data; the placeholders appear first.
- Entering or leaving the player: no page animation, so the video frame is never captured or covered.
- A title with no streaming data for the region, no cast, or no poster: that column or row is left out and the layout closes up.
- Long titles and names truncate, and a long username fits the widened rail.
- The smallest allowed window (800 px wide) with the rail widened still shows at least two cards per row.
- Right-click inside the video frame belongs to the third-party page and is unaffected.
- The saved rail preference is unreadable or unavailable: the rail starts narrow.

## Requirements *(mandatory)*

### Functional Requirements

**Shell**

- **FR-001**: The app MUST present navigation in a fixed rail on the left of the window and MUST NOT show the top header.
- **FR-002**: The rail MUST offer Search, Home, Shows, Movies and Lists, with Watchlist under Lists when widened, and a bottom area holding fullscreen and account or sign-in.
- **FR-003**: The rail MUST start narrow, showing icons only, and MUST let the person widen it to show labels. The choice MUST persist across restarts.
- **FR-004**: Every rail item MUST have an accessible name, a visible name on hover and keyboard focus when narrow, and a visible focus state. The current destination MUST be exposed to assistive technology.
- **FR-005**: Ctrl+K MUST open search with the box focused from any page except the player. Search MUST work as it does today: as-you-type, and clearing it returns Home.
- **FR-006**: The rail MUST be hidden while the player is open. The player's toolbar and video area MUST behave exactly as before.

**Navigation feel**

- **FR-007**: The app MUST replace the "Loading…" line with placeholders matching the shape of the page being loaded, and rows MUST show placeholder cards until their content arrives.
- **FR-008**: Page changes MUST cross-fade briefly, except when entering or leaving the player. If the runtime cannot animate them, pages MUST still change.
- **FR-009**: Waiting for data MUST NOT block the window or the animation.
- **FR-010**: History traversal (Back or Forward) MUST restore the scroll position of that history entry. Any other navigation MUST start at the top.
- **FR-011**: Refreshes caused by the person's own actions on the page, or by background sync, MUST keep the scroll position and MUST NOT show placeholders or animate.
- **FR-012**: The app MUST honour the system's reduced-motion preference for page changes, placeholders and hover movement.
- **FR-013**: The app window MUST open with Filmie's dark background and a dark title bar.
- **FR-014**: The browser context menu MUST NOT appear on the app's own pages, except on text fields and selected text. Interface chrome (rail, buttons, card labels) MUST NOT be text-selectable, while reading text such as overviews MUST remain selectable.
- **FR-015**: After a page change, keyboard focus MUST move to the main content area so that keyboard users continue from the new page.

**Visual layout**

- **FR-016**: Rows MUST size their cards from the available width so that a whole number of cards fits, for portrait and landscape cards alike, in any window size the app allows.
- **FR-017**: Row headings with a "See all" destination MUST link from the heading itself.
- **FR-018**: Title pages MUST use a three-part layout on wide windows (poster, details, where-to-watch), falling back to fewer columns as the window narrows.
- **FR-019**: Title pages MUST show cast as a row of cards with a face, name and character, using a neutral placeholder when there is no photo.
- **FR-020**: All existing pages MUST adopt the same spacing, radius and card styles. No existing feature may be removed.

**Identity and licensing**

- **FR-021**: The UI MUST keep Filmie's name, logo and colour palette, and MUST NOT include Trakt logos or other Trakt brand assets.
- **FR-022**: The UI MUST NOT contain code, styles, icons or other assets copied from trakt-web, so Filmie's MIT licence is unaffected.
- **FR-023**: The statement "Filmie uses Trakt but is not endorsed or certified by Trakt" MUST remain in Settings.

**Unchanged behaviour**

- **FR-024**: Watch tracking MUST stay manual: nothing in this feature may send anything to Trakt without the person pressing a control.

### Key Entities

- **Rail preference**: whether this person's rail is narrow or wide, kept on this PC.
- **Scroll memory**: the scroll position of each history entry visited during the current run of the app. Not saved after the app closes.

No synced or server data changes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Going Back from a title page returns to within 1 pixel of the earlier scroll position once the page has finished loading, in 10 out of 10 tries on cached pages.
- **SC-002**: "Loading…" text never appears during navigation on any page.
- **SC-003**: Placeholders or content appear in the first painted frame after a click, and page changes finish animating within 200 ms.
- **SC-004**: A watchlist or watched change on a title page leaves the scroll position unchanged.
- **SC-005**: At every width from 800 px to a maximized 4K window, rows show only whole cards at their starting position, at least two per row.
- **SC-006**: Every destination is reachable by keyboard alone, and with reduced motion on, no page-change or placeholder animation plays.
- **SC-007**: A search of the shipped UI finds no file or asset from trakt-web and no Trakt logo.
- **SC-008**: Vertical space available to content increases by the height of the removed header at the same window size.

## Assumptions

- "Near native" means a desktop-app feel inside the existing window, including the standard Windows title bar, which keeps snap layouts and window controls. A custom title bar is out of scope.
- "Trakt UI" means the signed-in app at app.trakt.tv, using its desktop layout. The smallest Filmie window is 800 px wide, above the width where Trakt switches to a bottom bar, so no phone-style navigation is needed.
- Filmie's current routes stay as they are, and no new destinations are added.
- **Out of scope**, each a separate feature if wanted later: calendar, Discover and drill-down pages, people pages, comments and reactions, filters, collapsible rows, quick actions on cards, swipe gestures, theming and light mode, seasonal themes, translations.
- The player's own controls and the third-party page inside it are untouched.
