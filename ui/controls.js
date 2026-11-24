// Shared controls: drawers, dialogs, menus and switches. Interpolated data must go through esc().

// A native <dialog> traps focus, closes on Escape and returns focus when it closes.
function openDialog(className, html, onClose) {
  const d = document.createElement('dialog');
  d.className = className;
  d.innerHTML = html;
  const below = [...document.querySelectorAll('dialog.drawer[open]')].at(-1);
  // The dialog itself only receives a click when it lands on the backdrop, because its content fills it.
  d.addEventListener('click', ev => { if (ev.target === d) d.close(); });
  d.addEventListener('close', () => {
    below?.classList.remove('under');
    onClose?.();
    setTimeout(() => d.remove(), 200); // lets the closing animation finish
  });
  document.body.append(d);
  d.showModal();
  below?.classList.add('under');
  return d;
}

// Slides in from the right. Stacked drawers scale the one below. Returns the dialog; `.drawer-body` holds the content.
function drawer({ title, width = 440, body = '', onClose }) {
  const d = openDialog('drawer', `<div class="drawer-head"><h2>${esc(title)}</h2>
    <button type="button" class="icon-btn ghost" data-close aria-label="Close">${icon('close')}</button></div>
    <div class="drawer-body">${body}</div>`, onClose);
  d.style.setProperty('--drawer-width', `${width}px`);
  d.querySelector('[data-close]').onclick = () => d.close();
  return d;
}

// actions: [{ label, primary, onClick }]. Any action closes the dialog after it runs.
function modal({ title, body = '', actions = [], onClose }) {
  const d = openDialog('modal', `<h2>${esc(title)}</h2><div class="modal-body">${body}</div>
    <div class="modal-actions">${actions.map((a, i) => `<button type="button" class="btn${a.primary ? ' primary' : ''}" data-action="${i}">${esc(a.label)}</button>`).join('')}</div>`, onClose);
  d.querySelector('.modal-actions').onclick = ev => {
    const button = ev.target.closest('[data-action]');
    if (!button) return;
    actions[+button.dataset.action].onClick?.();
    d.close();
  };
  return d;
}

// A YouTube video in its own dialog. YouTube requires the Referer it gets from this policy, and that nothing covers the
// player, so the title and buttons sit above it. Leaving the iframe in place would keep the sound going until it's removed.
function playVideo(key, title) {
  if (!/^[\w-]+$/.test(key)) return;
  const d = openDialog('video-dialog', `<div class="video-head"><h2>${esc(title)}</h2>
      <a class="btn" href="https://www.youtube.com/watch?v=${key}" target="_blank">Open on YouTube</a>
      <button type="button" class="icon-btn ghost" data-close aria-label="Close">${icon('close')}</button></div>
    <div class="video-frame"><iframe src="https://www.youtube.com/embed/${key}?autoplay=1&rel=0" title="${esc(title)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`,
  () => d.querySelector('iframe').remove());
  d.querySelector('[data-close]').onclick = () => d.close();
}

