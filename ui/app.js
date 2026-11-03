const { invoke } = window.__TAURI__.core;
const main = document.getElementById('app');
let app = main; // where pages render; a soft refresh points this at a hidden copy
const IMG = 'https://image.tmdb.org/t/p/';

// Rust caches responses in SQLite, so this only shares requests that are already in flight.
const inFlight = new Map();
function once(key, start) {
  if (!inFlight.has(key)) inFlight.set(key, start().finally(() => inFlight.delete(key)));
  return inFlight.get(key);
}
const tmdb = (path, query) => once(`tmdb ${path}${JSON.stringify(query ?? {})}`, () => invoke('tmdb', { path, query }));
const traktGet = path => once(`trakt ${path}`, () => invoke('trakt', { method: 'GET', path, body: null }));
const trakt = (method, path, body) => invoke('trakt', { method, path, body });

let user = null;      // Trakt /users/settings, null when signed out
let lib = null;       // Trakt library mirror from `sync`
let avatarUrl = null; // blob: URL of the cached Trakt avatar
let routeToken = 0;   // ignores async results that arrive after the page changed
let nowPlaying = null; // { entry, runtime } while the player is open

// ---------- helpers
const traktType = type => type === 'tv' ? 'show' : 'movie';
const ids = id => ({ ids: { tmdb: +id } });
const yearOf = d => (d.release_date ?? d.first_air_date ?? '').slice(0, 4);
const num = n => (n ?? 0).toLocaleString();
const icon = name => `<svg class="i" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const fsButton = `<button class="icon-btn ghost fs-btn" title="Fullscreen (F11)" aria-label="Toggle fullscreen">
  <svg class="i fs-on" aria-hidden="true"><use href="#i-expand"/></svg><svg class="i fs-off" aria-hidden="true"><use href="#i-shrink"/></svg></button>`;

// Runs a button's action with the button disabled; errors go to the toast.
const busy = (el, fn) => el && (el.onclick = async () => { el.disabled = true; try { await fn(); } catch (e) { toast(e); } el.disabled = false; });

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = String(msg);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 5000);
}

function getSources() {
  try {
    const saved = localStorage.getItem('sources');
    return saved === null ? DEFAULT_SOURCES : JSON.parse(saved);
  } catch { return []; }
}
function getServer(count) {
  try { return Math.min(+localStorage.getItem('server') || 0, count - 1); } catch { return 0; }
}
const setServer = i => { try { localStorage.setItem('server', i); } catch {} };
const setSources = list => localStorage.setItem('sources', JSON.stringify(list));
function getQuality() {
  try { return qualityOf(localStorage.getItem('quality')); } catch { return '1080p'; }
}
const setQuality = q => { try { localStorage.setItem('quality', qualityOf(q)); } catch {} };
// Per-server design is optional; invalid saved values fall back to the app theme.
const accentOf = s => /^#[0-9a-f]{6}$/i.test(s?.accent ?? '') ? s.accent : null;
const closeMenus = except => document.querySelectorAll('.server-picker, .episode-picker').forEach(p => {
  if (p === except) return;
  p.querySelector('.server-menu, .episode-menu').hidden = true;
  p.querySelector('[aria-haspopup="true"]').setAttribute('aria-expanded', 'false');
});
document.addEventListener('click', ev => closeMenus(ev.target.closest('.server-picker, .episode-picker')));
// Clicks inside the video iframe never reach this page; they only show up as focus moving to the iframe.
window.addEventListener('blur', () => { if (document.activeElement?.tagName === 'IFRAME') closeMenus(); });
document.addEventListener('keydown', ev => {
  if (ev.key !== 'Escape') return;
  if (!document.querySelector('.server-menu:not([hidden]), .episode-menu:not([hidden])')) return;
  ev.stopImmediatePropagation(); // Escape closes the menu first; another press leaves fullscreen
  closeMenus();
});

// ---------- fullscreen: F11, the fullscreen buttons, and the player's own fullscreen button fill the screen
const appWindow = window.__TAURI__.window.getCurrentWindow();
let fullscreenByPlayer = false; // the window went fullscreen because the player iframe asked for it
async function setFullscreen(on) {
  await appWindow.setFullscreen(on);
  document.body.classList.toggle('fullscreen', on);
}
const toggleFullscreen = () => appWindow.isFullscreen().then(on => setFullscreen(!on)).catch(toast);
document.addEventListener('click', ev => { if (ev.target.closest('.fs-btn')) toggleFullscreen(); });
document.addEventListener('keydown', ev => {
  if (ev.key === 'F11') { ev.preventDefault(); toggleFullscreen(); }
  else if (ev.key === 'Escape' && document.body.classList.contains('fullscreen') && !document.fullscreenElement) setFullscreen(false).catch(toast);
});
document.addEventListener('fullscreenchange', async () => {
  const el = !!document.fullscreenElement;
  if (el && !(await appWindow.isFullscreen())) { fullscreenByPlayer = true; await setFullscreen(true); }
  else if (!el && fullscreenByPlayer) { fullscreenByPlayer = false; await setFullscreen(false); }
});

// ---------- recently played: local progress, reported by the script injected into the player's frames
const savePlayed = () => nowPlaying && invoke('history_save', { entry: nowPlaying.entry }).catch(console.warn);
window.addEventListener('message', ev => {
  const progress = nowPlaying && validProgress(ev.data?.__filmieProgress, nowPlaying.runtime);
  if (!progress) return;
  nowPlaying.entry.position = progress.t;
  nowPlaying.entry.duration = progress.d;
  savePlayed();
});

// ---------- Trakt library lookups (TMDB ids)
const watchedMovie = id => lib?.watched_movies?.some(m => m.movie.ids.tmdb === id);
const watchedShow = id => lib?.watched_shows?.find(x => x.show.ids.tmdb === id);
const inWatchlist = (tt, id) => lib?.[`watchlist_${tt}s`]?.some(x => x[tt].ids.tmdb === id);
const myRating = (tt, id) => lib?.[`ratings_${tt}s`]?.find(x => x[tt].ids.tmdb === id)?.rating;
const watchlistItems = types => types.flatMap(t => lib?.[`watchlist_${t}`] ?? [])
  .sort((a, b) => (b.listed_at ?? '').localeCompare(a.listed_at ?? ''));

// Trakt's own "next episode" per show in progress. /sync/watched no longer includes episodes.
let upNext = [];         // progress items, most recently watched first
let nextEps = new Map(); // show TMDB id -> [season, episode]
async function refreshProgress() {
  const items = user ? await trakt('GET', '/sync/progress/watched?hide_completed=true&limit=100', null) : [];
  upNext = items.filter(p => p.progress?.next_episode && p.progress.last_watched_at && p.show?.ids?.tmdb)
    .sort((a, b) => b.progress.last_watched_at.localeCompare(a.progress.last_watched_at));
  nextEps = new Map(upNext.map(p => [p.show.ids.tmdb, [p.progress.next_episode.season, p.progress.next_episode.number]]));
}

async function refreshUser() {
  user = await invoke('status');
  lib = user ? await invoke('library') : null;
  if (user && !lib?.activities) lib = await invoke('sync'); // first sign-in: no local copy to draw from yet
  await refreshProgress().catch(console.warn);
  if (avatarUrl) URL.revokeObjectURL(avatarUrl);
  avatarUrl = null;
  const url = user?.user?.images?.avatar?.full;
  if (url) avatarUrl = await invoke('avatar', { url }).then(b => URL.createObjectURL(new Blob([b])), () => null);
  const account = document.getElementById('account');
  account.innerHTML = user ? `${avatar('small')}<span class="nav-label">${esc(user.user.username)}</span>` : `${icon('user')}<span class="nav-label">Sign in &amp; settings</span>`;
}

// Checks Trakt in the background. A change refreshes the page unless that would interrupt the user.
async function syncInBackground() {
  if (!user) return;
  const before = lib?.activities?.all;
  lib = await invoke('sync');
  if (lib?.activities?.all === before) return;
  await refreshProgress();
  if (!nowPlaying && !location.hash.startsWith('#/settings')) route({ soft: true }); // Settings may hold a half-typed server
}

function avatar(size) {
  return avatarUrl ? `<img class="avatar ${size}" src="${avatarUrl}" alt="">`
    : `<span class="avatar ${size}" aria-hidden="true">${esc((user?.user?.username ?? '?')[0].toUpperCase())}</span>`;
}

// Every Trakt write re-syncs so the mirror always matches Trakt.
async function write(path, body) {
  await trakt('POST', path, body);
  lib = await invoke('sync');
}

const episodeBody = (id, s, e) => ({ shows: [{ ...ids(id), seasons: [{ number: +s, episodes: [{ number: +e }] }] }] });

// Fills a <select> with the user's own Trakt lists; picking one adds the movie or show to it.
async function listPicker(el, tt, id) {
  if (!el) return;
  const lists = await traktGet('/users/me/lists').catch(() => []);
  el.innerHTML = `<option value="">Add to list…</option>${lists.map(l => `<option value="${l.ids.trakt}">${esc(l.name)}</option>`).join('')}`;
  el.hidden = !lists.length;
  el.onchange = async () => {
    const list = lists.find(l => String(l.ids.trakt) === el.value);
    el.value = '';
    if (!list) return;
    el.disabled = true;
    try {
      const r = await trakt('POST', `/users/me/lists/${list.ids.trakt}/items`, { [`${tt}s`]: [ids(id)] });
      toast(`${r?.added?.[`${tt}s`] ? 'Added to' : 'Already in'} ${list.name}`);
    } catch (e) { toast(e); }
    el.disabled = false;
  };
}

// Where "Play" goes: a movie, or the next unwatched episode of a show (S1E1 when new).
function playHref(type, id) {
  if (type === 'movie') return `#/play/movie/${id}`;
  const [s, e] = nextEps.get(id) ?? [1, 1];
  return `#/play/tv/${id}/${s}/${e}`;
}

