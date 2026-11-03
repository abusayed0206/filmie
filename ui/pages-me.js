// The signed-in user's pages and Settings.
// Each page remembers its sort until the app closes, so Back returns to the same order.
const sortChoice = new Map();
const chosenSort = sorts => sorts.find(s => s.value === sortChoice.get(location.hash)) ?? sorts[0];
const sortButton = sorts => `<button type="button" class="btn" data-sort-open>Sort: ${esc(chosenSort(sorts).label)}</button>`;
function bindSort(root, sorts) {
  root.querySelector('[data-sort-open]').onclick = () => {
    const now = chosenSort(sorts).value;
    const d = drawer({ title: 'Sort', width: 400, body: `<div class="list-picker">${sorts.map(s => `<button type="button" class="btn${s.value === now ? ' on' : ''}" data-sort="${esc(s.value)}">${esc(s.label)}</button>`).join('')}</div>` });
    d.querySelector('.list-picker').onclick = ev => {
      const button = ev.target.closest('[data-sort]');
      if (!button) return;
      sortChoice.set(location.hash, button.dataset.sort);
      d.close();
      route({ soft: true });
    };
  };
}
const SHOW_SORTS = [{ value: '', label: 'Default' }, { value: 'smart', label: 'Smart', how: 'desc' }, { value: 'released', label: 'Release date', how: 'desc' }, { value: 'remaining', label: 'Remaining', how: 'asc' }];
const sortQuery = sort => sort.value ? `&sort_by=${sort.value}&sort_how=${sort.how}` : '';
// The default is the person's own order on Trakt.
const LIST_SORTS = [
  { value: '', by: 'rank', how: 'asc', label: 'Default' }, { value: 'added', how: 'desc', label: 'Added date' }, { value: 'runtime', how: 'desc', label: 'Runtime' },
  { value: 'percentage', how: 'desc', label: 'Rating' }, { value: 'my_rating', how: 'desc', label: 'My rating' }, { value: 'released', how: 'desc', label: 'Release date' }, { value: 'title', how: 'asc', label: 'Title' },
];
const WATCHLIST_SORTS = [...LIST_SORTS, { value: 'rank', how: 'asc', label: 'Rank' }];
const sortPath = sort => `${sort.by ?? sort.value}/${sort.how}`;
// A summary card whose score shows what the list is sorted by.
function sortedCard(x, sort, opts) {
  const it = norm(x);
  return it ? summaryCard(it, { sortValue: sortValue(x, sort.value, myRating(traktType(it.type), it.id)), ...opts?.(it) }) : '';
}
// Trakt names single types differently on list items and on the sync routes.
const itemTypes = () => forMode('movie,show', 'show', 'movie');
const syncTypes = () => forMode('movie,show', 'shows', 'movies');

