// Browsing pages: Home, Shows, Movies, Search.
Object.assign(pages, {
  async home() {
    if (!user) {
      app.innerHTML = `<div class="page"><section class="callout"><h2>Welcome to Filmie</h2>
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
      ['Up next', upNextCards, '#/shows'],
      ['Continue watching', playbackCards()],
      ['Watchlist', async () => posters(watchlistItems(['movies', 'shows'])), '#/watchlist'],
      ['Your lists', async () => watchlistTile() + (await traktGet('/users/me/lists').catch(() => [])).map(listTile).join(''), '#/lists'],
      ['Recommended movies', traktPosters('/recommendations/movies?limit=30', 'movie'), '#/movies'],
      ['Recommended shows', traktPosters('/recommendations/shows?limit=30', 'show'), '#/shows'],
      ['Trending movies', traktPosters('/movies/trending?limit=30', null, watchers)],
      ['Trending shows', traktPosters('/shows/trending?limit=30', null, watchers)],
    ], app.firstElementChild);
  },

  async shows() {
    app.innerHTML = '<div class="page"><h1>Shows</h1></div>';
    await renderRows([
      user && ['Up next', upNextCards],
      user && ['Continue watching', playbackCards('episode')],
      user && ['On your watchlist', async () => posters(watchlistItems(['shows'])), '#/watchlist'],
      user && ['Recommended for you', traktPosters('/recommendations/shows?limit=30', 'show')],
      ['Trending', traktPosters('/shows/trending?limit=30', null, watchers)],
      ['Popular', traktPosters('/shows/popular?limit=30', 'show')],
      ['Most anticipated', traktPosters('/shows/anticipated?limit=30', null, anticipated)],
    ], app.firstElementChild);
  },

  async movies() {
    app.innerHTML = '<div class="page"><h1>Movies</h1></div>';
    await renderRows([
      user && ['Continue watching', playbackCards('movie')],
      user && ['On your watchlist', async () => posters(watchlistItems(['movies'])), '#/watchlist'],
      user && ['Recommended for you', traktPosters('/recommendations/movies?limit=30', 'movie')],
      ['Trending', traktPosters('/movies/trending?limit=30', null, watchers)],
      ['Popular', traktPosters('/movies/popular?limit=30', 'movie')],
      ['Box office this weekend', traktPosters('/movies/boxoffice', null, x => `$${num(x.revenue)}`)],
      ['Most anticipated', traktPosters('/movies/anticipated?limit=30', null, anticipated)],
    ], app.firstElementChild);
  },

  // Trakt search: exact title matches first, then broader results (Trakt's recommended flow).
  async search(q) {
    const query = decodeURIComponent(q ?? '');
    if (traversing || !query) searchBox.value = query; // otherwise it holds what's being typed right now
    if (!query) { app.innerHTML = '<div class="page"><h1>Search</h1><p class="muted">Find movies and shows by title.</p></div>'; return; }
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
