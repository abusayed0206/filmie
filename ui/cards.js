// Cards, rows and loading placeholders.
// ---------- cards
function cardMenuButton(it) {
  if (!user) return '';
  return `<button type="button" class="card-menu" aria-label="More for ${esc(it.title)}" data-menu-type="${it.type}" data-menu-id="${it.id}" data-menu-title="${esc(it.title)}">${icon('more')}</button>`;
}

function posterCard(it, { label } = {}) {
  const tt = traktType(it.type);
  const started = it.type === 'tv' && nextEps.has(it.id);
  const watched = it.type === 'movie' ? watchedMovie(it.id) : !!watchedShow(it.id) && !started;
  const status = statusTag({ watched, started, postCredits: it.postCredits, watchlisted: inWatchlist(tt, it.id) });
  // Media mode mixes both types, so each card says which it is.
  const typeTag = getMode() === 'media' ? `<i class="tag type-tag" title="${it.type === 'tv' ? 'Show' : 'Movie'}">${icon(it.type === 'tv' ? 'tv' : 'film')}</i>` : '';
  const tags = (label ? [label] : [it.year, it.type === 'tv' ? it.episodes && `${it.episodes} eps` : runtimeText(it.runtime)]).filter(Boolean);
  return `<div class="media-card${watched ? ' is-watched' : ''}">
    <a class="poster" href="#/title/${it.type}/${it.id}" data-type="${it.type}" data-id="${it.id}" title="${esc(it.title)}" aria-label="${esc([it.title, it.year].filter(Boolean).join(', '))}">
      <div class="art"><span class="cover-title">${esc(it.title)}</span><div class="tags">${typeTag}</div>${status ? `<i class="status-tag">${esc(status)}</i>` : ''}</div>
      <div class="card-footer">${tags.map(t => `<span class="meta-tag">${esc(t)}</span>`).join('')}</div></a>
    ${cardMenuButton(it)}</div>`;
}
const posters = (items, type, label) => (items ?? []).map(x => [norm(x, type), x]).filter(([it]) => it).map(([it, x]) => posterCard(it, { label: label?.(x) })).join('');
const traktPosters = (path, type, label) => async () => posters(await traktGet(path), type, label);

function progressCard(href, it, line, pct, note) {
  return `<a class="ep-card" href="${href}" data-type="${it.type}" data-id="${it.id}" data-art="backdrop" title="${esc(it.title)}">
    <div class="art"><span class="cover-title">${esc(it.title)}</span><span class="play-icon">${icon('play')}</span></div>
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
const recentCards = async () => (await invoke('history_list', { limit: 30 })).filter(p => forMode(true, p.kind === 'tv', p.kind === 'movie')).map(p => {
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

// Rich card for the full grids: backdrop behind, poster on the left, details on the right.
function summaryCard(it, { sortValue } = {}) {
  const genres = (it.genres ?? []).slice(0, 2).join(', ');
  const score = sortValue ?? (it.rating ? `${Math.round(it.rating * 10)}%` : '');
  return `<div class="media-card summary-card">
    <a class="summary-link" href="#/title/${it.type}/${it.id}" data-type="${it.type}" data-id="${it.id}" data-art="backdrop" title="${esc(it.title)}">
      <div class="art"></div>
      <div class="summary-body"><b>${esc(it.title)}</b>${genres ? `<small class="muted">${esc(genres)}</small>` : ''}
        <div class="summary-tags">${[it.year, it.type === 'tv' ? it.episodes && `${it.episodes} eps` : runtimeText(it.runtime)].filter(Boolean).map(t => `<span class="meta-tag">${esc(t)}</span>`).join('')}</div>
        ${score ? `<span class="summary-score">${esc(score)}</span>` : ''}</div></a>
    ${cardMenuButton(it)}</div>`;
}

// Artwork comes from TMDB, fetched only when a card scrolls near the screen.
const artObserver = new IntersectionObserver(entries => entries.forEach(async en => {
  if (!en.isIntersecting) return;
  artObserver.unobserve(en.target);
  const { type, id, art } = en.target.dataset;
  const landscape = art === 'backdrop';
  const d = await (landscape ? tmdb(`/${type}/${id}`, { append_to_response: 'images', include_image_language: 'en,null' }) : tmdb(`/${type}/${id}`)).catch(() => null);
  const cover = en.target.querySelector('.art');
  const path = landscape ? d?.backdrop_path ?? d?.poster_path : d?.poster_path ?? d?.backdrop_path;
  if (path) {
    cover.style.backgroundImage = `url('${IMG}${landscape ? 'w780' : 'w342'}${path}')`;
    cover.classList.add('has-art');
  }
  const logo = landscape && d?.images?.logos?.[0]?.file_path;
  if (logo) cover.insertAdjacentHTML('afterbegin', `<img class="cover-logo" src="${IMG}w300${esc(logo)}" alt="" loading="lazy">`);
}), { rootMargin: '400px' });
const observeArt = root => root.querySelectorAll('[data-id]').forEach(c => artObserver.observe(c));

// Placeholders shaped like the page on its way, so nothing jumps when it arrives. They hold no data.
const skeletonCards = (n, kind = 'portrait') => Array.from({ length: n }, (_, i) =>
  `<div class="sk-card sk-${kind}" style="--d:${i * 60}ms"><div class="sk"></div><p class="sk"></p></div>`).join('');
function skeleton(kind) {
  const row = `<section class="row"><div class="row-head"><div class="sk sk-title"></div></div><div class="track">${skeletonCards(12)}</div></section>`;
  const body = {
    rows: `<div class="page">${row.repeat(3)}</div>`,
    grid: `<div class="page"><div class="grid">${skeletonCards(18)}</div></div>`,
    title: `<section class="summary"><div class="summary-inner"><div class="sk summary-poster sk-poster"></div>
      <div class="summary-info sk-info"><div class="sk sk-heading"></div><p class="sk"></p><p class="sk"></p><p class="sk"></p></div></div></section>`,
  }[kind];
  return body ? `<div aria-hidden="true">${body}</div>` : '';
}
const SKELETONS = { home: 'rows', discover: 'rows', progress: 'rows', title: 'title', lists: 'grid', watchlist: 'grid', list: 'grid', search: 'grid' };

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

// def: { id, title, load: async () => html, more?, kind: portrait|landscape|list, meta?, filtered?, bright?, empty? }
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
          ${def.meta ? `<small class="muted">${esc(def.meta)}</small>` : ''}</div></div>
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
        if (def.filtered && filterCount(activeFilters())) track.innerHTML = '<div class="row-empty"><p class="muted">Nothing matches your filters.</p><button type="button" class="btn" data-reset-filters>Reset filters</button></div>';
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
      } catch (e) { toast(e); }
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
  }
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