// A chosen sort keeps Trakt's order for shows, so paused movies go first rather than being mixed in by date.
const mergeProgress = (shows, movies, sorted) => sorted ? [...movies, ...shows] : mergeContinue(shows, movies);
function progressGridCard(x) {
  const it = norm(x, x.show ? 'show' : 'movie');
  if (!it) return '';
  if (!x.show) return summaryCard(it, { href: `#/play/movie/${it.id}`, line: `${Math.round(x.progress)}% watched`, action: watchAction(it) });
  const ep = x.progress.next_episode;
  if (!ep) return '';
  return summaryCard(it, { href: `#/play/tv/${it.id}/${ep.season}/${ep.number}`, line: episodeLine(ep), label: `${x.progress.aired - x.progress.completed} left`, action: watchAction(it, ep.season, ep.number) });
}
Object.assign(pages, {
  async progress() {
    if (!user) { app.innerHTML = signInPrompt('progress'); return; }
    const sort = chosenSort(SHOW_SORTS);
    app.innerHTML = `<div class="page"><h1 class="sr-only">Continue Watching</h1>
      <div class="page-tools">${sortButton(SHOW_SORTS)}</div></div>`;
    const into = app.firstElementChild;
    bindSort(into, SHOW_SORTS);
    const query = sortQuery(sort);
    await renderGrid(into, {
      cls: 'summary-grid', empty: 'Nothing in progress. Start something and it will show here.',
      pageSize: getMode() === 'movie' ? Infinity : 100,
      // Paused movies all come with the first page.
      load: async page => {
        const shows = getMode() === 'movie' ? [] : await traktGet(`/sync/progress/up_next_nitro?page=${page}&limit=100${query}`);
        const movies = page > 1 || getMode() === 'show' ? [] : await traktGet('/sync/playback/movies?limit=100');
        return mergeProgress(shows ?? [], movies ?? [], !!sort.value);
      },
      card: progressGridCard,
    });
  },

  // Week by default, or one day. Trakt's calendar takes a start date and a number of days.
  async calendar() {
    if (!user) { app.innerHTML = signInPrompt('calendar'); return; }
    const kind = getMode() === 'movie' ? 'all' : calendarPageKind;
    const path = kind === 'all' ? forMode('media', 'shows', 'movies') : `shows/${kind}`;
    const anchor = calendarDate ?? isoDate();
    const week = calendarView === 'week';
    const start = week ? weekStart(anchor) : anchor;
    const label = week ? `${shortDate(start)} – ${shortDate(addDays(start, 6))}` : fullDate(anchor);
    app.innerHTML = `<div class="page"><h1 class="sr-only">Calendar</h1>
      <div class="page-tools calendar-tools">
        <button type="button" class="icon-btn ghost" id="calendar-prev" aria-label="Previous ${calendarView}">${icon('back')}</button>
        <button type="button" class="btn" id="calendar-today">Today</button>
        <button type="button" class="icon-btn ghost" id="calendar-next" aria-label="Next ${calendarView}">${icon('forward')}</button>
        <b class="calendar-label" aria-live="polite">${esc(label)}</b>
        <span class="calendar-switches">${getMode() === 'movie' ? '' : segmented('calendar-page-kind', RELEASE_KINDS, kind, v => { calendarPageKind = v; route({ soft: true }); }, 'Episode type')}
          ${segmented('calendar-view', [{ value: 'week', label: 'Week' }, { value: 'day', label: 'Day' }], calendarView, v => { calendarView = v; route({ soft: true }); }, 'Calendar view')}</span>
      </div></div>`;
    const into = app.firstElementChild;
    const go = (id, date) => {
      into.querySelector(`#${id}`).onclick = () => {
        calendarDate = date;
        route({ soft: true });
      };
    };
    go('calendar-prev', addDays(start, week ? -7 : -1));
    go('calendar-today', null);
    go('calendar-next', addDays(start, week ? 7 : 1));
    const fetchDays = async (from, days) => (await traktGet(withFilters(`/calendars/my/${path}/${from}/${days}`)) ?? []).sort(byAirDate);
    if (!week) {
      return renderGrid(into, {
        cls: 'landscape-grid', filtered: true, empty: 'Nothing on this day.', pageSize: Infinity,
        load: async () => fetchDays(anchor, 1), card: calendarCard,
      });
    }
    // More weeks load on scroll. Quiet weeks are skipped, but only so far, because each one costs a request.
    let next = 0;
    await renderGrid(into, {
      cls: 'landscape-grid', filtered: true, empty: 'Nothing coming up in the next two months.', pageSize: 1,
      load: async () => {
        for (let tries = 0; tries < 8; tries++) {
          const items = await fetchDays(addDays(start, 7 * next++), 7);
          if (items.length) return items;
        }
        return [];
      },
      card: dayHeadings(calendarCard),
    });
  },

  async history() {
    if (!user) { app.innerHTML = signInPrompt('history'); return; }
    app.innerHTML = '<div class="page"><h1 class="sr-only">History</h1></div>';
    await renderGrid(app.firstElementChild, {
      cls: 'landscape-grid', empty: 'What you mark watched will show here.',
      load: page => traktGet(`/sync/history${forMode('', '/episodes', '/movies')}?page=${page}&limit=100&extended=full`),
      card: x => historyCard(x, { removable: true }),
    });
  },

  async library() {
    if (!user) { app.innerHTML = signInPrompt('library'); return; }
    app.innerHTML = '<div class="page"><h1 class="sr-only">Library</h1></div>';
    const type = forMode('media', 'shows', 'movies');
    const seen = new Set(); // Media lists each collected episode, and a show only needs one card.
    await renderGrid(app.firstElementChild, {
      cls: 'summary-grid', empty: 'Nothing in your library yet. Titles can be added from their page, under More.',
      // Trakt doesn't page the show collection.
      pageSize: type === 'shows' ? Infinity : 100,
      load: page => traktGet(`/sync/collection/${type}?page=${page}&limit=100&extended=full`),
      card: x => {
        const it = norm(x);
        if (!it || seen.has(it.type + it.id)) return '';
        seen.add(it.type + it.id);
        return summaryCard(it, { label: x.collected_at ? fullDate(x.collected_at) : '', action: removeAction(it, '/sync/collection/remove', 'Remove from library') });
      },
    });
  },

  async profile(sub) {
    if (!user) return signedOutProfile();
    if (Object.hasOwn(PROFILE_VIEWS, sub ?? '')) return PROFILE_VIEWS[sub].open();
    const token = routeToken;
    const stats = await invoke('stats', { kind: forMode(null, 'episode', 'movie') });
    if (token !== routeToken) return;
    runHistorySync();
    app.innerHTML = `<div class="page">${profileHeader(stats)}
      <p class="muted history-progress" id="history-progress" role="status">${esc(historyProgressText(stats))}</p>
      ${statsCharts(stats)}
      <h2>Your Trakt activity</h2>
      <div class="tiles">${Object.entries(PROFILE_VIEWS).map(([key, v]) => `<a class="list-tile" href="#/profile/${key}"><b>${esc(v.title)}</b><p>${esc(v.about)}</p></a>`).join('')}</div></div>`;
  },

  async lists(kind) {
    if (!user) { app.innerHTML = signInPrompt('lists'); return; }
    if (Object.hasOwn(LIST_KINDS, kind ?? '')) return listsOfKind(kind);
    const shared = await traktGet('/users/me/lists/collaborations').catch(() => null);
    const options = Object.entries(LIST_KINDS).filter(([key]) => key !== 'shared' || shared).map(([value, k]) => ({ value, label: k.switch }));
    if (!options.some(o => o.value === listsKind)) listsKind = 'personal';
    app.innerHTML = '<div class="page"><h1 class="sr-only">Lists</h1></div>';
    await renderRows([
      {
        id: 'lists-watchlist', title: 'Watchlist', more: '#/watchlist', empty: 'Your watchlist is empty.',
        load: traktPosters(`/sync/watchlist/${syncTypes()}/rank/asc?limit=${ROW_ITEMS}&extended=full`),
      },
      {
        id: 'lists-mine', title: 'My Lists', more: `#/lists/${listsKind}`, kind: 'list', empty: LIST_KINDS[listsKind].empty,
        actions: `${segmented('lists-kind', options, listsKind, v => { listsKind = v; route({ soft: true }); }, 'List type')}<button type="button" class="btn" data-create-list>${icon('plus')}New list</button>`,
        load: async () => (await loadLists(listsKind)).map(l => listTile(l, listHref(l, listsKind))).join(''),
      },
    ], app.firstElementChild);
  },

  async watchlist() {
    if (!user) { app.innerHTML = signInPrompt('watchlist'); return; }
    const sort = chosenSort(WATCHLIST_SORTS);
    app.innerHTML = `<div class="page"><h1 class="sr-only">Watchlist</h1><div class="page-tools">${sortButton(WATCHLIST_SORTS)}</div></div>`;
    const into = app.firstElementChild;
    bindSort(into, WATCHLIST_SORTS);
    await renderGrid(into, {
      cls: 'summary-grid', empty: 'Your watchlist is empty.',
      load: page => traktGet(`/sync/watchlist/${syncTypes()}/${sortPath(sort)}?page=${page}&limit=100&extended=full`),
      card: x => sortedCard(x, sort),
    });
  },

  // scope is "public" for lists reached from a title or person, which may belong to anyone,
  // and "user" for a list someone else shares with this account.
  async list(id, scope, owner) {
    if (!user && scope !== 'public') { app.innerHTML = signInPrompt('lists'); return; }
    const token = routeToken;
    const own = !scope;
    const base = scope === 'public' ? `/lists/${+id}` : scope === 'user' ? `/users/${encodeURIComponent(owner)}/lists/${+id}` : `/users/me/lists/${+id}`;
    const meta = await traktGet(base);
    if (token !== routeToken) return;
    setBarTitle(meta.name);
    const sort = chosenSort(LIST_SORTS);
    app.innerHTML = `<div class="page"><h1 class="sr-only">${esc(meta.name)}</h1>
      <p class="muted list-meta">${num(meta.item_count)} items${meta.description ? ` · ${esc(meta.description)}` : ''}</p>
      <div class="page-tools">${sortButton(LIST_SORTS)}${own ? `<button type="button" class="btn" id="list-edit">Edit</button><button type="button" class="btn danger" id="list-delete">Delete</button>` : ''}</div></div>`;
    const into = app.firstElementChild;
    bindSort(into, LIST_SORTS);
    if (own) {
      into.querySelector('#list-edit').onclick = () => openListForm(meta);
      into.querySelector('#list-delete').onclick = () => confirmDeleteList(meta);
    }
    await renderGrid(into, {
      cls: 'summary-grid', filtered: true, empty: 'This list is empty.',
      load: page => traktGet(withFilters(`${base}/items/${itemTypes()}/${sortPath(sort)}?page=${page}&limit=100&extended=full`)),
      card: x => sortedCard(x, sort, it => own ? { action: removeAction(it, `/users/me/lists/${+id}/items/remove`, 'Remove from list') } : {}),
    });
  },

  async hidden() {
    if (!user) { app.innerHTML = signInPrompt('hidden items'); return; }
    const section = HIDDEN_SECTIONS.find(s => s.value === hiddenSection) ?? HIDDEN_SECTIONS[0];
    app.innerHTML = `<div class="page"><h1 class="sr-only">Hidden items</h1>
      <div class="page-tools">${segmented('hidden-section', HIDDEN_SECTIONS, section.value, v => { hiddenSection = v; route({ soft: true }); }, 'Hidden from')}</div></div>`;
    await renderGrid(app.firstElementChild, {
      cls: 'summary-grid', empty: `Nothing is hidden from ${section.label}.`,
      load: page => traktGet(`/users/hidden/${section.value}?page=${page}&limit=100&extended=full`),
      // shortcut: a hidden season has no card, since Filmie has no season cards. Upgrade if people hide single seasons.
      card: x => {
        const it = x.season ? null : norm(x);
        return it ? summaryCard(it, { label: x.hidden_at ? fullDate(x.hidden_at) : '', action: removeAction(it, `/users/hidden/${section.value}/remove`, 'Unhide', 'Unhidden') }) : '';
      },
    });
  },

  async settings() {
    const limits = user?.limits;
    const field = (title, help, control) => `<div class="field"><div><b>${title}</b><p class="muted">${help}</p></div>${control}</div>`;
    app.innerHTML = `<div class="page settings"><h1 class="sr-only">Settings</h1>
      <section class="card" id="trakt-box">
        <div class="card-head"><h2>Trakt account</h2><p class="muted">Your watchlist, lists, recommendations and watch history.</p></div>
        ${user ? `<div class="account-row">${avatar('big')}
            <div class="who"><b>${esc(user.user.name || user.user.username)}</b><span class="muted">@${esc(user.user.username)}${user.user.vip ? ' · VIP' : ''}</span>
              ${limits ? `<small class="muted">Limits: ${num(limits.watchlist?.item_count)} watchlist items · ${num(limits.list?.count)} lists of ${num(limits.list?.item_count)} items</small>` : ''}</div>
            <div class="row-actions"><a class="btn" href="#/hidden">Hidden items</a><button id="sync" class="btn">${icon('sync')}Sync now</button><button id="signout" class="btn">${icon('logout')}Sign out</button></div></div>`
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
        ${user ? field('Trakt history and ratings', '<span id="history-info">Checking…</span> A copy kept here so your stats work offline. Signing out deletes it.', '') : ''}
      </section>
      <section class="card about">
        <div class="card-head"><h2>About</h2></div>
        <p>Filmie uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.
        <a href="https://www.themoviedb.org/" target="_blank">themoviedb.org</a></p>
        <p>Filmie uses Trakt but is not endorsed or certified by Trakt.</p>
        <p>Streaming availability data by <a href="https://www.justwatch.com/" target="_blank">JustWatch</a>.</p>
        <p>Ad blocking by uBlock Origin Lite (GPLv3), <a href="https://github.com/uBlockOrigin/uBOL-home" target="_blank">source</a>.</p>
        <p class="muted">Privacy: your Trakt tokens are kept in Windows Credential Manager, and your library copy and avatar in this app's data folder. Signing out deletes all of them. Your Recently played list, cached pages, and a copy of your Trakt history and ratings are kept in a local database. You can clear the first two above, and signing out deletes the copy of your history and ratings.</p></section></div>`;
    const $ = id => document.getElementById(id);
    busy($('connect'), () => connectTrakt($('trakt-box')).catch(e => { route(); throw e; }));
    busy($('signout'), async () => { await invoke('sign_out'); await refreshUser(); route(); });
    busy($('sync'), async () => { lib = await invoke('sync'); await refreshProgress(); toast('Synced'); });
    const showCache = () => invoke('cache_info').then(c => {
      const info = $('cache-info');
      if (info) info.textContent = `${num(c.count)} saved responses, ${(c.bytes / 1048576).toFixed(1)} MB.`; // gone if the page was left
    }, console.warn);
    showCache();
    if (user) invoke('stats', { kind: null }).then(s => {
      const info = $('history-info');
      if (info) info.textContent = `${num(s.synced)} plays saved.`;
    }, console.warn);
    busy($('clear-cache'), async () => { await invoke('cache_clear'); await showCache(); toast('Cache cleared'); });
    busy($('clear-recent'), async () => { await invoke('history_clear'); toast('Recently played cleared'); });
    $('quality').onchange = ev => { setQuality(ev.target.value); toast('Preferred quality saved'); };
    renderServers($('servers'));
  },
});

