// Shared state and helpers: Tauri calls, preferences, fullscreen, the Trakt library mirror.
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
const pages = {};       // route name -> page function, filled in by the pages-*.js scripts

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
function getMode() {
  try { return modeOf(localStorage.getItem('mode')); } catch { return 'media'; }
}
const saveMode = m => { try { localStorage.setItem('mode', modeOf(m)); } catch {} };
const setMode = m => { saveMode(m); route({ soft: true }); };
const forMode = (media, show, movie) => ({ media, show, movie })[getMode()];

// Filters: pages with `filters: 'global'` share one saved set, and other pages keep their own until the app closes.
// A person's saved default is where both start.
function readStoredFilters(key) {
  try { return cleanFilters(JSON.parse(localStorage.getItem(key))); } catch { return {}; }
}
function hasStored(key) {
  try { return localStorage.getItem(key) !== null; } catch { return false; }
}
const savedDefaultFilters = () => readStoredFilters('filters-default');
const saveDefaultFilters = f => { try { localStorage.setItem('filters-default', JSON.stringify(cleanFilters(f))); } catch {} };
const localFilters = new Map();
let filterScope = false; // this page's `bar.filters`
function activeFilters() {
  if (!filterScope) return {};
  const stored = filterScope === 'global'
    ? (hasStored('filters') ? readStoredFilters('filters') : savedDefaultFilters())
    : localFilters.get(location.hash) ?? savedDefaultFilters();
  // Filters that need an account would fail, or mean nothing, when signed out.
  return Object.fromEntries(Object.entries(stored).filter(([k]) => user || !filterDef(k).auth));
}
function setActiveFilters(filters) {
  const clean = cleanFilters(filters);
  if (filterScope === 'global') { try { localStorage.setItem('filters', JSON.stringify(clean)); } catch {} }
  else localFilters.set(location.hash, clean);
}
const withFilters = path => addQuery(path, filterQuery(activeFilters()));
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
  // A press that closes a drawer or menu shouldn't also leave fullscreen.
  else if (ev.key === 'Escape' && document.body.classList.contains('fullscreen') && !document.fullscreenElement && !document.querySelector('dialog[open], [popover]:popover-open')) setFullscreen(false).catch(toast);
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
  account.innerHTML = user ? `${avatar('small')}<span class="nav-label">${esc(user.user.username)}</span>` : `${icon('user')}<span class="nav-label">Sign in</span>`;
  account.href = user ? '#/profile' : '#/settings';
  account.setAttribute('aria-label', user ? `Profile: ${user.user.username}` : 'Sign in');
  document.body.classList.toggle('signed-in', !!user);
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
