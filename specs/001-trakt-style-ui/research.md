# Research: Trakt-style, near-native UI

Checked 2026-11-03. Sources pinned at trakt-web `9657257` and trakt-api `090d333`.

## 1. How to get Trakt's UI

- **Decision**: Recreate the layout and interaction patterns in `ui/`, in plain JS and CSS. The user chose this.
- **Rationale**: trakt-web is GPLv3 (`LICENSE`, © Trakt Inc), and Filmie is MIT. Copying its code into a distributed app would pull Filmie under GPLv3. It is also SvelteKit with Bun, Vite, TanStack Query and RxJS, and Filmie has no build step by decision (`docs/PLAN.md` §8).
- **Alternatives rejected**:
  - Port the Svelte code: means a relicense and a full rewrite of `ui/`.
  - Embed app.trakt.tv: separate web sign-in, a looser `on_navigation` lockdown, and no access to Filmie's player or cache.
- **Rule for implementation**: use this file's measurements and the live app as the reference, and write new code. Don't paste from trakt-web. Licensing is not legal advice here; this is the conservative reading.

## 2. Branding

- **Decision**: Trakt's layout, Filmie's name, logo and colours, and no Trakt logo. The user chose this.
- **Rationale**: the [API use policy](https://github.com/trakt/trakt-api/blob/main/projects/developer/src/lib/guides/api-use-policy.md) (updated 2026-10-20) makes the logo optional, forbids building it into your own identity or implying endorsement, and requires the sentence "[App name] uses Trakt but is not endorsed or certified by Trakt". Settings already has that sentence, so nothing changes there. A lookalike could read as official, and Trakt can revoke the client ID.

## 3. What Trakt's desktop layout actually is

Measured on app.trakt.tv at 1280×820 and read from `projects/client/src/style/` and `lib/sections/navbar/`. These are measurements to work from, not values that must match.

| Element | Trakt | Filmie plan |
|---|---|---|
| Side rail | Fixed left, floating with a 12 px margin, 48 px collapsed, 180 px expanded, collapsed by default, state remembered | Same widths and default |
| Rail items | Search, Home, Discover, Lists, with sub-links when expanded; profile at the bottom | Search, Home, Shows, Movies, Lists, with Watchlist as the only sub-link; fullscreen and account at the bottom |
| Search shortcut | Ctrl+K, with a hint in the expanded rail | Same |
| Page gutters | 24 px | Same (`--gutter`, currently 32 px) |
| Card widths | Portrait at least 132 px, up to 10 per row; landscape at least 200 px, up to 7 per row; 12 px gap | Same limits |
| Radii | 12 px on cards | 12 px, up from 10 |
| Skeletons | Solid border colour at 80% with a pulse, off under reduced motion | Same idea |
| Motion | 150 ms and 300 ms steps, all zero under reduced motion | 160 ms cross-fade |
| Title page | Large poster, details, "Where to Watch" column, then Actors, Reviews, Extras, Related | Poster, details, where to watch, then Cast and Related, using data Filmie already fetches |
| Narrow layout | Bottom bar at or below 768 px | Not needed: Filmie's minimum window is 800 px (`main.rs`) |

Not observed: the signed-in Home, because no one signed in during research. The spec's row order stays Filmie's own.

## 4. Whole-card rows

- **Decision**: `.row` becomes an inline-size container, and stepped `@container` rules set `--n` (cards per row) on its `.track`. An element can't query itself, so the container has to be the parent. Card width is `(100% - (n-1) × gap) / n`.
- **Rationale**: pure CSS with no resize listeners, and it responds to rail width changes because it measures the row, not the window. Container queries are in Chromium 105+.
- **Alternatives rejected**:
  - Trakt's own approach of `round()` with length-by-length division relies on newer typed CSS arithmetic. It is more to verify for no user-visible gain.
  - A JS `ResizeObserver`: more code than a few CSS rules.

## 5. Page transitions

- **Decision**: Wrap only the synchronous placeholder swap in `document.startViewTransition`, with a 160 ms root cross-fade. Skip it when entering or leaving `play`, and for soft refreshes. Fall back to a plain swap if the API is absent.
- **Rationale**: [Chrome's guide](https://developer.chrome.com/docs/web-platform/view-transitions/same-document): shipped in Chrome 111; while the update callback's promise is pending "the page is frozen", and fetches should happen before the call. So data must never be awaited inside the callback, which FR-009 requires. WebView2 is evergreen Chromium, so the API should be present, and the fallback covers it if not.
- **Reduced motion**: the API doesn't honour it automatically, so CSS sets `animation: none` on the `::view-transition-*` pseudo-elements.
- **Alternatives rejected**: `.page` CSS fade classes, which can't cross-fade old and new content without keeping both in the DOM.
- **Clicks during the fade**: `::view-transition { pointer-events: none; }` lets clicks through the overlay rather than relying on the fade being short.
- **Ordering**: the callback runs after a later frame, so a page must not start rendering until `updateCallbackDone` resolves, or the placeholder would overwrite it.

## 6. Scroll restoration

- **Decision**: Use the [Navigation API](https://developer.mozilla.org/en-US/docs/Web/API/NavigateEvent/navigationType). A `navigate` listener records `navigationType` and saves `scrollY` under `navigation.currentEntry.key`. `route()` restores the saved value after the page finishes loading when the type was `traverse`, and otherwise starts at 0. Set `history.scrollRestoration = 'manual'`.
- **Rationale**: `hashchange` can't distinguish Back from a link click. The entry key also tells apart two visits to the same URL. MDN lists the API as Baseline 2026, and it is a single listener. Chromium is the only engine that matters here.
- **Alternatives rejected**:
  - Keying on the URL: returning to a page through a fresh link would wrongly restore.
  - Custom `history.state`: more code, and hash navigation creates entries with null state.
- **Checked 2026-11-03 in a Chromium page running the app with a mocked backend**: a hash link click and `location.hash` report `push`, `history.back()` reports `traverse`, and `hashChange` is true for all three. Not yet confirmed in WebView2 itself, which is the same engine.

## 7. Refreshes that don't disturb the page

- **Finding**: `route()` currently resets scroll and blanks the page on every call. This hits the watchlist and watched buttons on the title page (`ui/app.js:666-667`), background sync (`ui/app.js:140`), and saving servers.
- **Decision**: a `soft` option on `route()` that skips the placeholder, animation and scroll reset, and restores `scrollY` afterwards. `hashchange` passes an Event as the first argument today, so the listener must be wrapped.
- **Rationale**: one option covers all the callers, with no per-page partial rendering.

## 8. Window chrome

- **Decision**: Add `.background_color(...)` and `.theme(Some(Theme::Dark))` to the `WebviewWindowBuilder` in `main.rs`. Keep the standard title bar.
- **Rationale**: both are in [the Tauri 2 builder](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindowBuilder.html). `theme` "forces a theme". This removes the white flash and a light title bar on a light Windows theme. Docs list no minimum version for these, so check that it compiles against the locked `tauri` version.
- **Alternatives rejected**: a custom title bar needs `decorations(false)`, drag regions, new capability permissions and a rebuild of snap layouts. It would cost a lot for a little.

## 9. Browser leftovers

- **Decision**: a `contextmenu` listener that allows only text fields and selected text, plus `user-select: none` on chrome.
- **Not doing**: disabling `AreBrowserAcceleratorKeysEnabled` ([WebView2 settings](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/winrt/microsoft_web_webview2_core/corewebview2settings)). It is not exposed by the Tauri builder and would need `with_webview` plus a new `webview2-com` dependency. Reload and Find keep working, and neither loses data. Mark this with a `shortcut:` comment in `main.rs` when the window code is touched, so it is findable later.

## 10. Search box

- **Decision**: Keep the single `#q` input in `index.html`, outside `#app`, in a bar shown only on the search page.
- **Rationale**: `route()` rewrites `#app` on each query, which would destroy an input living there and lose focus mid-typing. The existing debounce logic stays as it is.

## Resolved unknowns

All Technical Context items are resolved. Two facts need a check in the real app, noted in sections 5 and 6 and listed in [quickstart.md](quickstart.md).
