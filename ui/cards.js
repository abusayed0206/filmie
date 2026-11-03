// Cards, rows and loading placeholders.
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
