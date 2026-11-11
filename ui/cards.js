// Cards, rows and loading placeholders.
// ---------- cards
function cardMenuButton(it) {
  if (!user) return '';
  return `<button type="button" class="card-menu" aria-label="More for ${esc(it.title)}" data-menu-type="${it.type}" data-menu-id="${it.id}" data-menu-title="${esc(it.title)}">${icon('more')}</button>`;
}

// The one action a card shows directly: mark watched where the next step is watching it.
const watchAction = (it, s, e) => user ? `<button type="button" class="card-action" title="Mark watched" aria-label="Mark ${esc(it.title)} watched" data-watch="${it.type}" data-id-value="${it.id}"${s ? ` data-s="${s}" data-e="${e}"` : ''}>${icon('check')}</button>` : '';
// Takes a title off a list of the person's own. `path` is the Trakt route that removes it.
const removeAction = (it, path, label, done = 'Removed') => `<button type="button" class="card-action" title="${esc(label)}" aria-label="${esc(label)}: ${esc(it.title)}" data-remove-path="${esc(path)}" data-remove-type="${it.type}" data-id-value="${it.id}" data-remove-done="${esc(done)}">${icon('close')}</button>`;

function posterCard(it, { label, titled, action } = {}) {
  const tt = traktType(it.type);
  const started = it.type === 'tv' && nextEps.has(it.id);
  const watched = it.type === 'movie' ? watchedMovie(it.id) : !!watchedShow(it.id) && !started;
  const status = statusTag({ dropped: it.type === 'tv' && droppedShow(it.id), watched, started, postCredits: it.postCredits, watchlisted: inWatchlist(tt, it.id) });
  // Media mode mixes both types, so each card says which it is.
  const typeTag = getMode() === 'media' ? `<i class="tag type-tag" title="${it.type === 'tv' ? 'Show' : 'Movie'}">${icon(it.type === 'tv' ? 'tv' : 'film')}</i>` : '';
  const tags = (label ? [label] : [it.year, it.type === 'tv' ? it.episodes && `${it.episodes} eps` : runtimeText(it.runtime)]).filter(Boolean);
  return `<div class="media-card${watched ? ' is-watched' : ''}">
    <a class="poster" href="#/title/${it.type}/${it.id}" data-type="${it.type}" data-id="${it.id}" title="${esc(it.title)}" aria-label="${esc([it.title, it.year].filter(Boolean).join(', '))}">
      <div class="art"><span class="cover-title">${esc(it.title)}</span><div class="tags">${typeTag}</div>${downloadBadge(it.type, it.id)}${status ? `<i class="status-tag">${esc(status)}</i>` : ''}</div>
      <div class="card-footer${titled ? ' titled' : ''}">${titled ? `<b>${esc(it.title)}</b>` : ''}${tags.map(t => `<span class="meta-tag">${esc(t)}</span>`).join('')}</div></a>
    ${cardMenuButton(it)}${action ?? ''}</div>`;
}
const posters = (items, type, label) => (items ?? []).map(x => [norm(x, type), x]).filter(([it]) => it).map(([it, x]) => posterCard(it, { label: label?.(x) })).join('');
const traktPosters = (path, type, label) => async () => posters(await traktGet(path), type, label);

function progressCard(href, it, line, pct, note, { action, play = true } = {}) {
  return `<div class="media-card landscape-card"><a class="ep-card" href="${href}" data-type="${it.type}" data-id="${it.id}" data-art="backdrop" title="${esc(it.title)}">
    <div class="art"><span class="cover-title">${esc(it.title)}</span>${downloadBadge(it.type, it.id)}${play ? `<span class="play-icon">${icon('play')}</span>` : ''}</div>
    <b>${esc(it.title)}</b><span>${esc(line)}</span>
    ${pct === null ? '' : `<div class="bar"><i style="width:${Math.min(100, Math.round(pct))}%"></i></div>`}<small>${esc(note)}</small></a>${action ?? ''}</div>`;
}
const episodeLine = ep => `S${ep.season}E${ep.number}${ep.title ? ` · ${ep.title}` : ''}`;
const epCard = (it, s, e, title, pct, note, opts) => progressCard(`#/play/tv/${it.id}/${s}/${e}`, it, episodeLine({ season: s, number: e, title }), pct, note, opts);