// ---------- cards
function poster(it, label) {
  const tt = traktType(it.type);
  const seen = it.type === 'movie' ? watchedMovie(it.id) : !!watchedShow(it.id);
  const rating = myRating(tt, it.id);
  return `<a class="poster" href="#/title/${it.type}/${it.id}" data-type="${it.type}" data-id="${it.id}">
    <div class="art"><div class="tags">${seen ? '<i class="tag seen" title="Watched">✓</i>' : ''}${inWatchlist(tt, it.id) ? '<i class="tag" title="On your watchlist">WL</i>' : ''}${rating ? `<i class="tag" title="Your rating">♥ ${rating}</i>` : ''}</div></div>
    <b>${esc(it.title)}</b><span>${esc(label ?? it.year ?? '')}</span></a>`;
}
const posters = (items, type, label) => (items ?? []).map(x => [norm(x, type), x]).filter(([it]) => it).map(([it, x]) => poster(it, label?.(x))).join('');
const traktPosters = (path, type, label) => async () => posters(await traktGet(path), type, label);

function progressCard(href, it, line, pct, note) {
  return `<a class="ep-card" href="${href}" data-type="${it.type}" data-id="${it.id}" data-art="backdrop">
    <div class="art"><span class="play-icon">${icon('play')}</span></div>
    <b>${esc(it.title)}</b><span>${esc(line)}</span>
    ${pct === null ? '' : `<div class="bar"><i style="width:${Math.min(100, Math.round(pct))}%"></i></div>`}<small>${esc(note)}</small></a>`;
}
const epCard = (it, s, e, title, pct, note) => progressCard(`#/play/tv/${it.id}/${s}/${e}`, it, `S${s}E${e}${title ? ` · ${title}` : ''}`, pct, note);

const upNextCards = async () => upNext.map(p => {
  const ep = p.progress.next_episode;
  const left = p.progress.aired - p.progress.completed;
  return epCard(norm(p.show, 'show'), ep.season, ep.number, ep.title, 100 * p.progress.completed / p.progress.aired, `${left} episode${left === 1 ? '' : 's'} left`);
}).join('');

const playbackCards = type => async () => (lib?.playback ?? []).filter(p => !type || p.type === type).map(p => {
  if (p.type === 'episode') return epCard(norm(p.show, 'show'), p.episode.season, p.episode.number, p.episode.title, p.progress, `${Math.round(p.progress)}% watched`);
  const it = norm(p);
  return it ? progressCard(`#/play/movie/${it.id}`, it, it.year ?? '', p.progress, `${Math.round(p.progress)}% watched`) : '';
}).join('');

// This PC's own list, kept in SQLite and separate from Trakt's "Continue watching".
const recentCards = async () => (await invoke('history_list', { limit: 30 })).map(p => {
  const it = { type: p.kind, id: p.id, title: p.title };
  const pct = p.duration > 0 ? 100 * p.position / p.duration : null;
  return p.kind === 'tv'
    ? epCard(it, p.season, p.episode, '', pct, playedNote(p))
    : progressCard(`#/play/movie/${p.id}`, it, 'Movie', pct, playedNote(p));
}).join('');

const personCard = c => `<div class="person"><div class="art"${c.profile_path ? ` style="background-image:url('${IMG}w185${esc(c.profile_path)}')"` : ''}>${c.profile_path ? '' : icon('user')}</div>
  <b>${esc(c.name)}</b><span>${esc(c.character)}</span></div>`;

const watchlistTile = () => `<a class="list-tile" href="#/watchlist"><b>Watchlist</b><span>${watchlistItems(['movies', 'shows']).length} items</span><p>Movies and shows you want to watch.</p></a>`;
const listTile = l => `<a class="list-tile" href="#/list/${l.ids.trakt}"><b>${esc(l.name)}</b><span>${num(l.item_count)} items · ${esc(l.privacy)}</span>${l.description ? `<p>${esc(l.description)}</p>` : ''}</a>`;

