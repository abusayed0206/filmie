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

// Pop-up menu for a button. items: [{ label, icon, danger, onClick }]. The popover API handles Escape and clicks outside.
function menu(button, items) {
  const m = document.createElement('div');
  m.className = 'menu';
  m.popover = 'auto';
  m.setAttribute('role', 'menu');
  m.innerHTML = items.map((x, i) => `<button type="button" role="menuitem" data-item="${i}"${x.danger ? ' class="danger"' : ''}>${x.icon ? icon(x.icon) : ''}${esc(x.label)}</button>`).join('');
  document.body.append(m);
  button.setAttribute('aria-haspopup', 'menu');
  button.popoverTargetElement = m;
  m.addEventListener('toggle', ev => {
    button.setAttribute('aria-expanded', String(ev.newState === 'open'));
    if (ev.newState !== 'open') return;
    // Opens under the button, and flips to stay inside the window.
    const b = button.getBoundingClientRect();
    const fitsBelow = b.bottom + m.offsetHeight + 6 <= innerHeight;
    m.style.top = `${fitsBelow ? b.bottom + 6 : Math.max(6, b.top - m.offsetHeight - 6)}px`;
    m.style.left = `${Math.max(6, Math.min(b.left, innerWidth - m.offsetWidth - 6))}px`;
    m.querySelector('button')?.focus();
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
  const step = hi - lo <= 10 ? 1 : hi - lo > 100 ? 10 : 5;
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

// The filter drawer. It edits a draft, and the page only reloads on close if something changed.
async function openFilterDrawer() {
  const sources = await loadFilterSources();
  const start = JSON.stringify(cleanFilters(activeFilters()));
  let draft = activeFilters();
  let tab = 'simple';
  try { if (localStorage.getItem('filters-tab') === 'advanced') tab = 'advanced'; } catch {}
  const d = drawer({
    title: 'Filters',
    onClose: () => {
      if (JSON.stringify(cleanFilters(draft)) === start) return;
      setActiveFilters(draft);
      route({ soft: true });
    },
  });
  const body = d.querySelector('.drawer-body');
  const setValue = (key, value) => { if (value) draft[key] = value; else delete draft[key]; };
  const updateReset = () => { body.querySelector('[data-reset]').disabled = JSON.stringify(cleanFilters(draft)) === JSON.stringify(savedDefaultFilters()); };
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
  const shown = FILTERS.filter(f => !f.alias && (user || !f.auth));
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
      actions: [{ label: 'Cancel' }, { label: 'Clear filters', primary: true, onClick: () => { confirmed = true; draft = {}; } }],
      onClose: () => showTab(confirmed ? 'simple' : 'advanced'),
    });
  };
  function draw() {
    const controls = tab === 'simple' ? shown.filter(f => !f.advancedOnly && !f.display).map(simpleControl) : shown.filter(f => !f.display).map(advancedControl);
    const display = shown.filter(f => f.display).map(f => select(f, f.options));
    body.innerHTML = `<div class="filter-actions"><button type="button" class="btn danger" data-reset>Reset</button><button type="button" class="btn primary" data-save>Set as default</button></div>
      ${bar.mode === 'drawer' ? `<div class="filter-switch">${segmented('filter-mode', MODE_OPTIONS, getMode(), setMode, 'Media type')}</div>` : ''}
      <div class="filter-switch">${segmented('filter-tab', [{ value: 'simple', label: 'Simple' }, { value: 'advanced', label: 'Advanced' }], tab, changeTab, 'Filter detail')}</div>
      ${controls.join('')}${display.length ? `<h3 class="filter-section">Display</h3>${display.join('')}` : ''}`;
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
    const key = ev.target.dataset?.filter;
    if (!key) return;
    setValue(key, ev.target.value);
    updateReset();
  });
  body.addEventListener('click', ev => {
    if (ev.target.closest('[data-reset]')) { draft = savedDefaultFilters(); draw(); return; }
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