// Continue Watching: a show's next episode, or a paused movie.
function continueCard(x) {
  const it = norm(x, x.show ? 'show' : 'movie');
  if (!it) return '';
  if (!x.show) return progressCard(`#/play/movie/${it.id}`, it, it.year ?? '', x.progress, `${Math.round(x.progress)}% watched`, { action: watchAction(it) });
  const p = x.progress;
  const ep = p.next_episode;
  if (!ep) return '';
  const left = p.aired - p.completed;
  return epCard(it, ep.season, ep.number, ep.title, 100 * p.completed / p.aired, `${left} episode${left === 1 ? '' : 's'} left`, { action: watchAction(it, ep.season, ep.number) });
}
const loadContinue = async limit => {
  const [shows, movies] = await Promise.all([
    getMode() === 'movie' ? [] : traktGet(`/sync/progress/up_next_nitro?limit=${limit}`),
    getMode() === 'show' ? [] : traktGet(`/sync/playback/movies?limit=${limit}`),
  ]);
  return mergeContinue(shows ?? [], movies ?? []);
};

// A calendar entry: an episode or a movie, shown with its date. These aren't out yet, so they open the title, not the player.
function calendarCard(x) {
  const it = norm(x, x.movie ? 'movie' : 'show');
  if (!it) return '';
  const date = shortDate(x.first_aired ?? x.released);
  return x.episode
    ? progressCard(`#/title/tv/${it.id}/${x.episode.season}`, it, episodeLine(x.episode), null, date, { play: false })
    : progressCard(`#/title/movie/${it.id}`, it, it.year ?? 'Movie', null, date, { play: false });
}

// A history entry. The History page also lets each play be removed.
function historyCard(x, { removable } = {}) {
  const it = norm(x, x.movie ? 'movie' : 'show');
  if (!it) return '';
  const date = shortDate(x.watched_at);
  const action = removable && x.id ? `<button type="button" class="card-action" title="Remove this play" aria-label="Remove this play of ${esc(it.title)}" data-remove-play="${+x.id}">${icon('close')}</button>` : '';
  if (!x.episode) return progressCard(`#/title/movie/${it.id}`, it, it.year ?? 'Movie', null, date, { play: false, action });
  return progressCard(`#/title/tv/${it.id}/${x.episode.season}`, it, episodeLine(x.episode), null, date, { play: false, action });
}

// For a grid of calendar entries in date order: adds a heading wherever the day changes.
function dayHeadings(card) {
  let day = '';
  const today = shortDate(isoDate());
  return x => {
    const date = shortDate(x.first_aired ?? x.released);
    const heading = date !== day ? `<h2 class="grid-day">${date === today ? `Today, ${esc(date)}` : esc(date)}</h2>` : '';
    day = date;
    return heading + card(x);
  };
}
const byAirDate = (a, b) => (a.first_aired ?? a.released ?? '').localeCompare(b.first_aired ?? b.released ?? '');

// Start Watching: the watchlist, titled, with one press to mark it watched. A show starts at its first episode.
function startCard(x) {
  const it = norm(x, x.show ? 'show' : 'movie');
  if (!it) return '';
  return posterCard(it, { titled: true, label: it.type === 'tv' ? 'S1E1' : runtimeText(it.runtime) || it.year, action: it.type === 'tv' ? watchAction(it, 1, 1) : watchAction(it) });
}

// This PC's own list, kept in SQLite and separate from Trakt's "Continue watching".
const recentCards = async () => (await invoke('history_list', { limit: 30 })).filter(p => forMode(true, p.kind === 'tv', p.kind === 'movie')).map(p => {
  const it = { type: p.kind, id: p.id, title: p.title };
  const pct = p.duration > 0 ? 100 * p.position / p.duration : null;
  return p.kind === 'tv'
    ? epCard(it, p.season, p.episode, '', pct, playedNote(p))
    : progressCard(`#/play/movie/${p.id}`, it, 'Movie', pct, playedNote(p));
}).join('');