// Artwork comes from TMDB, fetched only when a card scrolls near the screen.
const artObserver = new IntersectionObserver(entries => entries.forEach(async en => {
  if (!en.isIntersecting) return;
  artObserver.unobserve(en.target);
  const { type, id, art } = en.target.dataset;
  const d = await tmdb(`/${type}/${id}`).catch(() => null);
  const path = art === 'backdrop' ? d?.backdrop_path ?? d?.poster_path : d?.poster_path ?? d?.backdrop_path;
  if (path) en.target.querySelector('.art').style.backgroundImage = `url('${IMG}${art === 'backdrop' ? 'w780' : 'w342'}${path}')`;
}), { rootMargin: '400px' });
const observeArt = root => root.querySelectorAll('[data-id]').forEach(c => artObserver.observe(c));

// Placeholders shaped like the page on its way, so nothing jumps when it arrives. They hold no data.
const skeletonCards = n => '<div class="sk-card"><div class="sk"></div><p class="sk"></p><p class="sk"></p></div>'.repeat(n);
function skeleton(kind) {
  const row = `<section class="row"><div class="row-head"><div class="sk sk-title"></div></div><div class="track">${skeletonCards(12)}</div></section>`;
  const body = {
    rows: `<div class="page">${row.repeat(3)}</div>`,
    grid: `<div class="page"><div class="sk sk-heading"></div><div class="grid">${skeletonCards(18)}</div></div>`,
    title: `<section class="summary"><div class="summary-inner"><div class="sk summary-poster sk-poster"></div>
      <div class="summary-info sk-info"><div class="sk sk-heading"></div><p class="sk"></p><p class="sk"></p><p class="sk"></p></div></div></section>`,
  }[kind];
  return body ? `<div aria-hidden="true">${body}</div>` : '';
}
const SKELETONS = { home: 'rows', shows: 'rows', movies: 'rows', title: 'title', lists: 'grid', watchlist: 'grid', list: 'grid', search: 'grid' };

// defs: [title, async () => html, seeAllHref?]. Empty or failed sections are removed.
async function renderRows(defs, into = app) {
  const token = routeToken;
  defs = defs.filter(Boolean);
  into.insertAdjacentHTML('beforeend', defs.map(([title, , more], i) => `<section class="row" id="row-${token}-${i}">
    <div class="row-head">${more ? `<a class="row-title" href="${more}"><h2>${esc(title)}</h2>${icon('chevron')}</a>` : `<h2>${esc(title)}</h2>`}
    <span class="arrows"><button class="scroll prev" aria-label="Scroll left">‹</button><button class="scroll next" aria-label="Scroll right">›</button></span></div>
    <div class="track">${skeletonCards(12)}</div></section>`).join(''));
  await Promise.all(defs.map(async ([title, load], i) => {
    const html = await load().catch(e => { console.warn(title, e); return ''; });
    const sec = document.getElementById(`row-${token}-${i}`);
    if (!sec || token !== routeToken) return;
    if (!html) return sec.remove();
    sec.querySelector('.track').innerHTML = html;
    observeArt(sec);
  }));
}

document.addEventListener('click', ev => {
  const btn = ev.target.closest('.row .scroll');
  if (!btn) return;
  const track = btn.closest('.row').querySelector('.track');
  const page = track.clientWidth + parseFloat(getComputedStyle(track).columnGap); // exactly one row of whole cards
  track.scrollBy({ left: btn.classList.contains('prev') ? -page : page, behavior: 'smooth' });
});

const signInPrompt = what => `<div class="page"><section class="callout"><h2>Sign in with Trakt</h2>
  <p>Connect your Trakt account to see your ${what}.</p><a class="btn primary" href="#/settings">Sign in with Trakt</a></section></div>`;

function profileHeader() {
  const u = user.user;
  const plays = (lib?.watched_shows ?? []).reduce((n, s) => n + (s.plays ?? 0), 0);
  const stat = (n, label) => `<div><b>${num(n)}</b><span>${label}</span></div>`;
  return `<section class="profile">${avatar('big')}
    <div class="who"><h1>${esc(u.name || u.username)}</h1><p class="muted">@${esc(u.username)}${u.location ? ` · ${esc(u.location)}` : ''}${u.vip ? ' · VIP' : ''}</p></div>
    <div class="stats">${stat(lib?.watched_movies?.length, 'movies')}${stat(lib?.watched_shows?.length, 'shows')}${stat(plays, 'episode plays')}${stat(watchlistItems(['movies', 'shows']).length, 'on watchlist')}</div></section>`;
}

const watchers = x => `${num(x.watchers)} watching`;
const anticipated = x => `${num(x.list_count)} lists`;