// Pop-up menu for a button. items: [{ label, icon, danger, onClick }], [{ label, checked, onClick }] for a choice
// (checked items get a tick, the rest a blank of the same width), or [{ heading }] for a section title.
// The popover API handles Escape and clicks outside.
function menu(button, items) {
  const m = document.createElement('div');
  m.className = 'menu';
  m.popover = 'auto';
  m.setAttribute('role', 'menu');
  const lead = x => x.checked ? icon('check') : x.icon ? icon(x.icon) : x.checked === false ? '<span class="i" aria-hidden="true"></span>' : '';
  m.innerHTML = items.map((x, i) => x.heading ? `<div class="menu-heading" role="presentation">${esc(x.heading)}</div>`
    : `<button type="button" role="${x.checked === undefined ? 'menuitem' : 'menuitemradio'}"${x.checked === undefined ? '' : ` aria-checked="${x.checked}"`} data-item="${i}"${x.danger ? ' class="danger"' : ''}>${lead(x)}${esc(x.label)}</button>`).join('');
  document.body.append(m);
  button.setAttribute('aria-haspopup', 'menu');
  button.popoverTargetElement = m;
  m.addEventListener('toggle', ev => {
    button.setAttribute('aria-expanded', String(ev.newState === 'open'));
    if (ev.newState !== 'open') return;
    // Opens under the button, and flips to stay inside the page. clientWidth leaves out the scrollbar, which
    // innerWidth counts, so a menu at the right edge isn't drawn under it. A button on the right half lines the
    // menu up with its right edge, as the top bar's sort menu needs.
    const b = button.getBoundingClientRect();
    const { clientWidth: width, clientHeight: height } = document.documentElement;
    // Below the button unless there is more room above, and scrolling inside that room when it's still too tall.
    const [below, above] = [height - b.bottom - 14, b.top - 14];
    const down = m.scrollHeight <= below || below >= above;
    m.style.maxHeight = `${down ? below : above}px`;
    const left = b.left + b.width / 2 > width / 2 ? b.right - m.offsetWidth : b.left;
    m.style.top = `${down ? b.bottom + 6 : Math.max(8, b.top - 6 - m.offsetHeight)}px`;
    m.style.left = `${Math.max(8, Math.min(left, width - m.offsetWidth - 8))}px`;
    (m.querySelector('[aria-checked="true"]') ?? m.querySelector('button'))?.focus();
  });
  m.addEventListener('click', ev => {
    const item = ev.target.closest('[data-item]');
    if (!item) return;
    m.hidePopover();
    items[+item.dataset.item].onClick?.();
  });
  m.addEventListener('keydown', ev => {
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    ev.preventDefault();
    const all = [...m.querySelectorAll('button')];
    all[(all.indexOf(document.activeElement) + (ev.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length].focus();
  });
  return m;
}

// options: [{ value, label, icon }]. Returns HTML; radio inputs give it arrow keys and a name for screen readers.
const segmentedChanges = new Map();
function segmented(name, options, value, onChange, label = name) {
  segmentedChanges.set(name, onChange);
  return `<div class="segmented" role="radiogroup" aria-label="${esc(label)}" style="--n:${options.length}">${options.map(o => `<label>
    <input type="radio" name="${esc(name)}" value="${esc(o.value)}"${o.value === value ? ' checked' : ''}>${o.icon ? icon(o.icon) : ''}<span>${esc(o.label)}</span></label>`).join('')}</div>`;
}
document.addEventListener('change', ev => {
  if (ev.target.closest('.segmented')) segmentedChanges.get(ev.target.name)?.(ev.target.value);
});

// A min and max slider from two range inputs. value is 'a-b'; grades, when given, name the positions.
function rangeSlider(def, label, value) {
  const [lo, hi] = def.range;
  const [a, b] = (value ?? '').split('-');
  const min = a ? +a : lo;
  const max = b ? +b : hi;
  const step = def.step ?? (hi - lo <= 10 ? 1 : hi - lo > 100 ? 10 : 5);
  return `<div class="slider" data-slider="${esc(def.key)}">
    <div class="slider-head"><span class="filter-label">${esc(label)}</span><output>${esc(sliderText(def, min, max))}</output></div>
    <div class="slider-track" style="--a:${(min - lo) / (hi - lo)};--b:${(max - lo) / (hi - lo)}">
      <input type="range" min="${lo}" max="${hi}" step="${step}" value="${min}" aria-label="${esc(label)} from">
      <input type="range" min="${lo}" max="${hi}" step="${step}" value="${max}" aria-label="${esc(label)} to"></div></div>`;
}
function sliderText(def, min, max) {
  if (def.grades) return min === max ? def.grades[min] : `${def.grades[min]} to ${def.grades[max]}`;
  return min === def.range[0] && max === def.range[1] ? 'Any' : `${min} to ${max}${def.unit ?? ''}`;
}

// Option lists from Trakt, for both types since a filter applies across modes. Cached for a day on the Rust side.
async function loadFilterSources() {
  const none = () => [];
  const [gm, gs, cm, cs, co] = await Promise.all([
    traktGet('/genres/movies').catch(none), traktGet('/genres/shows').catch(none),
    traktGet('/certifications/movies').catch(none), traktGet('/certifications/shows').catch(none),
    traktGet('/countries/movies').catch(none),
  ]);
  const unique = list => [...new Map(list.map(x => [x.value, x])).values()].sort((a, b) => a.label.localeCompare(b.label));
  return {
    genres: unique([...gm, ...gs].map(g => ({ label: g.name, value: g.slug }))),
    certifications: unique([...(cm.us ?? []), ...(cs.us ?? [])].map(c => ({ label: c.name, value: c.slug }))),
    countries: unique(co.map(c => ({ label: c.name, value: c.code }))),
  };
}

const MODE_OPTIONS = [{ value: 'media', label: 'Media', icon: 'media' }, { value: 'show', label: 'Shows', icon: 'tv' }, { value: 'movie', label: 'Movies', icon: 'film' }];
const SEARCH_OPTIONS = [...MODE_OPTIONS, { value: 'person', label: 'People', icon: 'user' }, { value: 'list', label: 'Lists', icon: 'list' }];

// The command palette: Ctrl+K or /. The focus stays in the box, and the arrows move a highlight through the options.
const PALETTE_PAGES = [
  ['Home', '#/'], ['Continue Watching', '#/progress', true], ['Calendar', '#/calendar', true], ['Recommended', '#/discover/recommended', true],
  ['Discover', '#/discover'], ['Trending', '#/discover/trending'], ['Releases', '#/discover/releases'], ['Anticipated', '#/discover/anticipated'], ['Popular', '#/discover/popular'], ['Vibes', '#/discover/vibes'],
  ['Lists', '#/lists', true], ['Watchlist', '#/watchlist', true], ['History', '#/history', true], ['Library', '#/library', true], ['Profile', '#/profile', true],
  ['Search', '#/search'], ['Settings', '#/settings'],
];
function togglePalette() {
  const open = document.querySelector('dialog.palette[open]');
  if (open) return open.close();
  let timer;
  let asked = 0; // drops answers to anything but the latest query
  const d = openDialog('palette', `<label class="search"><svg class="i" aria-hidden="true"><use href="#i-search"/></svg>
      <input id="palette-input" type="text" role="combobox" placeholder="Where to?" aria-label="Where to?" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" autocomplete="off" spellcheck="false"></label>
    <div id="palette-list" class="palette-list" role="listbox" aria-label="Results"></div>
    <div class="palette-hints" aria-hidden="true"><span><kbd>↑</kbd> <kbd>↓</kbd> Move</span><span><kbd>Enter</kbd> Open</span><span><kbd>Esc</kbd> Close</span></div>`, () => { clearTimeout(timer); asked++; });
  const input = d.querySelector('input');
  const list = d.querySelector('.palette-list');
  let active = 0;
  const options = () => [...list.querySelectorAll('[role="option"]')];
  const setActive = i => {
    const all = options();
    active = all.length ? (i + all.length) % all.length : 0;
    all.forEach((o, n) => o.setAttribute('aria-selected', String(n === active)));
    if (all[active]) input.setAttribute('aria-activedescendant', all[active].id);
    else input.removeAttribute('aria-activedescendant');
    all[active]?.scrollIntoView({ block: 'nearest' });
  };
  // sections: [{ title, icon, items: [{ label, sub, href }] }]. Nothing found only counts once the search has answered.
  const draw = (sections, searching) => {
    let n = 0;
    const filled = sections.filter(s => s.items.length);
    list.innerHTML = filled.map(s => `<div role="group" aria-label="${esc(s.title)}"><div class="palette-section" aria-hidden="true">${esc(s.title)}</div>
      ${s.items.map(x => `<a id="palette-${n++}" role="option" tabindex="-1" aria-selected="false" href="${esc(x.href)}">${icon(s.icon)}<span>${esc(x.label)}</span>${x.sub ? `<small class="muted">${esc(x.sub)}</small>` : ''}</a>`).join('')}</div>`).join('')
      || (searching ? '' : '<p class="palette-none muted">Nothing found.</p>');
    setActive(0);
  };
  const results = (items, kind) => items.map(x => norm(x, kind)).filter(Boolean).map(it => ({ label: it.title, sub: it.year, href: `#/title/${it.type}/${it.id}` }));
  const update = () => {
    const query = input.value.trim();
    const q = query.toLowerCase();
    const pages = { title: 'Pages', icon: 'compass', items: PALETTE_PAGES.filter(([label, , auth]) => (user || !auth) && label.toLowerCase().includes(q)).map(([label, href]) => ({ label, href })) };
    const token = ++asked;
    clearTimeout(timer);
    draw([pages], !!query);
    if (!query) return;
    timer = setTimeout(async () => {
      const search = type => traktGet(`/search/${type}?query=${encodeURIComponent(query)}&limit=5`).catch(() => []);
      const [movies, shows] = await Promise.all([search('movie'), search('show')]);
      if (token !== asked) return;
      draw([pages, { title: 'Movies', icon: 'film', items: results(movies, 'movie') }, { title: 'Shows', icon: 'tv', items: results(shows, 'show') }]);
    }, 130);
  };
  input.addEventListener('input', update);
  input.addEventListener('keydown', ev => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      setActive(active + (ev.key === 'ArrowDown' ? 1 : -1));
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      options()[active]?.click();
    }
  });
  list.addEventListener('click', ev => { if (ev.target.closest('[role="option"]')) d.close(); });
  list.addEventListener('mousemove', ev => {
    const i = options().indexOf(ev.target.closest('[role="option"]'));
    if (i >= 0 && i !== active) setActive(i);
  });
  update();
  input.focus();
}