// Filters only appear where Trakt's endpoint takes them, which leaves out the sync routes behind most of these pages.
pages.progress.bar = { title: 'Continue Watching', mode: 'bar' };
pages.calendar.bar = { title: 'Calendar', mode: 'bar', filters: 'local' };
pages.history.bar = { title: 'History', mode: 'bar' };
pages.library.bar = { title: 'Library', mode: 'bar' };
pages.profile.bar = sub => {
  const view = Object.hasOwn(PROFILE_VIEWS, sub ?? '') ? PROFILE_VIEWS[sub] : null;
  return view ? { title: view.title, back: true, mode: view.mode } : { title: 'Profile', mode: user ? 'bar' : false };
};
pages.lists.bar = kind => Object.hasOwn(LIST_KINDS, kind ?? '') ? { title: LIST_KINDS[kind].title, mode: 'bar' } : { title: 'Lists', mode: 'bar' };
pages.watchlist.bar = () => {
  const count = forMode(['movies', 'shows'], ['shows'], ['movies']).reduce((n, t) => n + (lib?.[`watchlist_${t}`]?.length ?? 0), 0);
  return { title: 'Watchlist', meta: user ? `${num(count)} items` : '', mode: 'bar' };
};
pages.list.bar = { title: 'List', back: true, mode: 'bar', filters: 'local' };
pages.hidden.bar = { title: 'Hidden items', back: true };
pages.settings.bar = { title: 'Settings' };