// ---------- pages
const pages = {
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

  async lists() {
    if (!user) { app.innerHTML = signInPrompt('lists'); return; }
    const token = routeToken;
    const lists = await traktGet('/users/me/lists');
    if (token !== routeToken) return;
    app.innerHTML =`<div class="page"><h1>Lists</h1><div class="tiles">${watchlistTile()}${lists.map(listTile).join('')}</div></div>`;
  },

  async watchlist() {
    if (!user) { app.innerHTML = signInPrompt('watchlist'); return; }
    const movies = posters(watchlistItems(['movies']));
    const shows = posters(watchlistItems(['shows']));
    app.innerHTML = `<div class="page"><h1>Watchlist</h1>
      ${shows ? `<h2>Shows</h2><div class="grid">${shows}</div>` : ''}${movies ? `<h2>Movies</h2><div class="grid">${movies}</div>` : ''}
      ${movies || shows ? '' : '<p class="muted">Your watchlist is empty.</p>'}</div>`;
    observeArt(app);
  },

  async list(id) {
    if (!user) { app.innerHTML = signInPrompt('lists'); return; }
    const token = routeToken;
    const meta = await traktGet(`/users/me/lists/${+id}`);
    if (token !== routeToken) return;
    app.innerHTML =`<div class="page"><h1>${esc(meta.name)}</h1>
      <p class="muted">${num(meta.item_count)} items${meta.description ? ` · ${esc(meta.description)}` : ''}</p>
      <div class="grid" id="grid"></div><p><button id="more" hidden>Load more</button></p></div>`;
    const grid = document.getElementById('grid');
    const more = document.getElementById('more');
    const PAGE = 60;
    let page = 1;
    const load = async () => {
      const items = await traktGet(`/users/me/lists/${+id}/items/movie,show?page=${page++}&limit=${PAGE}`);
      if (token !== routeToken) return;
      grid.insertAdjacentHTML('beforeend', posters(items));
      observeArt(grid);
      more.hidden = items.length < PAGE;
    };
    more.onclick = () => load().catch(toast);
    await load();
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

  title: (type, id, season) => showTitle(type === 'tv' ? 'tv' : 'movie', +id, season === undefined ? null : +season),

  async play(type, id, s, e) {
    const sources = getSources();
    if (!sources.length) {
      app.innerHTML = '<div class="page"><p>No video servers yet. Add one you have the right to use in <a href="#/settings">Settings</a>.</p></div>';
      return;
    }
    [id, s, e] = [+id, +s, +e];
    const token = routeToken;
    const server = getServer(sources.length);
    const tt = traktType(type);
    const d = await tmdb(`/${type}/${id}`);
    const next = type === 'tv' ? episodeAfter(d, s, e) : null;
    const episode = type === 'tv' ? (await tmdb(`/tv/${id}/season/${s}`).catch(() => null))?.episodes?.find(x => x.episode_number === e) : null;
    if (token !== routeToken) return;
    const epName = episode?.name;
    const src = fillTemplate(sources[server][type === 'movie' ? 'movie' : 'tv'], { tmdb_id: id, season: s, episode: e });
    const backHref = type === 'tv' ? `#/title/tv/${id}/${s}` : `#/title/movie/${id}`;
    const seasonOptions = (d.seasons ?? []).map(x => `<option value="${x.season_number}" ${x.season_number === s ? 'selected' : ''}>${esc(x.name)} (${x.episode_count})</option>`).join('');
    const episodeMenuHtml = type === 'tv' ? `<div class="episode-picker">
        <button id="episode-btn" class="btn episode-btn" aria-haspopup="true" aria-expanded="false" title="Choose a season and episode">
          ${icon('list')}<span class="label">Episodes</span><span class="episode-btn-now">S${s}E${e}</span>${icon('chevron')}
        </button>
        <div class="episode-menu" id="episode-menu" hidden>
          <div class="episode-menu-head"><b>Episodes</b><select id="episode-season" aria-label="Season">${seasonOptions}</select></div>
          <div class="episode-list" id="episode-list"><p class="menu-note">Loading…</p></div>
          <a class="episode-menu-edit" href="${backHref}">View show details</a>
        </div>
      </div>` : '';
    const btn = (id, ic, label) => `<button id="${id}" class="btn">${icon(ic)}<span class="label">${label}</span></button>`;
    const dot = x => accentOf(x) ?? 'var(--muted)';
    const serverOptions = sources.map((x, i) => `<button type="button" class="server-option" data-server="${i}" aria-pressed="${i === server}" style="--dot:${dot(x)}">
        <span class="server-dot"></span>
        <span class="server-option-text"><b>${esc(x.name)}</b>${x.note ? `<small>${esc(x.note)}</small>` : ''}</span>
        ${icon('check')}
      </button>`).join('');
    // The bar sits above the iframe, never over it, so the player's own controls stay clickable.
    // The server list opens over the video only while choosing, so it costs the player no space.
    app.innerHTML = `<div class="player-page" style="--server-accent:${accentOf(sources[server]) ?? 'var(--line)'}">
      <div class="player-bar">
        <a class="icon-btn ghost" href="${backHref}" aria-label="Back to details" title="Back">${icon('back')}</a>
        <a class="player-title" href="${backHref}" title="Show details"><b>${esc(d.title ?? d.name)}</b>
          <span>${type === 'tv' ? `S${s} · E${e}${epName ? ` · ${esc(epName)}` : ''}` : esc(yearOf(d))}</span></a>
        ${episodeMenuHtml}
        <div class="server-picker">
          <button id="server" class="btn server-btn" aria-haspopup="true" aria-expanded="false" title="Change server">
            <span class="server-dot" style="--dot:${dot(sources[server])}"></span>
            <span class="server-btn-name">${esc(sources[server].name)}</span>${icon('chevron')}
          </button>
          <div class="server-menu" id="server-menu" role="group" aria-label="Video servers" hidden>
            <div class="server-menu-head">Servers</div>${serverOptions}
            <a class="server-menu-edit" href="#/settings">Edit servers</a>
          </div>
        </div>
        ${user ? `<span class="divider"></span>${btn('mark', 'check', 'Mark watched')}${btn('wl', 'plus', 'Watchlist')}
          <select id="addlist" aria-label="Add to a Trakt list" hidden></select>` : ''}
        ${next ? `<a class="btn primary" href="#/play/tv/${id}/${next[0]}/${next[1]}" title="Next episode: S${next[0]} · E${next[1]}"><span class="label">Next</span>${icon('next')}</a>` : ''}
        ${fsButton}
      </div>
      <iframe class="player" src="${esc(src)}" title="Video player" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="origin"></iframe></div>`;
    nowPlaying = {
      entry: { kind: type, id, title: d.title ?? d.name, season: type === 'tv' ? s : null, episode: type === 'tv' ? e : null, position: 0, duration: 0 },
      runtime: type === 'movie' ? d.runtime : episode?.runtime,
    };
    savePlayed();
    const serverBtn = document.getElementById('server');
    const serverMenu = document.getElementById('server-menu');
    const playerPage = app.querySelector('.player-page');
    const playerFrame = app.querySelector('.player');
    const sendQuality = () => {
      try { playerFrame.contentWindow.postMessage({ __filmieQuality: getQuality() }, '*'); } catch {}
    };
    const syncQuality = () => {
      sendQuality();
      setTimeout(sendQuality, 1200);
      setTimeout(sendQuality, 3500);
    };
    playerFrame.addEventListener('load', syncQuality);
    syncQuality();
    const closeMenu = () => { serverMenu.hidden = true; serverBtn.setAttribute('aria-expanded', 'false'); };
    serverBtn.onclick = () => {
      serverMenu.hidden = !serverMenu.hidden;
      serverBtn.setAttribute('aria-expanded', String(!serverMenu.hidden));
    };
    serverMenu.onclick = ev => {
      const option = ev.target.closest('[data-server]');
      if (!option) return;
      const i = +option.dataset.server;
      setServer(i);
      playerFrame.src = fillTemplate(sources[i][type === 'movie' ? 'movie' : 'tv'], { tmdb_id: id, season: s, episode: e });
      syncQuality();
      serverBtn.querySelector('.server-btn-name').textContent = sources[i].name;
      serverBtn.querySelector('.server-dot').style.setProperty('--dot', dot(sources[i]));
      playerPage.style.setProperty('--server-accent', accentOf(sources[i]) ?? 'var(--line)');
      serverMenu.querySelectorAll('[data-server]').forEach(o => o.setAttribute('aria-pressed', String(o === option)));
      closeMenu();
    };
    const episodePicker = app.querySelector('.episode-picker');
    if (episodePicker) {
      const episodeBtn = document.getElementById('episode-btn');
      const episodeMenu = document.getElementById('episode-menu');
      const episodeSeason = document.getElementById('episode-season');
      const episodeList = document.getElementById('episode-list');
      const seasons = new Map();
      const loadEpisodes = async n => {
        episodeList.innerHTML = '<p class="menu-note">Loading…</p>';
        try {
          let season = seasons.get(n);
          if (!season) {
            season = await tmdb(`/tv/${id}/season/${n}`);
            seasons.set(n, season);
          }
          if (!episodeMenu.isConnected || +episodeSeason.value !== n) return;
          const eps = season.episodes ?? [];
          episodeList.innerHTML = eps.length ? eps.map(ep => {
            const active = n === s && ep.episode_number === e;
            const row = `<span class="episode-code">E${ep.episode_number}</span>
              <span class="episode-text"><b>${esc(ep.name || `Episode ${ep.episode_number}`)}</b><small>${esc(ep.air_date ?? 'TBA')}${ep.runtime ? ` · ${ep.runtime}m` : ''}</small></span>
              ${active ? icon('play') : ''}`;
            return active
              ? `<div class="episode-option current" aria-current="page">${row}</div>`
              : `<a class="episode-option" href="#/play/tv/${id}/${n}/${ep.episode_number}">${row}</a>`;
          }).join('') : '<p class="menu-note">No episodes in this season.</p>';
          episodeList.scrollTop = 0;
          episodeList.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
        } catch (err) {
          if (episodeMenu.isConnected) episodeList.innerHTML = `<p class="menu-note">${esc(err)}</p>`;
        }
      };
      episodeBtn.onclick = () => {
        const open = episodeMenu.hidden;
        closeMenus(episodePicker);
        episodeMenu.hidden = !open;
        episodeBtn.setAttribute('aria-expanded', String(open));
        if (open) loadEpisodes(+episodeSeason.value);
      };
      episodeSeason.onchange = () => loadEpisodes(+episodeSeason.value);
    }
    if (!user) return;

    // Trakt actions are manual: nothing is sent until the user presses a button.
    const $ = id => document.getElementById(id);
    const body = { [`${tt}s`]: [ids(id)] };
    let marked = false;
    const paint = () => {
      const set = (el, on, label, title) => { el.classList.toggle('on', on); el.querySelector('.label').textContent = label; el.title = title; };
      set($('mark'), marked, marked ? 'Watched' : 'Mark watched', marked ? 'Add another play to your Trakt history' : 'Add this to your Trakt history');
      const wl = inWatchlist(tt, id);
      set($('wl'), wl, wl ? 'On watchlist' : 'Watchlist', wl ? `Remove this ${tt} from your watchlist` : `Add this ${tt} to your watchlist`);
    };
    paint();
    busy($('mark'), async () => {
      await write('/sync/history', type === 'movie' ? body : episodeBody(id, s, e));
      if (type === 'tv') refreshProgress().catch(console.warn);
      marked = true;
      paint();
      toast('Marked watched on Trakt');
    });
    busy($('wl'), async () => {
      const wl = inWatchlist(tt, id);
      await write(wl ? '/sync/watchlist/remove' : '/sync/watchlist', body);
      paint();
      toast(wl ? 'Removed from watchlist' : 'Added to watchlist');
    });
    listPicker($('addlist'), tt, id);
  },

  async settings() {
    const limits = user?.limits;
    const field =(title, help, control) => `<div class="field"><div><b>${title}</b><p class="muted">${help}</p></div>${control}</div>`;
    app.innerHTML = `<div class="page settings"><h1>Settings</h1>
      <section class="card" id="trakt-box">
        <div class="card-head"><h2>Trakt account</h2><p class="muted">Your watchlist, lists, recommendations and watch history.</p></div>
        ${user ? `<div class="account-row">${avatar('big')}
            <div class="who"><b>${esc(user.user.name || user.user.username)}</b><span class="muted">@${esc(user.user.username)}${user.user.vip ? ' · VIP' : ''}</span>
              ${limits ? `<small class="muted">Limits: ${num(limits.watchlist?.item_count)} watchlist items · ${num(limits.list?.count)} lists of ${num(limits.list?.item_count)} items</small>` : ''}</div>
            <div class="row-actions"><button id="sync" class="btn">${icon('sync')}Sync now</button><button id="signout" class="btn">${icon('logout')}Sign out</button></div></div>`
          : `<div class="account-row"><p class="muted">Not connected.</p><div class="row-actions"><button id="connect" class="btn primary">Sign in with Trakt</button></div></div>`}
      </section>
      <section class="card" id="servers"></section>
      <section class="card">
        <div class="card-head"><h2>Playback</h2><p class="muted">Nothing is marked watched on Trakt until you press Mark watched.</p></div>
        ${field('Preferred quality', 'The player starts at this quality when the server supports it. Default: 1080p.',
          `<select id="quality" aria-label="Preferred quality">${QUALITIES.map(q => `<option value="${q}" ${q === getQuality() ? 'selected' : ''}>${q === 'auto' ? 'Auto' : q}</option>`).join('')}</select>`)}
        ${field('Ad blocking', 'Ads and pop-ups inside embedded players are blocked by the bundled filter lists; new windows are denied.', '<span class="muted">On</span>')}
        ${field('Fullscreen', 'Fill the whole screen. Shortcut: <kbd>F11</kbd>, and <kbd>Esc</kbd> to leave.', `<button class="btn fs-btn">${icon('expand')}Toggle fullscreen</button>`)}
      </section>
      <section class="card">
        <div class="card-head"><h2>Saved on this PC</h2><p class="muted">Pages load faster and work offline from a local database.</p></div>
        ${field('Cache', '<span id="cache-info">Checking…</span>', '<button id="clear-cache" class="btn">Clear cache</button>')}
        ${field('Recently played', 'Your local list and progress, separate from Trakt and never sent anywhere.', '<button id="clear-recent" class="btn">Clear list</button>')}
      </section>
      <section class="card about">
        <div class="card-head"><h2>About</h2></div>
        <p>Filmie uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.
        <a href="https://www.themoviedb.org/" target="_blank">themoviedb.org</a></p>
        <p>Filmie uses Trakt but is not endorsed or certified by Trakt.</p>
        <p>Streaming availability data by <a href="https://www.justwatch.com/" target="_blank">JustWatch</a>.</p>
        <p>Ad blocking by uBlock Origin Lite (GPLv3), <a href="https://github.com/uBlockOrigin/uBOL-home" target="_blank">source</a>.</p>
        <p class="muted">Privacy: your Trakt tokens are kept in Windows Credential Manager, and your library copy and avatar in this app's data folder. Signing out deletes all of them. Cached pages and your Recently played list are kept in a local database, and you can clear them above.</p></section></div>`;
    const $ = id => document.getElementById(id);
    busy($('connect'), () => connectTrakt($('trakt-box')).catch(e => { route(); throw e; }));
    busy($('signout'), async () => { await invoke('sign_out'); await refreshUser(); route(); });
    busy($('sync'), async () => { lib = await invoke('sync'); await refreshProgress(); toast('Synced'); });
    const showCache = () => invoke('cache_info').then(c => {
      const info = $('cache-info');
      if (info) info.textContent = `${num(c.count)} saved responses, ${(c.bytes / 1048576).toFixed(1)} MB.`; // gone if the page was left
    }, console.warn);
    showCache();
    busy($('clear-cache'), async () => { await invoke('cache_clear'); await showCache(); toast('Cache cleared'); });
    busy($('clear-recent'), async () => { await invoke('history_clear'); toast('Recently played cleared'); });
    $('quality').onchange = ev => { setQuality(ev.target.value); toast('Preferred quality saved'); };
    renderServers($('servers'));
  },
};

// The Video servers card. editing: null for just the list, -1 for a new server, or the index being edited.
function renderServers(card, editing = null) {
  const list = getSources();
  if (!list.length && editing === null) editing = -1;
  const current = getServer(list.length);
  const host = s => { try { return new URL(s.movie).hostname; } catch { return ''; } };
  const rows = list.map((s, i) => `<li class="server-row" style="--dot:${accentOf(s) ?? 'var(--muted)'}">
      <input type="radio" name="default-server" value="${i}" ${i === current ? 'checked' : ''} title="Default server" aria-label="Use ${esc(s.name)} by default">
      <span class="server-dot"></span>
      <div class="server-row-text"><b>${esc(s.name)}</b><small class="muted">${esc([host(s), s.note].filter(Boolean).join(' · '))}</small></div>
      <span class="tag">Default</span>
      <button type="button" class="btn ghost" data-edit="${i}">Edit</button>
      <button type="button" class="btn ghost" data-remove="${i}">Remove</button></li>`).join('');
  const saved = list[editing];
  const draft = saved ? { ...saved, ...splitServer(saved) } : { link: '', movie: MOVIE_STRUCTURES[0], tv: TV_STRUCTURES[0], accent: '#e5484d' };
  const options = items => items.map(x => `<option value="${esc(x)}"></option>`).join('');
  const input = (id, label, hint, value, attrs = '') => `<label class="form-field" for="${id}"><b>${label}</b>
      <input id="${id}" value="${esc(value ?? '')}" spellcheck="false" autocomplete="off" ${attrs}><small class="muted">${hint}</small></label>`;
  card.innerHTML = `<div class="card-head"><h2>Video servers</h2>
      <p class="muted">Filmie includes no servers. Only add ones you have the right to use.</p></div>
    ${rows ? `<ul class="server-list">${rows}</ul>` : ''}
    ${editing === null ? `<div class="card-actions"><button type="button" id="server-add" class="btn primary">${icon('plus')}Add server</button></div>` : `<form id="server-form" novalidate>
      <h3>${saved ? `Edit ${esc(saved.name)}` : 'Add a server'}</h3>
      ${input('server-link', 'Server link', 'Just the address of the server.', draft.link, 'type="url" placeholder="https://example.com" required')}
      <div class="form-grid">
        ${input('server-movie', 'Movie structure', 'Needs <code>{tmdb_id}</code>.', draft.movie, 'list="movie-structures" required')}
        ${input('server-tv', 'TV structure', 'Needs <code>{tmdb_id}</code>, <code>{season}</code> and <code>{episode}</code>.', draft.tv, 'list="tv-structures" required')}
      </div>
      <datalist id="movie-structures">${options(MOVIE_STRUCTURES)}</datalist><datalist id="tv-structures">${options(TV_STRUCTURES)}</datalist>
      <div class="form-grid optional">
        ${input('server-name', 'Name (optional)', 'Uses the address if left empty.', draft.name)}
        ${input('server-note', 'Note (optional)', 'Shown in the player\'s server menu.', draft.note)}
        <label class="form-field" for="server-accent"><b>Accent</b><input id="server-accent" type="color" value="${accentOf(draft) ?? '#e5484d'}"><small class="muted">Marks this server in the player.</small></label>
      </div>
      <div class="server-preview" id="server-preview" role="status"></div>
      <div class="card-actions">${list.length ? '<button type="button" id="server-cancel" class="btn">Cancel</button>' : ''}<button type="submit" class="btn primary">${saved ? 'Save server' : 'Add server'}</button></div>
    </form>`}
    <details class="server-text"><summary>Edit as text</summary>
      <p class="muted">One per line: <code>Name | movie URL | TV URL | note | #rrggbb</code>. Handy for backups and adding several at once.</p>
      <textarea id="sources" aria-label="Video servers as text" spellcheck="false" rows="6">${esc(formatSources(list))}</textarea>
      <div class="card-actions"><button type="button" id="save-sources" class="btn">Save text</button></div></details>`;

  const redraw = next => renderServers(card, next);
  card.onclick = ev => {
    const edit = ev.target.closest('[data-edit]');
    if (edit) return redraw(+edit.dataset.edit);
    const remove = ev.target.closest('[data-remove]');
    if (remove && !remove.dataset.armed) { // second press confirms: there is no undo
      remove.dataset.armed = '1';
      remove.textContent = 'Press again to remove';
      return;
    }
    if (remove) {
      const i = +remove.dataset.remove;
      setSources(list.filter((_, n) => n !== i));
      setServer(serverAfterRemove(current, i));
      toast(`Removed ${list[i].name}`);
      return redraw();
    }
    if (ev.target.closest('#server-add')) return redraw(-1);
    if (ev.target.closest('#server-cancel')) return redraw();
    if (ev.target.closest('#save-sources')) {
      try {
        setSources(parseSources(card.querySelector('#sources').value));
        toast('Servers saved');
        redraw();
      } catch (e) { toast(e.message); }
    }
  };
  card.onchange = ev => {
    if (ev.target.name !== 'default-server') return;
    setServer(ev.target.value);
    toast('Default server saved');
  };

  const form = card.querySelector('#server-form');
  if (!form) return;
  const value = id => form.querySelector(`#server-${id}`).value;
  const read = () => buildServer({ link: value('link'), movie: value('movie'), tv: value('tv'), name: value('name'), note: value('note'), accent: value('accent') });
  const preview = form.querySelector('#server-preview');
  const showError = e => { preview.innerHTML = `<p class="error">${esc(e.message)}</p>`; };
  form.oninput = () => {
    if (!value('link').trim()) { preview.innerHTML = ''; return; }
    try {
      const s = read();
      const sample = template => `<code>${esc(fillTemplate(template, { tmdb_id: 27205, season: 1, episode: 2 }))}</code>`;
      preview.innerHTML = `<p class="muted">Example links for this server:</p><p>Movie ${sample(s.movie)}</p><p>TV ${sample(s.tv)}</p>`;
    } catch (e) { showError(e); }
  };
  form.oninput();
  form.onsubmit = ev => {
    ev.preventDefault();
    try {
      const s = read();
      setSources(saved ? list.map((x, i) => i === editing ? s : x) : [...list, s]);
      toast(`${saved ? 'Saved' : 'Added'} ${s.name}`);
      redraw();
    } catch (e) { showError(e); }
  };
  if (!saved) form.querySelector('#server-link').focus({ preventScroll: true });
}

async function showTitle(type, id, season = null) {
  const token = routeToken;
  const d = await tmdb(`/${type}/${id}`, { append_to_response: 'external_ids,videos,watch/providers,credits' });
  if (token !== routeToken) return;
  const tt = traktType(type);
  const name = d.title ?? d.name;
  const imdb = d.external_ids?.imdb_id;
  const trailer = d.videos?.results?.find(v => v.site === 'YouTube' && v.type === 'Trailer');
  const region = (navigator.language.split('-')[1] || 'US').toUpperCase();
  const prov = d['watch/providers']?.results?.[region];
  const length = d.runtime ? `${Math.floor(d.runtime / 60)}h ${d.runtime % 60}m` : d.number_of_seasons ? `${d.number_of_seasons} season${d.number_of_seasons > 1 ? 's' : ''}` : '';
  const q = encodeURIComponent(name);
  const links = [
    imdb && ['IMDb', `https://www.imdb.com/title/${imdb}/`],
    type === 'movie' && ['Letterboxd', `https://letterboxd.com/tmdb/${id}/`],
    ['TMDB', `https://www.themoviedb.org/${type}/${id}`],
    ['Rotten Tomatoes', `https://www.rottentomatoes.com/search?search=${q}`],
    ['Metacritic', `https://www.metacritic.com/search/${q}/`],
  ].filter(Boolean);
  const rating = myRating(tt, id);
  const cast = d.credits?.cast?.slice(0, 20) ?? [];
  const next = type === 'tv' && nextEps.get(id);

  app.innerHTML = `<section class="summary" ${d.backdrop_path ? `style="--backdrop:url('${IMG}w1280${esc(d.backdrop_path)}')"` : ''}>
    <div class="summary-inner">
      ${d.poster_path ? `<img class="summary-poster" src="${IMG}w342${esc(d.poster_path)}" alt="">` : ''}
      <div class="summary-info">
        <h1>${esc(name)} <span class="muted">${esc(yearOf(d))}</span></h1>
        <p class="muted">${esc([type === 'tv' ? 'Show' : 'Movie', length, d.genres?.map(g => g.name).join(', ')].filter(Boolean).join(' · '))}</p>
        <div class="ratings" id="ratings"><span>TMDB <b>${(d.vote_average ?? 0).toFixed(1)}</b></span>${rating ? `<span>You <b>♥ ${rating}</b></span>` : ''}</div>
        <div class="actions">
          <a class="btn primary big" href="${playHref(type, id)}">${icon('play')}${next ? `Play S${next[0]} · E${next[1]}` : 'Play'}</a>
          ${user ? `<button id="watchlist" class="btn${inWatchlist(tt, id) ? ' on' : ''}">${inWatchlist(tt, id) ? `${icon('check')}On watchlist` : `${icon('plus')}Watchlist`}</button>
            ${type === 'movie' ? `<button id="watched" class="btn${watchedMovie(id) ? ' on' : ''}">${icon('check')}${watchedMovie(id) ? 'Watched' : 'Mark watched'}</button>` : ''}
            <select id="rate" aria-label="Your rating"><option value="">Rate…</option>${[...Array(10)].map((_, i) => `<option value="${i + 1}" ${rating === i + 1 ? 'selected' : ''}>♥ ${i + 1}</option>`).join('')}</select>
            <select id="addlist" aria-label="Add to a Trakt list" hidden></select>` : ''}
          ${trailer ? `<a class="btn" href="https://www.youtube.com/watch?v=${encodeURIComponent(trailer.key)}" target="_blank">Trailer</a>` : ''}
        </div>
        <p class="overview">${esc(d.overview)}</p>
        <div class="links" id="links">${links.map(([n, u]) => `<a href="${esc(u)}" target="_blank">${n}</a>`).join('')}</div>
      </div>
      ${prov?.flatrate ? `<aside class="where"><h2>Where to watch</h2>
        <div class="providers">${prov.flatrate.map(p => `<img src="${IMG}w92${esc(p.logo_path)}" alt="${esc(p.provider_name)}" title="${esc(p.provider_name)}">`).join('')}</div>
        <small><a href="${esc(prov.link)}" target="_blank" class="muted">via JustWatch</a></small></aside>` : ''}
      </div></section>
    ${type === 'tv' ? `<section class="page episodes-wrap"><div class="row-head"><h2>Episodes</h2>
      <select id="season" aria-label="Season">${d.seasons.map(s => `<option value="${s.season_number}">${esc(s.name)} (${s.episode_count})</option>`).join('')}</select></div>
      <ol class="episodes" id="episodes"></ol></section>` : ''}
    <div class="page" id="related"></div>`;

  const body = { [`${tt}s`]: [ids(id)] };
  busy(document.getElementById('watchlist'), async () => { await write(inWatchlist(tt, id) ? '/sync/watchlist/remove' : '/sync/watchlist', body); await route({ soft: true }); });
  busy(document.getElementById('watched'), async () => { await write(watchedMovie(id) ? '/sync/history/remove' : '/sync/history', body); await route({ soft: true }); });
  listPicker(document.getElementById('addlist'), tt, id);
  const rate = document.getElementById('rate');
  if (rate) rate.onchange = () => write(rate.value ? '/sync/ratings' : '/sync/ratings/remove',
    { [`${tt}s`]: [{ ...ids(id), ...(rate.value && { rating: +rate.value }) }] }).then(() => toast('Rating saved'), toast);

  const lookup = traktGet(`/search/tmdb/${id}?type=${tt}&extended=full`).then(r => r[0]?.[tt]);
  let firstSeason;
  if (type === 'tv') {
    // Per-episode watched state, fetched fresh; null when signed out.
    const progress = user ? lookup.then(t => t && trakt('GET', `/shows/${t.ids.trakt}/progress/watched`, null)).catch(() => null) : null;
    const select = document.getElementById('season');
    const requested = d.seasons.some(s => s.season_number === season) ? season : null;
    select.value = String(requested ?? (next || [d.seasons.find(s => s.season_number > 0)?.season_number ?? 0])[0]);
    select.onchange = () => loadSeason(id, +select.value, progress).catch(toast);
    firstSeason = loadSeason(id, +select.value, progress).catch(toast);
  }

  const rows = renderRows([
    cast.length && ['Cast', async () => cast.map(personCard).join('')],
    ['Related', async () => {
      const t = await lookup;
      return t ? posters(await traktGet(`/${tt}s/${t.ids.trakt}/related?limit=20`), tt) : '';
    }],
  ], document.getElementById('related'));
  await firstSeason; // a soft refresh or restored scroll needs the page's full height
  const t = await lookup.catch(e => console.warn('Trakt lookup failed', e));
  if (t && token === routeToken) {
    if (t.votes) document.getElementById('ratings').insertAdjacentHTML('afterbegin', `<span>Trakt <b>${Math.round((t.rating ?? 0) * 10)}%</b> <small>${num(t.votes)} votes</small></span>`);
    document.getElementById('links').insertAdjacentHTML('afterbegin', `<a href="https://app.trakt.tv/${tt}s/${encodeURIComponent(t.ids.slug)}" target="_blank">Trakt</a>`);
  }
  await rows;
}

async function loadSeason(id, n, progress) {
  const [season, prog] = await Promise.all([tmdb(`/tv/${id}/season/${n}`), progress]);
  const list = document.getElementById('episodes');
  if (!list) return;
  const eps = prog?.seasons?.find(s => s.number === n)?.episodes ?? [];
  const watchedEp = e => eps.some(x => x.number === e && x.completed);
  list.innerHTML = season.episodes.map(e => `<li>
    <a class="still" href="#/play/tv/${id}/${n}/${e.episode_number}" ${e.still_path ? `style="background-image:url('${IMG}w300${esc(e.still_path)}')"` : ''} aria-label="Play episode ${e.episode_number}"><span class="play-icon">${icon('play')}</span></a>
    <div class="episode-body"><a class="episode-link" href="#/play/tv/${id}/${n}/${e.episode_number}">
      <h3>${e.episode_number}. ${esc(e.name)}</h3>
      <p class="muted">${esc(e.air_date ?? 'TBA')}${e.runtime ? ` · ${e.runtime}m` : ''}</p>
      <p>${esc(e.overview)}</p></a>
      ${user ? `<label class="check"><input type="checkbox" data-ep="${e.episode_number}" ${watchedEp(e.episode_number) ? 'checked' : ''}> Watched</label>` : ''}
    </div></li>`).join('');
  list.querySelectorAll('[data-ep]').forEach(box => box.addEventListener('change', async () => {
    box.disabled = true;
    try {
      await write(box.checked ? '/sync/history' : '/sync/history/remove', episodeBody(id, n, box.dataset.ep));
      const ep = eps.find(x => x.number === +box.dataset.ep);
      if (ep) ep.completed = box.checked; // keeps the cached progress right when switching seasons
      refreshProgress().catch(console.warn);
    }
    catch (e) { box.checked = !box.checked; toast(e); }
    box.disabled = false;
  }));
}

async function connectTrakt(box) {
  const c = await invoke('device_start');
  box.innerHTML = `<div class="card-head"><h2>Trakt account</h2></div><p>Open <a href="${esc(c.verification_url)}" target="_blank">${esc(c.verification_url)}</a> and enter this code (already copied):</p>
    <p class="code">${esc(c.user_code)}</p><p class="muted">Waiting for approval…</p>`;
  navigator.clipboard.writeText(c.user_code).catch(() => {});
  window.open(c.verification_url);
  let interval = c.interval * 1000;
  const deadline = Date.now() + c.expires_in * 1000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, interval));
    if (!box.isConnected) return; // user left the page
    const r = await invoke('device_poll', { deviceCode: c.device_code });
    if (r === 'ok') { await refreshUser(); toast(`Signed in as ${user?.user?.username}`); location.hash = '#/'; return; }
    if (r === 'slow_down') interval += 1000;
  }
  throw new Error('The code expired. Try again.');
}

