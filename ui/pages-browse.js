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
const continueRow = () => ({
  id: 'continue', title: 'Continue Watching', kind: 'landscape', more: '#/progress', empty: 'Nothing in progress. Start something and it will show here.',
  load: async () => (await loadContinue(ROW_ITEMS)).map(continueCard).join(''),
});
const startRow = () => ({
  id: 'start', title: 'Start Watching', more: '#/watchlist', empty: 'Add something to your watchlist and it will show here.',
  load: async () => startWatching(await traktGet(`/sync/watchlist/${forMode('movie,show', 'shows', 'movies')}/released/asc?limit=100&extended=full`), isoDate(), nextEps).map(startCard).join(''),
});
// Premieres and finales only exist for shows.
let calendarKind = 'all';
const calendarRow = () => {
  const kind = getMode() === 'movie' ? 'all' : calendarKind;
  const path = kind === 'all' ? forMode('media', 'shows', 'movies') : `shows/${kind}`;
  return {
    id: 'calendar', title: 'Calendar', kind: 'landscape', more: '#/calendar', filtered: true, empty: 'Nothing coming up in the next two weeks.',
    actions: getMode() === 'movie' ? '' : segmented('calendar-kind', [{ value: 'all', label: 'All' }, { value: 'premieres', label: 'Premieres' }, { value: 'finales', label: 'Finales' }], kind,
      v => { calendarKind = v; route({ soft: true }); }, 'Calendar type'),
    load: async () => (await traktGet(withFilters(`/calendars/my/${path}/${isoDate()}/14`))).slice(0, ROW_ITEMS).map(calendarCard).join(''),
  };
};
const historyRow = () => ({
  id: 'history', title: 'History', kind: 'landscape', more: '#/history', empty: 'What you watch will show here.',
  load: async () => (await traktGet(`/sync/history${forMode('', '/episodes', '/movies')}?limit=${ROW_ITEMS}&extended=full`)).map(historyCard).join(''),
});
const releasesRow = () => ({
  id: 'releases', title: 'Releases', kind: 'landscape', more: '#/discover/releases', filtered: true, bright: true,
  load: async () => (await traktGet(withFilters(`/calendars/all/${forMode('media', 'shows', 'movies')}/${isoDate()}/30`))).slice(0, ROW_ITEMS).map(calendarCard).join(''),
});

// The other free charts. Trakt has no Media version of these, so Media mode shows a row for each type.
function chartRows(id, title, path, label) {
  return forMode(['movies', 'shows'], ['shows'], ['movies']).map(t => ({
    id: `${id}-${t}`, title: getMode() === 'media' ? `${title} ${t}` : title, filtered: true, bright: true,
    load: traktPosters(withFilters(`/${t}/${path}?limit=30&extended=full`), t === 'movies' ? 'movie' : 'show', label),
  }));
}

// A full page of one chart, as summary cards. Trakt ignores `page` on recommendations.
const DISCOVER_GRIDS = {
  trending: { path: 'trending', label: watchers, filtered: true },
  anticipated: { path: 'anticipated', label: anticipated, filtered: true },
  popular: { path: 'popular', filtered: true },
  recommended: { recommended: true },
};
function discoverGrid(sub, into) {
  const { path, label, filtered, recommended } = DISCOVER_GRIDS[sub];
  const type = forMode('movie', 'show', 'movie');
  const url = page => recommended
    ? `${forMode('/media/recommendations', '/recommendations/shows', '/recommendations/movies')}?limit=100&extended=full`
    : withFilters(`${forMode('/media', '/shows', '/movies')}/${path}?page=${page}&limit=100&extended=full`);
  return renderGrid(into, {
    cls: 'summary-grid', filtered,
    load: async page => (recommended && page > 1 ? [] : await traktGet(url(page))),
    card: x => { const it = norm(x, type); return it ? summaryCard(it, { label: label?.(x) }) : ''; },
  });
}