// ---------- calendar and hidden-item state, kept until the app closes
let calendarView = 'week';
let calendarPageKind = 'all';
let calendarDate = null; // null is today
const HIDDEN_SECTIONS = [{ value: 'progress_watched', label: 'Progress' }, { value: 'calendar', label: 'Calendar' }, { value: 'recommendations', label: 'Recommendations' }];
let hiddenSection = HIDDEN_SECTIONS[0].value;

// ---------- lists
const LIST_KINDS = {
  personal: { title: 'My Lists', switch: 'Personal', empty: 'You have no lists yet.' },
  liked: { title: 'Liked', switch: 'Liked', empty: "You haven't liked any lists yet." },
  shared: { title: 'Shared', switch: 'Shared', empty: 'Nobody has shared a list with you yet.' },
};
let listsKind = 'personal';
const PERSONAL_SORTS = [{ value: '', label: 'Rank' }, { value: 'name', label: 'Name' }, { value: 'updated', label: 'Updated' }, { value: 'created', label: 'Created' }];
async function loadLists(kind) {
  if (kind === 'liked') return ((await traktGet('/users/likes/lists?limit=100')) ?? []).map(x => x.list).filter(Boolean);
  return (await traktGet(kind === 'shared' ? '/users/me/lists/collaborations' : '/users/me/lists')) ?? [];
}
// Whose address a list lives at depends on how it reached this account.
const listRoute = (l, kind) => {
  const owner = l.user?.ids?.slug;
  return kind === 'personal' ? { href: `#/list/${+l.ids.trakt}`, base: `/users/me/lists/${+l.ids.trakt}` }
    : kind === 'shared' && owner ? { href: `#/list/${+l.ids.trakt}/user/${encodeURIComponent(owner)}`, base: `/users/${encodeURIComponent(owner)}/lists/${+l.ids.trakt}` }
    : { href: `#/list/${+l.ids.trakt}/public`, base: `/lists/${+l.ids.trakt}` };
};
const listHref = (l, kind) => listRoute(l, kind).href;