// ---------- router
const searchBox = document.getElementById('q');

// Each history entry remembers its own scroll position, so Back can return to it.
history.scrollRestoration = 'manual';
const savedScroll = new Map();
let navType = 'push';
let traversing = false; // this page was reached with Back or Forward
window.navigation?.addEventListener('navigate', ev => {
  navType = ev.navigationType;
  savedScroll.set(navigation.currentEntry.key, scrollY);
});

// soft: refresh this page in place, for changes the user didn't navigate to. It renders into a hidden copy,
// which comes first in the document so the pages' getElementById calls find it, then swaps in one step.
async function route({ soft = false } = {}) {
  const token = ++routeToken;
  nowPlaying = null;
  document.getElementById('soft-render')?.remove();
  app = main;
  const [page, ...args] = location.hash.slice(2).split('/');
  const name = Object.hasOwn(pages, page || 'home') ? page || 'home' : 'home';
  const open = pages[name];
  const opening = navType;
  traversing = opening === 'traverse';
  navType = 'push'; // route() also runs without a navigation, as after signing out
  if (soft) {
    app = main.cloneNode(false);
    app.id = 'soft-render';
    app.hidden = true;
    main.before(app);
  } else {
    const show = () => {
      const current = navFor(page);
      document.querySelectorAll('[data-nav]').forEach(a => {
        const i = current.indexOf(a.dataset.nav);
        a.classList.toggle('active', i >= 0);
        if (i < 0) a.removeAttribute('aria-current');
        else a.setAttribute('aria-current', i === 0 ? 'page' : 'true');
      });
      document.body.classList.toggle('playing', page === 'play');
      document.body.classList.toggle('searching', page === 'search');
      if (page !== 'search') searchBox.value = '';
      scrollTo(0, 0);
      main.innerHTML = skeleton(SKELETONS[name]);
    };
    // No data is awaited inside the transition, because the page is frozen until its callback ends.
    // The video frame must never be captured in a transition, so the player opens and closes without one.
    const animate = document.startViewTransition && name !== 'play' && !document.body.classList.contains('playing');
    if (animate) {
      const transition = document.startViewTransition(show);
      transition.ready.catch(() => {}); // rejects when a newer page change skips this one, which is fine
      await transition.updateCallbackDone;
    } else show();
    if (token !== routeToken) return;
    (page === 'search' ? searchBox : main).focus({ preventScroll: true });
    main.setAttribute('aria-busy', 'true');
  }
  try { await open(...args); }
  catch (e) { if (token === routeToken) app.innerHTML = `<div class="page"><p class="error">${esc(e)}</p></div>`; }
  if (token !== routeToken) return;
  if (soft) {
    main.replaceChildren(...app.childNodes);
    app.remove();
    app = main;
    return;
  }
  main.removeAttribute('aria-busy');
  const y = scrollTarget(opening, savedScroll.get(window.navigation?.currentEntry.key));
  if (y) scrollTo(0, y);
}

