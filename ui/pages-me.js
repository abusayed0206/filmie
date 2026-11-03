// The signed-in user's pages and Settings.
const PROGRESS_SORTS = [{ value: '', label: 'Default' }, { value: 'smart', label: 'Smart', how: 'desc' }, { value: 'released', label: 'Release date', how: 'desc' }, { value: 'remaining', label: 'Remaining', how: 'asc' }];
let progressSort = '';
function openProgressSort() {
  const d = drawer({ title: 'Sort', width: 400, body: `<div class="list-picker">${PROGRESS_SORTS.map(s => `<button type="button" class="btn${s.value === progressSort ? ' on' : ''}" data-sort="${s.value}">${esc(s.label)}</button>`).join('')}</div>` });
  d.querySelector('.list-picker').onclick = ev => {
    const button = ev.target.closest('[data-sort]');
    if (!button) return;
    progressSort = button.dataset.sort;
    d.close();
    route({ soft: true });
  };
}
// A chosen sort keeps Trakt's order for shows, so paused movies go first rather than being mixed in by date.
const mergeProgress = (shows, movies) => progressSort ? [...movies, ...shows] : mergeContinue(shows, movies);
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
    const sort = PROGRESS_SORTS.find(s => s.value === progressSort);
    app.innerHTML = `<div class="page"><h1 class="sr-only">Continue Watching</h1>
      <div class="page-tools"><button type="button" class="btn" id="progress-sort">Sort: ${esc(sort.label)}</button></div></div>`;
    const into = app.firstElementChild;
    into.querySelector('#progress-sort').onclick = openProgressSort;
    const query = sort.value ? `&sort_by=${sort.value}&sort_how=${sort.how}` : '';
    await renderGrid(into, {
      cls: 'summary-grid', empty: 'Nothing in progress. Start something and it will show here.',
      pageSize: getMode() === 'movie' ? Infinity : 100,
      // Paused movies all come with the first page.
      load: async page => {
        const shows = getMode() === 'movie' ? [] : await traktGet(`/sync/progress/up_next_nitro?page=${page}&limit=100${query}`);
        const movies = page > 1 || getMode() === 'show' ? [] : await traktGet('/sync/playback/movies?limit=100');
        return mergeProgress(shows ?? [], movies ?? []);
      },
      card: progressGridCard,
    });
  },

  calendar: () => comingSoon('Calendar'),
  history: () => comingSoon('History'),
  library: () => comingSoon('Library'),

  async profile() {
    if (!user) { app.innerHTML = signInPrompt('profile'); return; }
    app.innerHTML = `<div class="page">${profileHeader()}</div>`;
  },

  async lists() {
    if (!user) { app.innerHTML = signInPrompt('lists'); return; }
    const token = routeToken;
    const lists = await traktGet('/users/me/lists');
    if (token !== routeToken) return;
    app.innerHTML = `<div class="page"><h1 class="sr-only">Lists</h1><div class="tiles">${watchlistTile()}${lists.map(listTile).join('')}</div></div>`;
  },

  async watchlist() {
    if (!user) { app.innerHTML = signInPrompt('watchlist'); return; }
    const movies = getMode() === 'show' ? '' : posters(watchlistItems(['movies']));
    const shows = getMode() === 'movie' ? '' : posters(watchlistItems(['shows']));
    app.innerHTML = `<div class="page"><h1 class="sr-only">Watchlist</h1>
      ${shows ? `<h2>Shows</h2><div class="grid">${shows}</div>` : ''}${movies ? `<h2>Movies</h2><div class="grid">${movies}</div>` : ''}
      ${movies || shows ? '' : '<p class="muted">Your watchlist is empty.</p>'}</div>`;
    observeArt(app);
  },

  async list(id) {
    if (!user) { app.innerHTML = signInPrompt('lists'); return; }
    const token = routeToken;
    const meta = await traktGet(`/users/me/lists/${+id}`);
    if (token !== routeToken) return;
    setBarTitle(meta.name);
    app.innerHTML = `<div class="page"><h1 class="sr-only">${esc(meta.name)}</h1>
      <p class="muted">${num(meta.item_count)} items${meta.description ? ` · ${esc(meta.description)}` : ''}</p>
      <div class="grid" id="grid"></div><p><button id="more" hidden>Load more</button></p></div>`;
    const grid = document.getElementById('grid');
    const more = document.getElementById('more');
    const PAGE = 60;
    let page = 1;
    const load = async () => {
      const items = await traktGet(withFilters(`/users/me/lists/${+id}/items/${forMode('movie,show', 'show', 'movie')}?page=${page++}&limit=${PAGE}`));
      if (token !== routeToken) return;
      grid.insertAdjacentHTML('beforeend', posters(items));
      observeArt(grid);
      more.hidden = items.length < PAGE;
    };
    more.onclick = () => load().catch(toast);
    await load();
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
});

// Filters arrive on these pages as each is rebuilt on an endpoint that takes them.
pages.progress.bar = { title: 'Continue Watching', mode: 'bar' };
pages.calendar.bar = { title: 'Calendar', mode: 'bar' };
pages.history.bar = { title: 'History', mode: 'bar' };
pages.library.bar = { title: 'Library', mode: 'bar' };
pages.profile.bar = { title: 'Profile', mode: 'bar' };
pages.lists.bar = { title: 'Lists', mode: 'bar' };
pages.watchlist.bar = { title: 'Watchlist', mode: 'bar' };
pages.list.bar = { title: 'List', back: true, mode: 'bar', filters: 'local' };
pages.settings.bar = { title: 'Settings' };

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
    if (r === 'ok') { await refreshUser(); toast(`Signed in as ${user?.user?.username}`); location.hash = '#/'; return; }
    if (r === 'slow_down') interval += 1000;
  }
  throw new Error('The code expired. Try again.');
}