// Every list of one kind, stacked as its own row.
async function listsOfKind(kind) {
  const token = routeToken;
  const lists = await loadLists(kind).catch(e => {
    if (kind === 'shared') return []; // the contract's route for shared lists is unproven, so a failure just reads as none
    throw e;
  });
  if (token !== routeToken) return;
  const personal = kind === 'personal';
  const sorted = personal ? sortLists(lists, chosenSort(PERSONAL_SORTS).value) : lists;
  app.innerHTML = `<div class="page"><h1 class="sr-only">${esc(LIST_KINDS[kind].title)}</h1>
    ${personal ? `<div class="page-tools">${sortButton(PERSONAL_SORTS)}<button type="button" class="btn" data-create-list>${icon('plus')}New list</button></div>` : ''}
    ${sorted.length ? '' : `<div class="row-empty"><p class="muted">${esc(LIST_KINDS[kind].empty)}</p></div>`}</div>`;
  const into = app.firstElementChild;
  if (personal) bindSort(into, PERSONAL_SORTS);
  await renderRows(sorted.map(l => {
    const { href, base } = listRoute(l, kind);
    return {
      id: `list-${l.ids.trakt}`, title: l.name, meta: `${num(l.item_count)} items`, more: href, empty: 'Nothing here yet.',
      load: traktPosters(`${base}/items/${itemTypes()}/rank/asc?limit=${ROW_ITEMS}&extended=full`),
    };
  }), into);
}