// The Sort and filter drawer: the page's order (Trakt's, where it has one, or a rating), the local rating filters, and
// Trakt's filters where the page's endpoint takes them. It edits a draft, and the page reloads on close if anything changed.
async function openFilterDrawer() {
  const sources = filterKinds.trakt ? await loadFilterSources() : {};
  const sorts = bar.sorts ?? null;
  const start = JSON.stringify(cleanFilters(activeFilters()));
  const startSort = sorts ? chosenSort(sorts).value : '';
  let draft = activeFilters();
  let draftSort = startSort;
  let tab = 'simple';
  try { if (localStorage.getItem('filters-tab') === 'advanced') tab = 'advanced'; } catch {}
  const d = drawer({
    title: filterKinds.rank ? 'Sort and filter' : 'Filters',
    onClose: () => {
      if (JSON.stringify(cleanFilters(draft)) === start && draftSort === startSort) return;
      if (sorts) sortChoice.set(location.hash, draftSort);
      setActiveFilters(draft);
      route({ soft: true });
    },
  });
  const body = d.querySelector('.drawer-body');
  const setValue = (key, value) => { if (value) draft[key] = value; else delete draft[key]; };
  const defaultSort = sorts ? sorts[0].value : '';
  const updateReset = () => {
    body.querySelector('[data-reset]').disabled = JSON.stringify(cleanFilters(draft)) === JSON.stringify(defaultFiltersHere()) && draftSort === defaultSort;
  };
  const field = (label, html) => `<div class="filter-field"><span class="filter-label">${esc(label)}</span>${html}</div>`;
  const select = (def, options, label = def.label) => field(label, `<select data-filter="${esc(def.key)}" aria-label="${esc(label)}">
    <option value="">${def.display ? 'Default' : 'All'}</option>${options.map(o => `<option value="${esc(o.value)}"${draft[def.key] === o.value ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`);
  const multiSummary = (values, options) => values.length ? values.map(v => (v.startsWith('-') ? 'Not ' : '') + (options.find(o => o.value === v.replace(/^-/, ''))?.label ?? v)).join(', ') : 'All';
  const multi = (def, options, label) => {
    const values = (draft[def.key] ?? '').split(',').filter(Boolean);
    return `<details class="multi" data-multi="${esc(def.key)}"${def.exclude ? ' data-exclude' : ''}><summary><span class="filter-label">${esc(label)}</span><small class="muted">${esc(multiSummary(values, options))}</small></summary>
      <div class="multi-list">${options.map(o => {
        const state = values.includes(o.value) ? 'on' : values.includes(`-${o.value}`) ? 'off' : '';
        return `<button type="button" data-v="${esc(o.value)}" data-state="${state}" aria-pressed="${state === 'on'}">${esc(o.label)}${state === 'off' ? ' (excluded)' : ''}</button>`;
      }).join('')}</div></details>`;
  };
  const multiOptions = def => def.multi?.map(s => ({ label: s[0].toUpperCase() + s.slice(1), value: s })) ?? sources[def.source] ?? [];
  const simpleControl = def => def.simpleRange ? rangeSlider(def, def.label, draft[def.key]) : select(def, def.options ?? sources[def.source] ?? []);
  const advancedControl = def => {
    const label = def.advancedLabel ?? def.label;
    if (def.range) return rangeSlider(def, label, draft[def.key]);
    if (def.source || def.multi) return multi(def, multiOptions(def), label);
    return select(def, def.options, label);
  };
  const shown = FILTERS.filter(f => !f.alias && !f.local && (user || !f.auth));
  const showTab = next => {
    tab = next;
    try { localStorage.setItem('filters-tab', tab); } catch {}
    draw();
  };
  const changeTab = next => {
    if (next === 'advanced' || fitsSimple(draft)) return showTab(next);
    let confirmed = false;
    modal({
      title: 'Clear advanced filters?',
      body: '<p class="muted">Simple can\'t show your advanced filters, so switching clears them.</p>',
      actions: [{ label: 'Cancel' }, { label: 'Clear filters', primary: true, onClick: () => {
        confirmed = true;
        draft = Object.fromEntries(Object.entries(draft).filter(([k]) => filterDef(k).local));
      } }],
      onClose: () => showTab(confirmed ? 'simple' : 'advanced'),
    });
  };
  const setDirection = how => {
    const spec = rankSpec(draft);
    if (spec.sort) setValue('rank', rankValue({ ...spec, asc: how === 'asc' }));
    updateReset();
  };
  // One list for both kinds of order, since only one can apply: Trakt's (or the page's own) and Filmie's by rating.
  const sortSection = () => {
    const spec = rankSpec(draft);
    const option = (value, label, on) => `<option value="${esc(value)}"${on ? ' selected' : ''}>${esc(label)}</option>`;
    const own = (sorts ?? [{ value: '', label: 'Default' }]).map(s => option(`t:${s.value}`, s.label, !spec.sort && s.value === draftSort));
    const rated = filterKinds.rank ? usableSources().map(s => option(`r:${s.key}`, s.label, spec.sort === s.key)) : [];
    return `<h3 class="filter-section">Sort</h3>
      ${field('Order', `<select data-sort-pick aria-label="Sort by">${rated.length ? `<optgroup label="${sorts ? 'Trakt' : 'This page'}">${own.join('')}</optgroup><optgroup label="Rating">${rated.join('')}</optgroup>` : own.join('')}</select>`)}
      ${spec.sort ? `<div class="filter-switch">${segmented('rank-how', [{ value: 'desc', label: 'Highest first' }, { value: 'asc', label: 'Lowest first' }], spec.asc ? 'asc' : 'desc', setDirection, 'Direction')}</div>
        ${ratingSource(spec.sort).trust ? `<label class="check"><input type="checkbox" data-rank-weigh${spec.raw ? '' : ' checked'}>Weigh by number of votes</label>
        <p class="muted filter-hint">A rating from few votes counts for less, so a well-known 8.3 can come before an obscure 8.5.</p>` : ''}` : ''}`;
  };
  const ratingSection = () => {
    const defs = FILTERS.filter(f => f.rating && usableRating(f.rating));
    return `<h3 class="filter-section">Ratings</h3>
      ${defs.map(def => rangeSlider(def, def.label, draft[def.key])).join('')}
      <label class="check"><input type="checkbox" data-keep-unrated${draft.rate_unrated === 'true' ? ' checked' : ''}>Keep titles with no rating to compare</label>
      <p class="muted filter-hint">Filmie rates and orders up to the first ${RANK_POOL} titles of a page itself.${mdb.connected ? '' : ' For IMDb, Rotten Tomatoes, Metacritic and Letterboxd, <a href="#/settings/ratings">add an MDBList key in Settings</a>.'}</p>`;
  };
  const traktSection = () => {
    const controls = tab === 'simple' ? shown.filter(f => !f.advancedOnly && !f.display).map(simpleControl) : shown.filter(f => !f.display).map(advancedControl);
    const display = shown.filter(f => f.display).map(f => select(f, f.options));
    return `${filterKinds.rank ? '<h3 class="filter-section">Trakt filters</h3>' : ''}
      <div class="filter-switch">${segmented('filter-tab', [{ value: 'simple', label: 'Simple' }, { value: 'advanced', label: 'Advanced' }], tab, changeTab, 'Filter detail')}</div>
      ${controls.join('')}${display.length ? `<h3 class="filter-section">Display</h3>${display.join('')}` : ''}`;
  };
  function draw() {
    body.innerHTML = `<div class="filter-actions"><button type="button" class="btn danger" data-reset>Reset</button><button type="button" class="btn primary" data-save>Set as default</button></div>
      ${filterKinds.rank || sorts ? sortSection() : ''}${filterKinds.rank ? ratingSection() : ''}${filterKinds.trakt ? traktSection() : ''}`;
    updateReset();
  }
  // Slider ends can't cross, and a slider at full range counts as no filter through cleanFilters.
  body.addEventListener('input', ev => {
    const slider = ev.target.closest('[data-slider]');
    if (!slider) return;
    const [low, high] = slider.querySelectorAll('input');
    if (+low.value > +high.value) (ev.target === low ? high : low).value = ev.target.value;
    const def = filterDef(slider.dataset.slider);
    const [lo, hi] = def.range;
    const [min, max] = [+low.value, +high.value];
    slider.querySelector('output').textContent = sliderText(def, min, max);
    const track = slider.querySelector('.slider-track');
    track.style.setProperty('--a', (min - lo) / (hi - lo));
    track.style.setProperty('--b', (max - lo) / (hi - lo));
    setValue(def.key, `${min}-${max}`);
    // Advanced's one ratings slider also sets IMDb, which is out of 10, and Rotten Tomatoes.
    if (def.key === 'ratings' && tab === 'advanced') {
      setValue('imdb_ratings', `${min / 10}-${max / 10}`);
      setValue('rt_meters', `${min}-${max}`);
      setValue('rt_user_meters', `${min}-${max}`);
    }
    updateReset();
  });
  body.addEventListener('change', ev => {
    if (ev.target.matches('[data-sort-pick]')) {
      const [kind, value] = [ev.target.value.slice(0, 1), ev.target.value.slice(2)];
      if (kind === 'r') { setValue('rank', rankValue({ ...rankSpec(draft), sort: value })); draftSort = defaultSort; }
      else { setValue('rank', ''); draftSort = value; }
      draw();
      body.querySelector('[data-sort-pick]').focus();
      return;
    }
    if (ev.target.matches('[data-rank-weigh]')) { setValue('rank', rankValue({ ...rankSpec(draft), raw: !ev.target.checked })); updateReset(); return; }
    if (ev.target.matches('[data-keep-unrated]')) { setValue('rate_unrated', ev.target.checked ? 'true' : ''); updateReset(); return; }
    const key = ev.target.dataset?.filter;
    if (!key) return;
    setValue(key, ev.target.value);
    updateReset();
  });
  body.addEventListener('click', ev => {
    if (ev.target.closest('a[href^="#/"]')) { d.close(); return; }
    if (ev.target.closest('[data-reset]')) { draft = defaultFiltersHere(); draftSort = defaultSort; draw(); return; }
    if (ev.target.closest('[data-save]')) { saveDefaultFilters(draft); d.close(); return; }
    const option = ev.target.closest('.multi-list button');
    if (!option) return;
    const box = option.closest('.multi');
    const def = filterDef(box.dataset.multi);
    // Each press moves on: included, then excluded where the filter allows it, then off.
    const next = option.dataset.state === '' ? 'on' : option.dataset.state === 'on' && def.exclude ? 'off' : '';
    const v = option.dataset.v;
    const rest = (draft[def.key] ?? '').split(',').filter(x => x && x !== v && x !== `-${v}`);
    setValue(def.key, [...rest, ...(next === 'on' ? [v] : next === 'off' ? [`-${v}`] : [])].join(','));
    const open = box.open;
    box.outerHTML = multi(def, multiOptions(def), def.advancedLabel ?? def.label);
    const redrawn = body.querySelector(`[data-multi="${def.key}"]`);
    redrawn.open = open;
    redrawn.querySelector(`[data-v="${CSS.escape(v)}"]`)?.focus();
    updateReset();
  });
  draw();
}