const personCard = c => `<a class="person" href="#/person/${+c.id}"><div class="art"${c.profile_path ? ` style="background-image:url('${IMG}w185${esc(c.profile_path)}')"` : ''}>${c.profile_path ? '' : icon('user')}</div>
  <b>${esc(c.name)}</b><span>${esc(c.character)}</span></a>`;

const listTile = (l, href = `#/list/${+l.ids.trakt}`) => `<a class="list-tile" href="${esc(href)}"><b>${esc(l.name)}</b><span>${num(l.item_count)} items${l.privacy ? ` · ${esc(l.privacy)}` : ''}</span>${l.description ? `<p>${esc(l.description)}</p>` : ''}</a>`;

// Rich card for the full grids: backdrop behind, poster on the left, details on the right.
function summaryCard(it, { sortValue, label, line, href, action } = {}) {
  const genres = (it.genres ?? []).slice(0, 2).join(', ');
  const score = sortValue ?? (it.rating ? `${Math.round(it.rating * 10)}%` : '');
  const tags = [label, it.year, it.type === 'tv' ? it.episodes && `${it.episodes} eps` : runtimeText(it.runtime)].filter(Boolean);
  return `<div class="media-card summary-card">
    <a class="summary-link" href="${href ?? `#/title/${it.type}/${it.id}`}" data-type="${it.type}" data-id="${it.id}" data-art="summary" title="${esc(it.title)}">
      <div class="summary-back"></div>
      <div class="art summary-thumb"><span class="cover-title">${esc(it.title)}</span>${downloadBadge(it.type, it.id)}</div>
      <div class="summary-body"><b>${esc(it.title)}</b>${line ? `<small>${esc(line)}</small>` : ''}${genres ? `<small class="muted">${esc(genres)}</small>` : ''}
        <div class="summary-tags">${tags.map(t => `<span class="meta-tag">${esc(t)}</span>`).join('')}</div>
        ${score ? `<span class="summary-score">${esc(score)}</span>` : ''}</div></a>
    ${cardMenuButton(it)}${action ?? ''}</div>`;
}

// Artwork comes from TMDB, one request per title. Only cards still near the screen wait for it, a few at a time,
// so scrolling quickly past hundreds of cards doesn't ask for all of them. The newest to arrive goes first.
const ART_AT_ONCE = 6;
const artWaiting = new Set();
let artLoading = 0;
const artObserver = new IntersectionObserver(entries => {
  for (const en of entries) {
    if (en.isIntersecting) artWaiting.add(en.target);
    else artWaiting.delete(en.target);
  }
  pumpArt();
}, { rootMargin: '300px' });
function pumpArt() {
  while (artLoading < ART_AT_ONCE && artWaiting.size) {
    const card = [...artWaiting].at(-1);
    artWaiting.delete(card);
    artObserver.unobserve(card);
    artLoading++;
    loadArt(card).catch(console.warn).finally(() => { artLoading--; pumpArt(); });
  }
}
async function loadArt(card) {
  const { type, id, art } = card.dataset;
  const a = await once(`art ${type} ${id}`, () => invoke('art', { kind: type, id: +id }));
  const paint = (el, size, file) => {
    if (!file) return;
    el.style.backgroundImage = `url('${IMG}${size}${file}')`;
    el.classList.add('has-art');
  };
  if (art === 'summary') {
    paint(card.querySelector('.summary-back'), 'w300', a.backdrop); // dimmed behind the card, so a small one is enough
    paint(card.querySelector('.summary-thumb'), 'w185', a.poster);
    return;
  }
  const cover = card.querySelector('.art');
  if (art !== 'backdrop') return paint(cover, 'w342', a.poster ?? a.backdrop);
  paint(cover, 'w780', a.backdrop ?? a.poster);
  if (a.logo) cover.insertAdjacentHTML('afterbegin', `<img class="cover-logo" src="${IMG}w300${esc(a.logo)}" alt="" loading="lazy">`);
}
const observeArt = root => root.querySelectorAll('[data-id]').forEach(c => artObserver.observe(c));

// Placeholders shaped like the page on its way, so nothing jumps when it arrives. They hold no data.
const skeletonCards = (n, kind = 'portrait') => Array.from({ length: n }, (_, i) =>
  `<div class="sk-card sk-${kind}" style="--d:${i * 60}ms"><div class="sk"></div><p class="sk"></p></div>`).join('');
function skeleton(kind) {
  const row = `<section class="row"><div class="row-head"><div class="sk sk-title"></div></div><div class="track">${skeletonCards(12)}</div></section>`;
  const body = {
    rows: `<div class="page">${row.repeat(3)}</div>`,
    grid: `<div class="page"><div class="grid">${skeletonCards(18)}</div></div>`,
    title: `<section class="summary"><div class="summary-inner"><div class="hero-poster"><div class="sk summary-poster"></div></div>
      <div class="summary-info sk-info"><div class="sk sk-heading"></div><p class="sk"></p><p class="sk"></p><p class="sk"></p></div></div></section>`,
  }[kind];
  return body ? `<div aria-hidden="true">${body}</div>` : '';
}
const SKELETONS = { home: 'rows', discover: 'rows', progress: 'grid', title: 'title', person: 'title', lists: 'rows', watchlist: 'grid', list: 'grid', search: 'grid', history: 'grid', library: 'grid', calendar: 'grid', hidden: 'grid', downloads: 'grid' };

// ---------- rows
function collapsedRows() {
  try {
    const saved = JSON.parse(localStorage.getItem('rows-collapsed'));
    return Array.isArray(saved) ? saved : [];
  } catch { return []; }
}
function saveRowCollapsed(id, collapsed) {
  const others = collapsedRows().filter(x => x !== id);
  try { localStorage.setItem('rows-collapsed', JSON.stringify(collapsed ? [...others, id] : others)); } catch {}
}

const ROW_ITEMS = 10; // as Trakt: a preview, with the row's title leading to everything
const EAGER_ROWS = 3; // these are on screen at once, so the page waits for them; the rest load as they come near
const rowLoaders = new WeakMap();
const rowObserver = new IntersectionObserver(entries => entries.forEach(en => { if (en.isIntersecting) rowLoaders.get(en.target)?.(); }), { rootMargin: '600px' });

const updateFade = track => track.classList.toggle('fade-end', track.scrollLeft + track.clientWidth < track.scrollWidth - 1);

const FILTER_EMPTY = '<div class="row-empty"><p class="muted">Nothing matches your filters.</p><button type="button" class="btn" data-reset-filters>Reset filters</button></div>';

// A grid that loads more as the person scrolls: past 50% of the page, or when it doesn't yet fill the window.
// One grid is active at a time, and route() clears it when the page changes.
let growGrid = null;
let restoreTarget = 0; // where route() will scroll to once the page has loaded
addEventListener('scroll', () => growGrid?.(), { passive: true });
async function renderGrid(into, { load, card, pageSize = 100, cls = '', filtered, empty = 'Nothing here yet.' }) {
  const token = routeToken;
  const grid = document.createElement('div');
  grid.className = `grid ${cls}`;
  const spinner = document.createElement('div');
  spinner.className = 'grid-more';
  spinner.hidden = true;
  spinner.setAttribute('aria-label', 'Loading more');
  spinner.innerHTML = '<span class="spinner"></span>';
  into.append(grid, spinner);
  let page = 1;
  let done = false;
  let inFlight = null;
  const more = () => {
    if (done) return Promise.resolve();
    return inFlight ??= fetchPage().finally(() => { inFlight = null; });
  };
  const fetchPage = async () => {
    spinner.hidden = false;
    let items;
    try { items = await load(page++); }
    catch (e) {
      if (page === 2) throw e; // the page itself failed
      done = true;
      toast(e);
    }
    if (token !== routeToken) { done = true; return; }
    spinner.hidden = true;
    if (done) return;
    const before = grid.children.length;
    grid.insertAdjacentHTML('beforeend', items.map(card).join(''));
    [...grid.children].slice(before).forEach(observeArt);
    done = items.length < pageSize;
    // `card` may leave a whole page out, so an empty grid only means nothing once the pages run out.
    if (done && !grid.children.length) grid.outerHTML = filtered && filterCount(activeFilters()) ? FILTER_EMPTY : `<div class="row-empty"><p class="muted">${esc(empty)}</p></div>`;
  };
  const pageHeight = () => document.documentElement.scrollHeight;
  const grow = () => {
    if (pageHeight() <= innerHeight * 1.2 || scrollY + innerHeight > pageHeight() * .5) more();
  };
  await more();
  // Coming back with Back, load as far as the person had scrolled so their place still exists.
  while (!done && token === routeToken && restoreTarget + innerHeight > pageHeight()) await more();
  if (token !== routeToken) return;
  growGrid = grow;
  grow();
}

// def: { id, title, load: async () => html, more?, kind: portrait|landscape|list, meta?, filtered?, bright?, empty?, actions? }
// `id` keys the saved collapse state. A failed row is removed, and so is an empty one, unless filters emptied it
// or it has an `empty` message: then the person should see why.
async function renderRows(defs, into = app) {
  const token = routeToken;
  const collapsed = collapsedRows();
  const rows = defs.filter(Boolean).map(def => {
    const sec = document.createElement('section');
    const kind = def.kind ?? 'portrait';
    sec.className = `row${collapsed.includes(def.id) ? ' collapsed' : ''}`;
    sec.dataset.row = def.id;
    sec.innerHTML = `<div class="row-head">
        <button type="button" class="row-collapse" aria-expanded="${!collapsed.includes(def.id)}" aria-label="Collapse ${esc(def.title)}">${icon('chevron')}</button>
        <div class="row-heading">${def.more ? `<a class="row-title" href="${def.more}"><h2>${esc(def.title)}</h2>${icon('chevron')}</a>` : `<h2>${esc(def.title)}</h2>`}
          ${def.meta ? `<small class="muted">${esc(def.meta)}</small>` : ''}</div>${def.actions ? `<div class="row-tools">${def.actions}</div>` : ''}</div>
      <div class="row-body"><div class="track kind-${kind}${def.bright ? ' bright' : ''}">${skeletonCards(8, kind)}</div></div>`;
    into.append(sec);
    const load = async () => {
      if (sec.dataset.loaded) return;
      sec.dataset.loaded = '1';
      rowObserver.unobserve(sec);
      const html = await def.load().catch(e => { console.warn(def.title, e); return null; });
      if (token !== routeToken || !sec.isConnected) return;
      const track = sec.querySelector('.track');
      if (html === null) return sec.remove();
      if (!html) {
        if (def.filtered && filterCount(activeFilters())) track.innerHTML = FILTER_EMPTY;
        else if (def.empty) track.innerHTML = `<div class="row-empty"><p class="muted">${esc(def.empty)}</p></div>`;
        else sec.remove();
        return;
      }
      track.innerHTML = html;
      if (def.more) while (track.children.length > ROW_ITEMS) track.lastElementChild.remove();
      if (def.more && track.children.length <= 4) track.insertAdjacentHTML('beforeend', `<a class="cta-card" href="${def.more}">${icon('chevron')}<span>View all</span></a>`);
      // A row with a full page doesn't scroll with the mouse, except for a sideways wheel. Keyboard focus still scrolls it.
      if (def.more && track.children.length > 1) track.classList.add('locked');
      observeArt(sec);
      updateFade(track);
    };
    rowLoaders.set(sec, load);
    return [sec, load];
  });
  const open = rows.filter(([sec]) => !sec.classList.contains('collapsed'));
  open.slice(EAGER_ROWS).forEach(([sec]) => rowObserver.observe(sec));
  await Promise.all(open.slice(0, EAGER_ROWS).map(([, load]) => load()));
}

document.addEventListener('wheel', ev => {
  const track = ev.target.closest?.('.track.locked');
  if (track && Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) track.scrollLeft += ev.deltaX;
}, { passive: true });
document.addEventListener('scroll', ev => { if (ev.target.classList?.contains('track')) updateFade(ev.target); }, { passive: true, capture: true });

// ---------- card menu
// A 420 means an account limit. /users/settings says what the limit is, when Trakt sent it.
const listLimitMessage = (e, key, message) => String(e).startsWith('420') && user?.limits?.list?.[key] ? message : e;

function openListPicker(it) {
  const tt = traktType(it.type);
  const d = drawer({ title: 'Add to list', body: '<p class="muted">Loading your lists…</p>' });
  const body = d.querySelector('.drawer-body');
  traktGet('/users/me/lists').then(lists => {
    if (!lists.length) { body.innerHTML = '<p class="muted">You have no lists yet.</p>'; return; }
    body.innerHTML = `<div class="list-picker">${lists.map(l => `<button type="button" class="btn" data-list="${l.ids.trakt}">${esc(l.name)}</button>`).join('')}</div>`;
    body.onclick = async ev => {
      const button = ev.target.closest('[data-list]');
      if (!button) return;
      const list = lists.find(l => String(l.ids.trakt) === button.dataset.list);
      try {
        const r = await trakt('POST', `/users/me/lists/${list.ids.trakt}/items`, { [`${tt}s`]: [ids(it.id)] });
        toast(`${r?.added?.[`${tt}s`] ? 'Added to' : 'Already in'} ${list.name}`);
        d.close();
      } catch (e) { toast(listLimitMessage(e, 'item_count', `Lists can hold ${num(user?.limits?.list?.item_count)} items on your Trakt account.`)); }
    };
  }, e => { body.innerHTML = `<p class="error">${esc(e)}</p>`; });
}

function cardMenuItems(it) {
  const tt = traktType(it.type);
  const body = { [`${tt}s`]: [ids(it.id)] };
  const act = async (path, done) => {
    try {
      await write(path, body);
      if (it.type === 'tv') await refreshProgress().catch(console.warn);
      toast(done);
      route({ soft: true });
    } catch (e) { toast(e); }
  };
  const listed = inWatchlist(tt, it.id);
  return [
    { label: listed ? 'Remove from watchlist' : 'Add to watchlist', icon: listed ? 'close' : 'plus', onClick: () => act(listed ? '/sync/watchlist/remove' : '/sync/watchlist', listed ? 'Removed from watchlist' : 'Added to watchlist') },
    { label: 'Mark watched', icon: 'check', onClick: () => {
      if (it.type === 'movie') return act('/sync/history', 'Marked watched on Trakt');
      // This writes every episode to Trakt, so it asks first.
      modal({
        title: 'Mark every episode watched?',
        body: `<p class="muted">This adds all episodes of ${esc(it.title)} to your Trakt history.</p>`,
        actions: [{ label: 'Cancel' }, { label: 'Mark all watched', primary: true, onClick: () => act('/sync/history', 'Marked watched on Trakt') }],
      });
    } },
    { label: 'Add to list', icon: 'list', onClick: () => openListPicker(it) },
  ];
}

document.addEventListener('click', ev => {
  if (ev.target.closest('[data-reset-filters]')) {
    setActiveFilters(savedDefaultFilters());
    route({ soft: true });
    return;
  }
  const collapse = ev.target.closest('.row-collapse');
  if (collapse) {
    const sec = collapse.closest('.row');
    const collapsed = sec.classList.toggle('collapsed');
    collapse.setAttribute('aria-expanded', String(!collapsed));
    saveRowCollapsed(sec.dataset.row, collapsed);
    if (!collapsed) rowLoaders.get(sec)?.();
    return;
  }
  // The button's own popover behaviour opens this right after the click, and route() removes it with the page.
  const more = ev.target.closest('.card-menu');
  if (more && !more.popoverTargetElement) {
    menu(more, cardMenuItems({ type: more.dataset.menuType, id: +more.dataset.menuId, title: more.dataset.menuTitle }));
    return;
  }
  const watch = ev.target.closest('[data-watch]');
  if (watch) return markWatchedFromCard(watch);
  const removal = ev.target.closest('[data-remove-path]');
  if (removal) {
    const { removePath, removeType, idValue, removeDone } = removal.dataset;
    return removeCard(removal, removePath, { [`${traktType(removeType)}s`]: [ids(+idValue)] }, removeDone);
  }
  const play = ev.target.closest('[data-remove-play]');
  if (play) {
    modal({
      title: 'Remove this play?',
      body: '<p class="muted">It will be removed from your Trakt history. Other plays of this title stay.</p>',
      actions: [{ label: 'Cancel' }, { label: 'Remove play', primary: true, onClick: () => removeCard(play, '/sync/history/remove', { ids: [+play.dataset.removePlay] }, 'Removed from your history') }],
    });
  }
});

async function removeCard(button, path, body, done) {
  button.disabled = true;
  const grid = button.closest('.grid');
  try {
    await write(path, body);
    await refreshProgress().catch(console.warn);
    button.closest('.media-card')?.remove();
    toast(done);
    if (grid && !grid.querySelector('.media-card')) route({ soft: true }); // shows the page's empty message
  } catch (e) {
    button.disabled = false;
    toast(e);
  }
}

// Only ever runs on a press: Filmie doesn't check in or scrobble.
async function markWatchedFromCard(button) {
  const { watch, idValue, s, e } = button.dataset;
  button.disabled = true;
  try {
    await write('/sync/history', watch === 'tv' ? episodeBody(+idValue, s, e) : { movies: [ids(+idValue)] });
    await refreshProgress().catch(console.warn);
    toast('Marked watched on Trakt');
    await route({ soft: true });
  } catch (err) {
    button.disabled = false;
    toast(err);
  }
}

const signInPrompt = what => `<div class="page"><section class="callout"><h2>Sign in with Trakt</h2>
  <p>Connect your Trakt account to see your ${what}.</p><a class="btn primary" href="#/settings">Sign in with Trakt</a></section></div>`;

function profileHeader(s) {
  const u = user.user;
  const stat = (value, label) => `<div><b>${esc(value)}</b><span>${esc(label)}</span></div>`;
  const streak = streakFrom(s.days, isoDate());
  const totals = [
    getMode() !== 'show' && stat(num(s.movies), 'movies'),
    getMode() !== 'movie' && stat(num(s.shows), 'shows'),
    getMode() !== 'movie' && stat(num(s.episodes), 'episodes'),
    stat(durationText(s.minutes), 'watched'),
    stat(num(streak), 'day streak'),
  ].filter(Boolean).join('');
  return `<section class="profile">${avatar('big')}
    <div class="who"><h1>${esc(u.name || u.username)}</h1><p class="muted">@${esc(u.username)}${u.location ? ` · ${esc(u.location)}` : ''}${u.vip ? ' · VIP' : ''}</p></div>
    <div class="stats">${totals}</div></section>`;
}

// The Home callout. It only appears with a streak going, and leads to Profile.
function streakCallout(days) {
  const today = isoDate();
  const streak = streakFrom(days, today);
  if (!streak) return '';
  const week = weekHeatmap(days, today);
  const label = n => new Date(`${addDays(today, n - 6)}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'narrow', timeZone: 'UTC' });
  return `<a class="streak" href="#/profile">${icon('flame')}<span class="streak-text"><b>${num(streak)}-day streak</b><small class="muted">See your stats</small></span>
    <span class="streak-week" role="img" aria-label="Watched on ${week.filter(Boolean).length} of the last 7 days">${week.map((on, i) => `<span class="${on ? 'on' : ''}"><i></i><small>${esc(label(i))}</small></span>`).join('')}</span>${icon('forward')}</a>`;
}

const watchers = x => `${num(x.watchers)} watching`;
const anticipated = x => `${num(x.list_count)} lists`;
