// Browsing pages: Home, Discover, Search.
const comingSoon = title => { app.innerHTML = `<div class="page"><h1 class="sr-only">${esc(title)}</h1><p class="muted">This page is coming in a later step.</p></div>`; };

Object.assign(pages, {
  async home() {
    if (!user) {
      app.innerHTML = `<div class="page"><h1 class="sr-only">Home</h1><section class="callout"><h2>Welcome to Filmie</h2>
        <p>Sign in with Trakt to see your up next, watchlist, lists and recommendations, and track what you watch.</p>
        <a class="btn primary" href="#/settings">Sign in with Trakt</a></section></div>`;
      return renderRows([
        ['Recently played', recentCards],
        ['Trending movies', traktPosters('/movies/trending?limit=30', null, watchers)],
        ['Trending shows', traktPosters('/shows/trending?limit=30', null, watchers)],
        ['Popular movies', traktPosters('/movies/popular?limit=30', 'movie')],
        ['Popular shows', traktPosters('/shows/popular?limit=30', 'show')],
        ['Most anticipated', traktPosters('/movies/anticipated?limit=30', null, anticipated)],
      ], app.firstElementChild);
    }
    app.innerHTML = `<div class="page">${profileHeader()}</div>`;
    await renderRows([
      ['Recently played', recentCards],
      ['Up next', upNextCards, '#/progress'],
      ['Continue watching', playbackCards()],
      ['Watchlist', async () => posters(watchlistItems(['movies', 'shows'])), '#/watchlist'],
      ['Your lists', async () => watchlistTile() + (await traktGet('/users/me/lists').catch(() => [])).map(listTile).join(''), '#/lists'],
      ['Recommended movies', traktPosters('/recommendations/movies?limit=30', 'movie'), '#/discover/recommended'],
      ['Recommended shows', traktPosters('/recommendations/shows?limit=30', 'show'), '#/discover/recommended'],
      ['Trending movies', traktPosters('/movies/trending?limit=30', null, watchers)],
      ['Trending shows', traktPosters('/shows/trending?limit=30', null, watchers)],
    ], app.firstElementChild);
  },

  // shortcut: plain rows for every Discover route, until the full grids arrive.
  async discover(sub) {
    if (sub === 'releases') return comingSoon('Releases');
    if (sub === 'recommended' && !user) { app.innerHTML = signInPrompt('recommendations'); return; }
    const mode = getMode();
    const types = mode === 'media' ? ['movie', 'show'] : [mode];
    const row = (title, path, type, label) => [`${title}${types.length > 1 ? ` ${type}s` : ''}`, traktPosters(`/${type}s/${path}?limit=30`, label ? null : type, label)];
    const charts = {
      trending: t => row('Trending', 'trending', t, watchers),
      anticipated: t => row('Most anticipated', 'anticipated', t, anticipated),
      popular: t => row('Popular', 'popular', t),
    };
    const defs = sub === 'recommended'
      ? types.map(t => [`Recommended${types.length > 1 ? ` ${t}s` : ''}`, traktPosters(`/recommendations/${t}s?limit=30`, t)])
      : Object.entries(charts).filter(([name]) => !sub || name === sub).flatMap(([, chart]) => types.map(chart));
    app.innerHTML = `<div class="page"><h1 class="sr-only">${esc(discoverTitle(sub))}</h1></div>`;
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
      ${items.length ? `<div class="grid">${items.map(it => poster(it, `${it.year ?? ''} · ${it.type === 'tv' ? 'Show' : 'Movie'}`)).join('')}</div>` : '<p class="muted">Nothing found.</p>'}</div>`;
    observeArt(app);
  },
});

const DISCOVER_TITLES = { trending: 'Trending', releases: 'Releases', anticipated: 'Anticipated', popular: 'Popular', recommended: 'Recommended' };
const discoverTitle = sub => DISCOVER_TITLES[sub] ?? { media: 'Discover', show: 'Shows', movie: 'Movies' }[getMode()];

pages.home.bar = { title: 'Home', mode: 'bar', filters: 'global' };
pages.discover.bar = sub => ({ title: discoverTitle(sub), mode: sub && sub !== 'releases' ? 'drawer' : 'bar', filters: sub ? 'local' : 'global' });
pages.search.bar = { title: 'Search' };
