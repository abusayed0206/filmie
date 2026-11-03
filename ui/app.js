// The player page, then the router and start-up.
Object.assign(pages, {
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
});

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

// The top bar. Each page sets `bar`, or a function of its route arguments returning one.
const topbar = document.getElementById('topbar');
const filterButton = document.getElementById('filter-btn');
let bar = {};
function updateFilterButton() {
  const count = filterCount(activeFilters());
  filterButton.disabled = !bar.filters;
  filterButton.querySelector('.badge').textContent = count || '';
  filterButton.setAttribute('aria-label', count ? `Filters, ${count} active` : 'Filters');
}
function setBar(next = {}) {
  bar = next;
  filterScope = next.filters ?? false;
  topbar.querySelector('.topbar-left').innerHTML = `${next.back ? `<button type="button" class="icon-btn ghost" data-back aria-label="Back">${icon('back')}</button>` : ''}
    <div class="topbar-title"><b>${esc(next.title ?? '')}</b>${next.meta ? `<small>${esc(next.meta)}</small>` : ''}</div>`;
  // Kept between pages so the indicator slides and keyboard focus stays on the switch.
  const center = topbar.querySelector('.topbar-center');
  const shown = next.mode === 'bar' || next.mode === 'search' ? next.mode : '';
  if (center.dataset.shown !== shown) {
    center.dataset.shown = shown;
    center.innerHTML = shown === 'bar' ? segmented('mode', MODE_OPTIONS, getMode(), setMode, 'Media type')
      : shown === 'search' ? segmented('search-mode', SEARCH_OPTIONS, getSearchMode(), setSearchMode, 'Search for') : '';
  } else if (shown) center.querySelector(`input[value="${shown === 'search' ? getSearchMode() : getMode()}"]`).checked = true;
  updateFilterButton();
}
busy(filterButton, openFilterDrawer);
const setBarTitle = title => { topbar.querySelector('.topbar-title b').textContent = title; };
topbar.addEventListener('click', ev => { if (ev.target.closest('[data-back]')) history.back(); });
addEventListener('scroll', () => document.body.classList.toggle('scrolled', scrollY > 0), { passive: true });

// soft: refresh this page in place, for changes the user didn't navigate to. It renders into a hidden copy,
// which comes first in the document so the pages' getElementById calls find it, then swaps in one step.
async function route({ soft = false } = {}) {
  const token = ++routeToken;
  nowPlaying = null;
  document.getElementById('soft-render')?.remove();
  document.querySelectorAll('.menu').forEach(m => m.remove()); // their actions belong to the page being left
  growGrid = null;
  app = main;
  const [page, ...args] = location.hash.slice(2).split('/');
  // Shows and Movies are now Discover in that mode.
  if (page === 'shows' || page === 'movies') {
    saveMode(page === 'shows' ? 'show' : 'movie');
    location.replace('#/discover');
    return;
  }
  const name = Object.hasOwn(pages, page || 'home') ? page || 'home' : 'home';
  const open = pages[name];
  const opening = navType;
  traversing = opening === 'traverse';
  navType = 'push'; // route() also runs without a navigation, as after signing out
  setBar(typeof open.bar === 'function' ? open.bar(...args) : open.bar);
  if (soft) {
    app = main.cloneNode(false);
    app.id = 'soft-render';
    app.hidden = true;
    main.before(app);
  } else {
    const current = navFor(page, args[0]);
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
    (page === 'search' ? searchBox : main).focus({ preventScroll: true });
    main.setAttribute('aria-busy', 'true');
  }
  restoreTarget = soft ? 0 : scrollTarget(opening, savedScroll.get(window.navigation?.currentEntry.key));
  try { await open(...args); }
  catch (e) { if (token === routeToken) app.innerHTML = `<div class="page"><p class="error">${esc(e)}</p></div>`; }
  if (token !== routeToken) return;
  main.removeAttribute('aria-busy'); // a soft refresh can overtake a page that was still loading
  if (soft) {
    // The swap replaces whatever had keyboard focus, so it moves to the same control in the new copy.
    const focused = main.contains(document.activeElement) ? document.activeElement : null;
    const again = focused?.id ? `#${CSS.escape(focused.id)}` : focused?.name ? `[name="${CSS.escape(focused.name)}"]:checked` : focused?.hasAttribute('data-sort-open') ? '[data-sort-open]' : null;
    main.replaceChildren(...app.childNodes);
    app.remove();
    app = main;
    if (again) main.querySelector(again)?.focus({ preventScroll: true });
    return;
  }
  if (restoreTarget) scrollTo(0, restoreTarget);
}

// Search as you type. The box only shows on the search page, so each query replaces the last in history,
// and the results swap in place so the page doesn't flash between keystrokes.
let searchTimer;
let typing = false;
searchBox.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    if (!location.hash.startsWith('#/search')) return; // the person left before the timer ran
    const q = searchBox.value.trim();
    const target = q ? `#/search/${encodeURIComponent(q)}` : '#/search';
    if (target === location.hash) return;
    typing = true;
    location.replace(target);
  }, 130);
});

// Ctrl+K toggles the palette and / opens it, except in the player. / is still a character inside a text field.
const TEXT_FIELD = 'input:not([type="radio"], [type="range"], [type="checkbox"]), textarea, select, [contenteditable]';
document.addEventListener('keydown', ev => {
  if (document.body.classList.contains('playing')) return;
  const toggle = ev.ctrlKey && ev.key.toLowerCase() === 'k';
  const slash = ev.key === '/' && !ev.ctrlKey && !ev.altKey && !ev.metaKey && !ev.target.closest?.(TEXT_FIELD);
  if (!toggle && !slash) return;
  ev.preventDefault();
  togglePalette();
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

// The bottom group opens on hover or keyboard focus when the rail is narrow. The delay lets the pointer cross the gap.
const railBottom = document.getElementById('rail-bottom');
let railTimer;
const openRailMenu = open => {
  clearTimeout(railTimer);
  if (open) railBottom.classList.add('open');
  else railTimer = setTimeout(() => railBottom.classList.remove('open'), 150);
};
for (const [event, open] of [['mouseenter', true], ['mouseleave', false], ['focusin', true], ['focusout', false]]) railBottom.addEventListener(event, () => openRailMenu(open));

window.addEventListener('hashchange', () => {
  const soft = typing;
  typing = false;
  if (soft) scrollTo(0, 0);
  route({ soft });
});
// Only text fields and selected text get a menu; the rest of the app shouldn't offer "Reload" or "Save as".
document.addEventListener('contextmenu', ev => { if (!ev.target.closest('input, textarea') && !String(getSelection())) ev.preventDefault(); });
setInterval(() => syncInBackground().catch(console.warn), 15 * 60e3);
refreshUser().catch(toast).finally(() => { route(); syncInBackground().catch(console.warn); });
