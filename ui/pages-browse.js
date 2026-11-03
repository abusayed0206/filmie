// Browsing pages: Home, Discover, Search.
// A chart for the current mode. /media/popular has no type on its items, so bare ones fall back to movie.
const chart = (title, path, label, more) => ({
  id: path, title, more, filtered: true, bright: true,
  load: traktPosters(withFilters(`${forMode('/media', '/shows', '/movies')}/${path}?limit=${more ? ROW_ITEMS : 30}&extended=full`), forMode('movie', 'show', 'movie'), label),
});
// Trakt ignores filters on recommendations, so this row doesn't take them.
const recommendedRow = more => ({
  id: 'recommended', title: 'Recommended', more, bright: true,
  load: traktPosters(`${forMode('/media/recommendations', '/recommendations/shows', '/recommendations/movies')}?limit=${more ? ROW_ITEMS : 30}&extended=full`, forMode('movie', 'show', 'movie')),
});
const recentRow = () => ({ id: 'recent', title: 'Recently played', kind: 'landscape', load: recentCards });
const upNextRow = more => getMode() !== 'movie' && { id: 'up-next', title: 'Up next', kind: 'landscape', more, load: upNextCards };
const continueRow = () => ({ id: 'continue', title: 'Continue watching', kind: 'landscape', load: playbackCards(forMode(undefined, 'episode', 'movie')) });

const comingSoon = title => { app.innerHTML = `<div class="page"><h1 class="sr-only">${esc(title)}</h1><p class="muted">This page is coming in a later step.</p></div>`; };

Object.assign(pages, {
  async home() {
    if (!user) {
      app.innerHTML = `<div class="page"><h1 class="sr-only">Home</h1><section class="callout"><h2>Welcome to Filmie</h2>
        <p>Sign in with Trakt to see your up next, watchlist, lists and recommendations, and track what you watch.</p>
        <a class="btn primary" href="#/settings">Sign in with Trakt</a></section></div>`;
      return renderRows([
        recentRow(),
        chart('Trending', 'trending', watchers, '#/discover/trending'),
        chart('Popular', 'popular', null, '#/discover/popular'),
        chart('Most anticipated', 'anticipated', anticipated, '#/discover/anticipated'),
      ], app.firstElementChild);
    }
    app.innerHTML = `<div class="page">${profileHeader()}</div>`;
    await renderRows([
      recentRow(),
      upNextRow('#/progress'),
      continueRow(),
      { id: 'watchlist', title: 'Watchlist', more: '#/watchlist', load: async () => posters(watchlistItems(forMode(['movies', 'shows'], ['shows'], ['movies']))) },
      { id: 'lists', title: 'Your lists', kind: 'list', more: '#/lists', load: async () => watchlistTile() + (await traktGet('/users/me/lists').catch(() => [])).map(listTile).join('') },
      recommendedRow('#/discover/recommended'),
      chart('Trending', 'trending', watchers, '#/discover/trending'),
    ], app.firstElementChild);
  },

  // shortcut: plain rows for every Discover route, until the full grids arrive.
  async discover(sub) {
    if (sub === 'releases') return comingSoon('Releases');
    if (sub === 'recommended' && !user) { app.innerHTML = signInPrompt('recommendations'); return; }
    const charts = {
      trending: () => chart('Trending', 'trending', watchers, !sub && '#/discover/trending'),
      anticipated: () => chart('Most anticipated', 'anticipated', anticipated, !sub && '#/discover/anticipated'),
      popular: () => chart('Popular', 'popular', null, !sub && '#/discover/popular'),
    };
    const defs = sub === 'recommended' ? [recommendedRow(false)] : Object.entries(charts).filter(([name]) => !sub || name === sub).map(([, row]) => row());
    app.innerHTML =`<div class="page"><h1 class="sr-only">${esc(discoverTitle(sub))}</h1></div>`;
    await renderRows(defs, app.firstElementChild);
  },

  // Trakt search: exact title matches first, then broader results (Trakt's recommended flow).
  async search(q) {
    const query = decodeURIComponent(q ?? '');
    if (traversing || !query) searchBox.value = query; // otherwise it holds what's being typed right now
    if (!query) { app.innerHTML = '<div class="page"><h1 class="sr-only">Search</h1><p class="muted">Find movies and shows by title.</p></div>'; return; }
    const enc = encodeURIComponent(query);
    const none = () => [];
    const token = routeToken;
    const [exactM, exactS, broad] = await Promise.all([
      traktGet(`/search/movie/exact?query=${enc}&limit=5`).catch(none),
      traktGet(`/search/show/exact?query=${enc}&limit=5`).catch(none),
      traktGet(`/search/movie,show?query=${enc}&limit=40`),
    ]);
    if (token !== routeToken) return;
    const seen = new Set();
    const exact = it => it.title?.toLowerCase() === query.toLowerCase();
    const items = [...exactM, ...exactS, ...broad].map(x => norm(x)).filter(it => it && !seen.has(it.type + it.id) && seen.add(it.type + it.id))
      .sort((a, b) => exact(b) - exact(a)); // exact endpoints still return near-matches; true title matches go first
    app.innerHTML = `<div class="page"><h1>Results for “${esc(query)}”</h1>
      ${items.length ? `<div class="grid">${items.map(it => posterCard(it, { label: `${it.year ?? ''} · ${it.type === 'tv' ? 'Show' : 'Movie'}` })).join('')}</div>` : '<p class="muted">Nothing found.</p>'}</div>`;
    observeArt(app);
  },
});

const DISCOVER_TITLES = { trending: 'Trending', releases: 'Releases', anticipated: 'Anticipated', popular: 'Popular', recommended: 'Recommended' };
const discoverTitle = sub => DISCOVER_TITLES[sub] ?? { media: 'Discover', show: 'Shows', movie: 'Movies' }[getMode()];

pages.home.bar = { title: 'Home', mode: 'bar', filters: 'global' };
pages.discover.bar = sub => ({
  title: discoverTitle(sub),
  // Trakt's full grids move the switch into the filter drawer and show the mode here instead.
  meta: sub && sub !== 'releases' ? forMode('Media', 'Shows', 'Movies') : '',
  mode: sub && sub !== 'releases' ? 'drawer' : 'bar',
  filters: sub === 'recommended' ? false : sub ? 'local' : 'global',
});
pages.search.bar = { title: 'Search' };