// Releases as a calendar: landscape cards under a heading for each day.
const RELEASE_KINDS = [{ value: 'all', label: 'All' }, { value: 'new', label: 'New shows' }, { value: 'premieres', label: 'Premieres' }, { value: 'finales', label: 'Finales' }];
let releasesKind = 'all';
async function releasesPage(into) {
  const kind = getMode() === 'movie' ? 'all' : releasesKind;
  const path = kind === 'all' ? forMode('media', 'shows', 'movies') : `shows/${kind}`;
  if (getMode() !== 'movie') into.insertAdjacentHTML('beforeend', `<div class="page-tools">${segmented('release-kind', RELEASE_KINDS, kind, v => { releasesKind = v; route({ soft: true }); }, 'Release type')}</div>`);
  const all = (await traktGet(withFilters(`/calendars/all/${path}/${isoDate()}/30`))).sort(byAirDate);
  // Calendars ignore paging and can return over a thousand items, so this hands them out a screen at a time.
  return renderGrid(into, {
    cls: 'landscape-grid', filtered: true, empty: 'No releases in the next 30 days.', pageSize: 60,
    load: async page => all.slice((page - 1) * 60, page * 60),
    card: dayHeadings(calendarCard),
  });
}

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
    const token = routeToken;
    const stats = await invoke('stats', { kind: null }).catch(() => null);
    if (token !== routeToken) return;
    app.innerHTML = '<div class="page"><h1 class="sr-only">Home</h1></div>';
    const rows = renderRows([continueRow(), startRow(), calendarRow(), recommendedRow('#/discover/recommended'), historyRow(), recentRow()], app.firstElementChild);
    // The rows' sections exist by now, even though their contents are still loading.
    app.querySelector('[data-row="calendar"]').insertAdjacentHTML('beforebegin', streakCallout(stats?.days ?? []));
    await rows;
  },

  async discover(sub) {
    if (sub === 'recommended' && !user) { app.innerHTML = signInPrompt('recommendations'); return; }
    app.innerHTML = `<div class="page"><h1 class="sr-only">${esc(discoverTitle(sub))}</h1></div>`;
    const into = app.firstElementChild;
    if (sub === 'releases') return releasesPage(into);
    if (Object.hasOwn(DISCOVER_GRIDS, sub ?? '')) return discoverGrid(sub, into);
    await renderRows([
      chart('Trending', 'trending', watchers, '#/discover/trending'),
      releasesRow(),
      chart('Anticipated', 'anticipated', anticipated, '#/discover/anticipated'),
      chart('Popular', 'popular', null, '#/discover/popular'),
      ...chartRows('watched', 'Most watched', 'watched/weekly', x => `${num(x.watcher_count)} watchers`),
      ...chartRows('played', 'Most played', 'played/weekly', x => `${num(x.play_count)} plays`),
      ...chartRows('collected', 'Most collected', 'collected/weekly', x => `${num(x.collected_count)} collected`),
      ...chartRows('favorited', 'Most favorited', 'favorited/weekly', x => `${num(x.user_count)} favorites`),
      getMode() !== 'show' && { id: 'boxoffice', title: 'Box office', bright: true, load: traktPosters('/movies/boxoffice', 'movie', x => `$${num(x.revenue)}`) },
    ], into);
  },

  async search(q) {
    const query = decodeURIComponent(q ?? '');
    if (traversing || !query || !searchBox.value) searchBox.value = query; // otherwise it holds what's being typed right now
    const mode = getSearchMode();
    searchBox.placeholder = SEARCH_PLACEHOLDERS[mode];
    searchBox.setAttribute('aria-label', SEARCH_PLACEHOLDERS[mode]);
    app.innerHTML = `<div class="page"><h1 class="sr-only">${query ? `Results for ${esc(query)}` : 'Search'}</h1></div>`;
    const into = app.firstElementChild;
    return query ? searchResults(into, query, mode) : searchEmpty(into, mode);
  },
});

const SEARCH_PLACEHOLDERS = { media: 'Search movies and shows', show: 'Search shows', movie: 'Search movies', person: 'Search people', list: 'Search lists' };
const SEARCH_PAGE = 40;
const publicListTile = l => l?.ids?.trakt ? listTile(l, `#/list/${+l.ids.trakt}/public`) : '';
// Trakt has no photos we can load, so this asks TMDB for one when the card comes near the screen.
const searchPersonCard = p => p?.ids?.tmdb ? `<div class="media-card"><a class="person" href="#/person/${+p.ids.tmdb}" data-type="person" data-id="${+p.ids.tmdb}" title="${esc(p.name)}"><div class="art">${icon('user')}</div><b>${esc(p.name)}</b>${p.known_for_department ? `<span>${esc(statusText(p.known_for_department))}</span>` : ''}</a></div>` : '';

function searchResults(into, query, mode) {
  const enc = encodeURIComponent(query);
  const page = (type, n) => traktGet(`/search/${type}?query=${enc}&page=${n}&limit=${SEARCH_PAGE}&extended=full`);
  const empty = `Nothing found for “${query}”.`;
  if (mode === 'person' || mode === 'list') {
    return renderGrid(into, {
      cls: mode === 'list' ? 'list-grid' : '', empty, pageSize: SEARCH_PAGE,
      load: n => page(mode, n),
      card: x => mode === 'list' ? publicListTile(x.list) : searchPersonCard(x.person),
    });
  }
  // Exact title matches first, then broader results, as Trakt recommends. A title can come back from both.
  const seen = new Set();
  return renderGrid(into, {
    empty, pageSize: SEARCH_PAGE,
    load: async n => {
      const broad = await page({ media: 'movie,show', show: 'show', movie: 'movie' }[mode], n);
      if (n > 1) return broad;
      const exact = await Promise.all({ media: ['movie', 'show'], show: ['show'], movie: ['movie'] }[mode].map(t => traktGet(`/search/${t}/exact?query=${enc}&limit=5&extended=full`).catch(() => [])));
      return exactFirst([...exact.flat(), ...broad], query);
    },
    card: x => {
      const it = norm(x);
      if (!it || seen.has(it.type + it.id)) return '';
      seen.add(it.type + it.id);
      return posterCard(it);
    },
  });
}

// What an empty search box shows: what others are searching for, or popular lists.
// shortcut: no Birthdays This Month for People, because the free API has no route for it. Upgrade if Trakt adds one.
function searchEmpty(into, mode) {
  const top = type => traktGet(`/search/recent_by_id/global/${type}?limit=30&extended=full`).catch(() => []);
  into.insertAdjacentHTML('beforeend', `<h2 class="search-heading">${mode === 'list' ? 'Popular Lists' : 'Top Searches'}</h2>`);
  const grid = { pageSize: Infinity, empty: 'Nothing to show right now. Type above to search.' };
  if (mode === 'list') return renderGrid(into, { ...grid, cls: 'list-grid', load: () => traktGet('/lists/popular?limit=30').catch(() => []), card: x => publicListTile(x.list) });
  if (mode === 'person') return renderGrid(into, { ...grid, load: () => top('people'), card: x => searchPersonCard(x.person) });
  return renderGrid(into, {
    ...grid,
    load: async () => (await Promise.all({ media: ['movies', 'shows'], show: ['shows'], movie: ['movies'] }[mode].map(top))).flat(),
    card: x => { const it = norm(x); return it ? posterCard(it) : ''; },
  });
}

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
pages.search.bar = { title: 'Search', mode: 'search' };