function openListForm(list) {
  const d = drawer({
    title: list ? 'Edit list' : 'New list', width: 400,
    body: `<form id="list-form" novalidate>
      <label class="form-field"><b>Name</b><input id="list-name" value="${esc(list?.name)}" required autocomplete="off"></label>
      <label class="form-field"><b>Description (optional)</b><textarea id="list-description" rows="3">${esc(list?.description)}</textarea></label>
      <label class="form-field"><b>Privacy</b><select id="list-privacy">${[['private', 'Private'], ['link', 'Anyone with the link'], ['friends', 'Friends'], ['public', 'Public']].map(([v, label]) => `<option value="${v}"${(list?.privacy ?? 'private') === v ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
      <p class="error" id="list-error" hidden></p>
      <div class="card-actions"><button type="submit" class="btn primary">${list ? 'Save list' : 'Create list'}</button></div></form>`,
  });
  const form = d.querySelector('#list-form');
  const error = form.querySelector('#list-error');
  const fail = message => { error.textContent = message; error.hidden = false; };
  form.querySelector('#list-name').focus();
  form.onsubmit = async ev => {
    ev.preventDefault();
    const name = form.querySelector('#list-name').value.trim();
    if (!name) return fail('A list needs a name.');
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    const body = { name, description: form.querySelector('#list-description').value.trim(), privacy: form.querySelector('#list-privacy').value };
    try {
      await (list ? trakt('PUT', `/users/me/lists/${+list.ids.trakt}`, body) : trakt('POST', '/users/me/lists', body));
      d.close();
      toast(list ? 'List saved' : 'List created');
      route({ soft: true });
    } catch (e) {
      button.disabled = false;
      fail(listLimitMessage(e, 'count', `Your Trakt account can have ${num(user?.limits?.list?.count)} lists. Delete one to make room.`));
    }
  };
}
document.addEventListener('click', ev => { if (ev.target.closest('[data-create-list]')) openListForm(); });

function confirmDeleteList(list) {
  modal({
    title: 'Delete this list?',
    body: `<p class="muted">${esc(list.name)} and its ${num(list.item_count)} items will be deleted from Trakt. This can't be undone.</p>`,
    actions: [{ label: 'Cancel' }, { label: 'Delete list', primary: true, onClick: async () => {
      try {
        await trakt('DELETE', `/users/me/lists/${+list.ids.trakt}`, null);
        toast('List deleted');
        location.hash = '#/lists';
      } catch (e) { toast(e); }
    } }],
  });
}

// ---------- Profile: stats worked out on this PC, since Trakt's own are VIP only
const barStyle = (n, most) => `--h:${most ? Math.round(100 * n / most) : 0}%`;
function statsCharts(s) {
  const most = list => Math.max(0, ...list);
  const months = recentMonths(s.by_month, isoDate(), 24);
  const ratings = Array.from({ length: 10 }, (_, i) => ({ rating: i + 1, count: s.ratings.find(r => r.rating === i + 1)?.count ?? 0 }));
  const topPlays = most(s.top_genres.map(g => g.plays));
  const topRating = most(ratings.map(r => r.count));
  const topMonth = most(months.map(m => m.plays));
  const monthName = m => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  const empty = what => `<p class="muted">${what}</p>`;
  return `<div class="stat-charts">
    <section class="stat-chart"><h2>Top genres</h2>${s.top_genres.length ? `<div class="stat-bars">${s.top_genres.map(g => `<div class="rating-bar stat-bar"><span>${esc(statusText(g.genre))}</span><i style="--w:${100 * g.plays / topPlays}%"></i><small class="muted">${num(g.plays)}</small></div>`).join('')}</div>` : empty('Nothing yet.')}</section>
    <section class="stat-chart"><h2>Your ratings</h2>${topRating ? `<div class="stat-columns" role="img" aria-label="${esc(ratings.map(r => `${r.count} rated ${r.rating}`).join(', '))}">${ratings.map(r => `<div title="${num(r.count)} rated ${r.rating}"><i style="${barStyle(r.count, topRating)}"></i><small class="muted">${r.rating}</small></div>`).join('')}</div>` : empty('Nothing rated yet.')}</section>
    <section class="stat-chart stat-wide"><h2>Activity</h2>${topMonth ? `<div class="stat-columns months" role="img" aria-label="${esc(`Plays in the last 24 months, with ${num(months.reduce((n, m) => n + m.plays, 0))} in total`)}">${months.map((m, i) => `<div title="${esc(monthName(m.month))}: ${num(m.plays)} plays"><i style="${barStyle(m.plays, topMonth)}"></i>${i % 6 === 5 ? `<small class="muted">${esc(monthName(m.month))}</small>` : ''}</div>`).join('')}</div>` : empty('No plays in the last 24 months.')}</section></div>`;
}

// Signed out there's no Trakt history, but this PC's own Recently played still has something to say.
async function signedOutProfile() {
  const token = routeToken;
  const played = await invoke('history_list', { limit: 100 }).catch(() => []);
  if (token !== routeToken) return;
  const count = kind => played.filter(p => p.kind === kind).length;
  app.innerHTML = `${signInPrompt('stats and streak')}<div class="page"><h1 class="sr-only">Profile</h1>
    <h2>Played on this PC</h2>
    <div class="stats totals"><div><b>${num(count('movie'))}</b><span>movies</span></div><div><b>${num(count('tv'))}</b><span>shows</span></div></div></div>`;
}

// ---------- views reached from Profile
let progressTab = 'in-progress';
const PROGRESS_TABS = [{ value: 'completed', label: 'Completed' }, { value: 'ended', label: 'Ended' }, { value: 'in-progress', label: 'In progress' }, { value: 'dropped', label: 'Dropped' }];
async function progressView() {
  const tab = progressTab;
  const dropped = tab === 'dropped';
  const sort = chosenSort(SHOW_SORTS);
  app.innerHTML = `<div class="page"><h1 class="sr-only">Progress</h1>
    <div class="page-tools">${segmented('progress-tab', PROGRESS_TABS, tab, v => { progressTab = v; route({ soft: true }); }, 'Progress')}${dropped ? '' : sortButton(SHOW_SORTS)}</div></div>`;
  const into = app.firstElementChild;
  if (!dropped) bindSort(into, SHOW_SORTS);
  await renderGrid(into, {
    cls: 'summary-grid', empty: { completed: "You're not up to date on any airing shows.", ended: "You haven't finished any ended shows.", 'in-progress': 'Nothing in progress.', dropped: "You haven't dropped any shows." }[tab],
    load: page => traktGet(dropped ? `/users/hidden/dropped?page=${page}&limit=100&extended=full`
      : `/sync/progress/up_next_nitro?page=${page}&limit=100&intent=${tab === 'in-progress' ? 'continue' : 'completed'}${sortQuery(sort)}`),
    card: x => {
      if (tab === 'in-progress') return progressGridCard(x);
      const it = norm(x, 'show');
      if (!it) return '';
      if (dropped) return summaryCard(it, { label: 'Dropped', action: removeAction(it, '/users/hidden/dropped/remove', 'Undrop', 'Back in your progress') });
      if (hasEnded(x.show?.status) !== (tab === 'ended')) return ''; // one Trakt bucket holds both tabs
      return summaryCard(it, { line: x.progress ? `${num(x.progress.completed)} of ${num(x.progress.aired)} episodes` : '' });
    },
  });
}

// From the library mirror, so this needs no request.
async function ratingsView() {
  app.innerHTML = '<div class="page"><h1 class="sr-only">Ratings</h1></div>';
  const movies = lib?.ratings_movies ?? [];
  const shows = lib?.ratings_shows ?? [];
  const all = forMode([...movies, ...shows], shows, movies).toSorted((a, b) => (b.rated_at ?? '').localeCompare(a.rated_at ?? ''));
  await renderGrid(app.firstElementChild, {
    cls: 'summary-grid', empty: "You haven't rated anything yet.", pageSize: 60,
    load: async page => all.slice((page - 1) * 60, page * 60),
    card: x => { const it = norm(x); return it ? summaryCard(it, { sortValue: `${x.rating}/10` }) : ''; },
  });
}

async function favoritesView() {
  app.innerHTML = '<div class="page"><h1 class="sr-only">Favorites</h1></div>';
  await renderGrid(app.firstElementChild, {
    cls: 'summary-grid', empty: "You haven't added any favorites yet.",
    load: page => traktGet(`/sync/favorites/${syncTypes()}/rank/asc?page=${page}&limit=100&extended=full`),
    card: x => { const it = norm(x); return it ? summaryCard(it, { action: removeAction(it, '/sync/favorites/remove', 'Remove from favorites') }) : ''; },
  });
}

// The contract only says a note has an `item`, and older responses wrap the note and put the title beside it, so this takes either.
const noteCard = n => {
  const note = n.note ?? n;
  const it = norm(n.item ?? n);
  return `<article class="media-card note-card" data-note="${+note.id}" data-note-text="${esc(note.notes)}">
    ${it ? `<a href="#/title/${it.type}/${it.id}"><b>${esc(it.title)}</b></a>` : ''}
    <small class="muted">${esc(fullDate(note.updated_at ?? note.created_at))}${note.spoiler ? ' · Spoiler' : ''}</small>
    <p class="note-text">${esc(note.notes)}</p>
    <div class="note-actions"><button type="button" class="btn" data-note-edit>Edit</button><button type="button" class="btn danger" data-note-delete>Delete</button></div></article>`;
};
async function notesView() {
  app.innerHTML = '<div class="page"><h1 class="sr-only">Notes</h1></div>';
  const into = app.firstElementChild;
  await renderGrid(into, {
    cls: 'note-grid', empty: "You haven't written any notes yet.",
    load: page => traktGet(`/users/me/notes/all?page=${page}&limit=100&extended=full`),
    card: noteCard,
  });
  into.onclick = ev => {
    const card = ev.target.closest('[data-note]');
    if (!card) return;
    const id = +card.dataset.note;
    if (ev.target.closest('[data-note-edit]')) {
      const d = drawer({ title: 'Edit note', width: 400, body: `<form id="note-form"><label class="form-field"><b>Note</b><textarea id="note-text" rows="8" maxlength="500">${esc(card.dataset.noteText)}</textarea></label>
        <div class="card-actions"><button type="submit" class="btn primary">Save note</button></div></form>` });
      d.querySelector('#note-form').onsubmit = async e => {
        e.preventDefault();
        const notes = d.querySelector('#note-text').value.trim();
        if (!notes) return;
        try {
          await trakt('PUT', `/notes/${id}`, { notes });
          d.close();
          toast('Note saved');
          route({ soft: true });
        } catch (err) { toast(err); }
      };
    } else if (ev.target.closest('[data-note-delete]')) {
      modal({
        title: 'Delete this note?', body: '<p class="muted">It will be deleted from Trakt.</p>',
        actions: [{ label: 'Cancel' }, { label: 'Delete note', primary: true, onClick: async () => {
          try {
            await trakt('DELETE', `/notes/${id}`, null);
            toast('Note deleted');
            route({ soft: true });
          } catch (err) { toast(err); }
        } }],
      });
    }
  };
}

const PROFILE_VIEWS = {
  progress: { title: 'Progress', about: 'Shows you finished, are watching or dropped.', open: progressView },
  ratings: { title: 'Ratings', about: 'Everything you have rated.', open: ratingsView, mode: 'bar' },
  favorites: { title: 'Favorites', about: 'The titles you love most.', open: favoritesView, mode: 'bar' },
  notes: { title: 'Notes', about: 'Notes you wrote on Trakt.', open: notesView },
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
    if (r === 'ok') { await refreshUser(); runHistorySync(); toast(`Signed in as ${user?.user?.username}`); location.hash = '#/'; return; }
    if (r === 'slow_down') interval += 1000;
  }
  throw new Error('The code expired. Try again.');
}