// Search as you type (debounced); clearing the box goes home.
let searchTimer;
searchBox.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const q = searchBox.value.trim();
    const target = q ? `#/search/${encodeURIComponent(q)}` : '#/';
    location.hash.startsWith('#/search/') ? location.replace(target) : (location.hash = target);
  }, 400);
});

document.addEventListener('keydown', ev => {
  if (!ev.ctrlKey || ev.key.toLowerCase() !== 'k' || document.body.classList.contains('playing')) return;
  ev.preventDefault();
  if (location.hash.startsWith('#/search')) searchBox.select();
  else location.hash = '#/search';
});

// The rail starts narrow, and a saved 'wide' is the only thing that widens it.
const railToggle = document.getElementById('rail-toggle');
function setRail(wide) {
  document.body.classList.toggle('rail-wide', wide);
  railToggle.setAttribute('aria-expanded', String(wide));
  railToggle.setAttribute('aria-label', wide ? 'Collapse navigation' : 'Expand navigation');
}
try { setRail(localStorage.getItem('rail') === 'wide'); } catch {}
railToggle.onclick = () => {
  const wide = !document.body.classList.contains('rail-wide');
  setRail(wide);
  try { localStorage.setItem('rail', wide ? 'wide' : 'narrow'); } catch {}
};

window.addEventListener('hashchange', () => route());
// Only text fields and selected text get a menu; the rest of the app shouldn't offer "Reload" or "Save as".
document.addEventListener('contextmenu', ev => { if (!ev.target.closest('input, textarea') && !String(getSelection())) ev.preventDefault(); });
setInterval(() => syncInBackground().catch(console.warn), 15 * 60e3);
refreshUser().catch(toast).finally(() => { route(); syncInBackground().catch(console.warn); });
