// Ratings: Nanocrowd's on every card by default, every MDBList source once a key is saved in Settings, the strip on
// title pages, and the local sort and filters that rank any list of title cards by them.
// The `ratings` command caches MDBList's numbers for 8 hours and Nanocrowd's for a week or more. Here, requests made
// close together are joined into one call, and answers are kept for 10 minutes, so a page that ranks its cards and then
// paints them, or redraws after a sync, doesn't ask twice.

let mdb = { connected: false }; // the MDBList key's status, from Rust
const refreshMdb = async (refresh = false) => (mdb = (await invoke('mdblist_status', { refresh }).catch(() => null)) ?? { connected: false });
const usableRating = key => freeRating(key) || !!mdb.connected;
const usableSources = () => RATING_SOURCES.filter(s => usableRating(s.key));
// Every source but these needs MDBList, and so its quota.
const needsMdb = keys => mdb.connected && keys.some(k => k && k !== 'nanocrowd' && k !== 'trakt');

function getCardRating() {
  try { return localStorage.getItem('card-rating') ?? 'nanocrowd'; } catch { return 'nanocrowd'; }
}
const setCardRating = key => { try { localStorage.setItem('card-rating', key); } catch {} };
// What a card shows: the sort's source, else the person's choice, else Nanocrowd when that choice needs a key that's gone.
function cardSource() {
  const pick = (filterKinds.rank && currentRank().sort) || getCardRating();
  if (pick === 'none') return null;
  return ratingSource(pick) && usableRating(pick) ? pick : 'nanocrowd';
}
const rankingSpec = () => {
  const spec = filterKinds.rank ? currentRank() : null;
  return rankActive(spec) ? spec : null;
};

// ---------- asking for ratings
// Nanocrowd's catalog spells titles without accents.
const plainTitle = t => String(t ?? '').normalize('NFD').replace(/\p{M}/gu, '');
const askOf = it => ({ kind: it.type, id: +it.id, imdb: it.imdb || null, title: plainTitle(it.title) || null, year: +it.year || null });
const RATE_MEMO_MS = 10 * 60e3;
const rateMemo = new Map(); // 'movie:27205' -> { at, mdb, raw }
const ratePending = new Map(); // 'movie:27205|1' -> promise
let rateQueue = [];
let rateQueueTimer = null;
const clearRatingMemo = () => rateMemo.clear();
// One title's ratings. `wantMdb` adds MDBList's; an answer that has them also serves a request that doesn't.
function rateOne(ask, wantMdb) {
  const key = `${ask.kind}:${ask.id}`;
  const hit = rateMemo.get(key);
  if (hit && Date.now() - hit.at < RATE_MEMO_MS && (hit.mdb || !wantMdb)) return Promise.resolve(hit.raw);
  const pending = ratePending.get(`${key}|1`) ?? ratePending.get(`${key}|${wantMdb ? 1 : 0}`);
  if (pending) return pending;
  const p = new Promise((resolve, reject) => rateQueue.push({ key, ask, wantMdb, resolve, reject }));
  ratePending.set(`${key}|${wantMdb ? 1 : 0}`, p);
  p.catch(() => {}).finally(() => ratePending.delete(`${key}|${wantMdb ? 1 : 0}`));
  rateQueueTimer ??= setTimeout(flushRateQueue, 30);
  return p;
}
// Everything asked for in the last moment, in calls of 100: one MDBList request rates up to 100 titles.
function flushRateQueue() {
  rateQueueTimer = null;
  const queue = rateQueue;
  rateQueue = [];
  for (const wantMdb of [false, true]) {
    const jobs = queue.filter(j => j.wantMdb === wantMdb);
    for (let i = 0; i < jobs.length; i += 100) {
      const chunk = jobs.slice(i, i + 100);
      invoke('ratings', { items: chunk.map(j => j.ask), mdblist: wantMdb }).then(raws => chunk.forEach((j, n) => {
        const old = rateMemo.get(j.key);
        if (!(old?.mdb && !wantMdb && Date.now() - old.at < RATE_MEMO_MS)) rateMemo.set(j.key, { at: Date.now(), mdb: wantMdb, raw: raws[n] });
        j.resolve(raws[n]);
      }), e => chunk.forEach(j => j.reject(e)));
    }
  }
}
const ratingsFor = (asks, wantMdb) => Promise.all(asks.map(a => rateOne(a, wantMdb)));

// ---------- on cards
// A title card carries what rating it needs on its root (`rateAttrs`), and a slot that fills in once it nears the screen.
function rateAttrs(it) {
  if (!it?.id || (it.type !== 'movie' && it.type !== 'tv')) return '';
  const data = { rk: it.type, rid: it.id, rimdb: it.imdb, rtitle: it.title, ryear: it.year, rtrakt: it.rating, rvotes: it.votes };
  return Object.entries(data).filter(([, v]) => v).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
}
// A rich slot (summary cards) shows a few sources; the others, the card's one.
const ratingSlot = (rich = false) => cardSource() ? `<span class="rating-slot${rich ? ' rich' : ''}" hidden></span>` : '';
const cardItem = c => ({ type: c.dataset.rk, id: +c.dataset.rid, imdb: c.dataset.rimdb, title: c.dataset.rtitle, year: c.dataset.ryear });
const cardRatings = (c, raw) => ratingsOf(raw, { trakt: +c.dataset.rtrakt || 0, traktVotes: +c.dataset.rvotes || 0 });
const ratingChip = (key, r, main) => `<span class="rating-chip${main ? ' main' : ''}" title="${esc(ratingTitle(key, r))}">${key === 'nanocrowd'
  ? icon('star') : `<small>${esc(ratingSource(key).tag)}</small>`}<b>${esc(ratingText(key, r))}</b></span>`;
// A summary card's main rating comes first, then up to two of these: three chips fit a narrow card in two lines.
const RICH_ORDER = ['imdb', 'tomatoes', 'metacritic', 'letterboxd', 'nanocrowd', 'popcorn', 'trakt', 'tmdb'];
function paintSlot(slot, r) {
  const main = cardSource();
  const keys = slot.classList.contains('rich') ? [main, ...RICH_ORDER.filter(k => k !== main)].filter(k => r[k]).slice(0, 3) : [main];
  const chips = keys.filter(k => r[k]).map(k => ratingChip(k, r[k], k === main)).join('');
  slot.innerHTML = chips;
  slot.hidden = !chips;
}
const slotWantsMdb = slot => mdb.connected && (slot.classList.contains('rich') || needsMdb([cardSource()]));

// Cards added together (a page of a grid, a row) are rated together, as soon as any of them comes near the screen:
// one call, and one MDBList request per 100 titles of a type, where rating each screenful as it scrolled in spent
// a request on every handful. A hidden slot has no box to watch, so its card is watched.
const RATE_GROUP = 100;
const groupOf = new WeakMap(); // card -> the cards added with it
const rateObserver = new IntersectionObserver(entries => {
  for (const en of entries) {
    const group = en.isIntersecting && groupOf.get(en.target);
    if (!group) continue;
    for (const c of group) {
      rateObserver.unobserve(c);
      groupOf.delete(c);
    }
    rateCards(group);
  }
}, { rootMargin: '600px' });
function observeRatings(roots) {
  const cards = roots.flatMap(r => r.matches?.('.media-card[data-rk]') ? [r] : [...r.querySelectorAll('.media-card[data-rk]')])
    .filter(c => c.querySelector('.rating-slot'));
  for (let i = 0; i < cards.length; i += RATE_GROUP) {
    const group = cards.slice(i, i + RATE_GROUP);
    for (const c of group) {
      groupOf.set(c, group);
      rateObserver.observe(c);
    }
  }
}
function rateCards(cards) {
  const slots = cards.map(c => c.querySelector('.rating-slot'));
  for (const wantMdb of [false, true]) {
    const some = cards.filter((c, i) => slotWantsMdb(slots[i]) === wantMdb);
    if (!some.length) continue;
    ratingsFor(some.map(c => askOf(cardItem(c))), wantMdb)
      .then(raws => some.forEach((c, i) => paintSlot(c.querySelector('.rating-slot'), cardRatings(c, raws[i]))), console.warn);
  }
}

// ---------- ranking any list of title cards
const RANK_POOL = 300; // titles a grid gathers before ranking
const RANK_LOADS = 8; // and at most this many of its pages
// Rows fetch more when ranking, so a row of 10 is the best 10 of 30.
const rowLimit = n => rankingSpec() ? Math.max(n, 30) : n;

// Rates every title card in `root`, takes out those outside the rating filters, and, with a rating sort, orders
// each run of sibling cards and numbers them. Returns how many were rated and how many were taken out.
async function rankDom(root, spec) {
  const cards = [...root.querySelectorAll('.media-card[data-rk]')];
  if (!cards.length) return { total: 0, left: 0, failed: false };
  const wantMdb = needsMdb([...rankSources(spec), cardSource()]) || (mdb.connected && !!root.querySelector('.rating-slot.rich'));
  let failed = false;
  const raws = await ratingsFor(cards.map(c => askOf(cardItem(c))), wantMdb).catch(e => { console.warn(e); failed = true; return []; });
  const entries = cards.map((card, i) => ({ card, ratings: cardRatings(card, raws[i]) }));
  const kept = new Set(rankItems(entries, { ...spec, sort: null }).map(e => e.card));
  for (const e of entries) if (!kept.has(e.card)) e.card.remove();
  if (spec.sort) {
    const groups = new Map();
    for (const e of entries) if (kept.has(e.card)) groups.set(e.card.parentNode, [...(groups.get(e.card.parentNode) ?? []), e]);
    for (const [parent, list] of groups) {
      const marker = document.createComment('');
      parent.insertBefore(marker, list[0].card);
      rankItems(list, { ...spec, ranges: [] }).forEach((e, i) => {
        parent.insertBefore(e.card, marker);
        rankBadge(e.card, i + 1);
      });
      marker.remove();
    }
  }
  for (const e of entries) {
    const slot = kept.has(e.card) && e.card.querySelector('.rating-slot');
    if (slot && !(slot.classList.contains('rich') && mdb.connected && !wantMdb)) paintSlot(slot, e.ratings);
  }
  return { total: cards.length, left: cards.length - kept.size, failed };
}
function rankBadge(card, n) {
  const art = card.querySelector('.art');
  if (!art) return;
  art.querySelector('.rank-badge')?.remove();
  art.insertAdjacentHTML('beforeend', `<b class="rank-badge" aria-label="Rank ${n}">${n}</b>`);
  card.classList.add('ranked');
}

// A grid with a rating sort or filter first gathers up to RANK_POOL titles, then ranks the cards they make.
async function rankGrid({ load, pageSize, card, spec, progress }) {
  const pool = [];
  let more = true;
  for (let page = 1; more && pool.length < RANK_POOL && page <= RANK_LOADS; page++) {
    const items = await load(page);
    pool.push(...items);
    more = items.length >= pageSize;
    progress(`Finding titles… ${num(pool.length)}`);
  }
  const box = document.createElement('div');
  box.innerHTML = pool.map(card).join('');
  box.querySelectorAll('.grid-day').forEach(h => h.remove()); // days mean nothing in rating order; each card has its date
  progress(`Rating ${num(box.querySelectorAll('.media-card[data-rk]').length)} titles…`);
  const stats = await rankDom(box, spec);
  return { nodes: [...box.childNodes], capped: more, ...stats };
}

const rangeText = (key, { lo, hi }) => {
  const [min, max] = [ratingText(key, { value: lo }), ratingText(key, { value: hi })];
  return hi >= ratingSource(key).max ? `${min}+` : lo <= 0 ? `up to ${max}` : `${min} to ${max}`;
};
// The line above a ranked list: what decides the order, what is filtered, and a way out.
function rankBanner(spec, { capped, left, failed } = {}) {
  const parts = failed ? ['Ratings are not available right now'] : [
    spec.sort && `${ratingSource(spec.sort).label}, ${spec.asc ? 'lowest' : 'highest'} first${ratingSource(spec.sort).trust && !spec.raw ? ', weighed by votes' : ''}`,
    ...spec.ranges.map(r => `${ratingSource(r.key).label} ${rangeText(r.key, r)}`),
    left && `${num(left)} hidden`,
    capped && `top ${RANK_POOL} of this list`,
  ];
  return `<div class="rank-banner" role="status">${icon(spec.sort ? 'sort' : 'filter')}<span>${esc(parts.filter(Boolean).join(' · '))}</span>
    <button type="button" class="link-btn" data-open-filters>Edit</button><button type="button" class="link-btn" data-rank-clear>Clear</button></div>`;
}
document.addEventListener('click', ev => {
  if (ev.target.closest('[data-open-filters]')) openFilterDrawer().catch(toast);
  if (ev.target.closest('[data-rank-clear]')) {
    setActiveFilters(Object.fromEntries(Object.entries(activeFilters()).filter(([k]) => !filterDef(k).local)));
    route({ soft: true });
  }
});

// ---------- the sort menu in the top bar
// Trakt's order for the page (or its own), and every rating there is a key for. One applies at a time.
function applySort(value) {
  const f = activeFilters();
  if (value.startsWith('r:')) {
    f.rank = rankValue({ ...rankSpec(f), sort: value.slice(2) });
    if (bar.sorts) sortChoice.set(location.hash, bar.sorts[0].value);
  } else {
    delete f.rank;
    if (bar.sorts) sortChoice.set(location.hash, value.slice(2));
  }
  setActiveFilters(f);
  route({ soft: true });
}
// change: { asc } or { raw }, kept with the chosen source.
function changeSort(change) {
  const f = activeFilters();
  const spec = rankSpec(f);
  if (!spec.sort) return;
  f.rank = rankValue({ ...spec, ...change });
  setActiveFilters(f);
  route({ soft: true });
}
const sortLabel = () => {
  const { sort } = currentRank();
  return sort && filterKinds.rank ? ratingSource(sort).label : bar.sorts ? chosenSort(bar.sorts).label : 'Default';
};
function sortMenuItems() {
  const spec = filterKinds.rank ? currentRank() : { sort: null, asc: false };
  const current = spec.sort ? `r:${spec.sort}` : `t:${bar.sorts ? chosenSort(bar.sorts).value : ''}`;
  const item = (value, label) => ({ label, checked: value === current, onClick: () => applySort(value) });
  return [
    { heading: bar.sorts ? 'Trakt order' : 'Order' },
    ...(bar.sorts ?? [{ value: '', label: 'Default' }]).map(s => item(`t:${s.value}`, s.label)),
    ...(filterKinds.rank ? [{ heading: 'Rating' }, ...usableSources().map(s => item(`r:${s.key}`, s.label))] : []),
    ...(spec.sort ? [{ heading: 'Direction' },
      { label: 'Highest first', checked: !spec.asc, onClick: () => changeSort({ asc: false }) },
      { label: 'Lowest first', checked: spec.asc, onClick: () => changeSort({ asc: true }) },
      ...(ratingSource(spec.sort).trust ? [{ label: 'Weigh by number of votes', checked: !spec.raw, onClick: () => changeSort({ raw: !spec.raw }) }] : [])] : []),
    ...(filterKinds.rank && !mdb.connected ? [{ label: 'More ratings with MDBList…', icon: 'plus', onClick: () => { location.hash = '#/settings/ratings'; } }] : []),
    { label: filterKinds.rank ? 'Filter by rating…' : 'Filters…', icon: 'filter', onClick: () => openFilterDrawer().catch(toast) },
  ];
}

// ---------- title pages
const TITLE_ORDER = ['filmie', 'nanocrowd', 'imdb', 'tomatoes', 'popcorn', 'metacritic', 'letterboxd', 'trakt', 'tmdb', 'mdblist', 'rogerebert', 'mal'];
const TITLE_LINKS = { imdb: 'IMDb', tomatoes: 'Rotten Tomatoes', popcorn: 'Rotten Tomatoes', metacritic: 'Metacritic', letterboxd: 'Letterboxd', trakt: 'Trakt', tmdb: 'TMDB' };
// Every rating a title has, each linking to its source where there is a page for it. `info` is the title page's
// own Nanocrowd lookup, which searches wider than a card's.
async function titleRatings(box, { type, id, imdb, name, year, t, d, links, info }) {
  const token = routeToken;
  const [raw] = await ratingsFor([askOf({ type, id, imdb, title: name, year })], mdb.connected).catch(e => { console.warn(e); return [null]; });
  const own = await info;
  if (token !== routeToken || !box.isConnected) return;
  const crowd = raw?.nanocrowd ?? (own?.crowdRating ? { rating: own.crowdRating } : null);
  const r = ratingsOf({ ...raw, nanocrowd: crowd }, { trakt: t?.rating, traktVotes: t?.votes, tmdb: d.vote_average, tmdbVotes: d.vote_count });
  const link = key => links.find(([n]) => n === TITLE_LINKS[key])?.[1];
  const chips = TITLE_ORDER.filter(k => r[k]).map(k => {
    const src = ratingSource(k);
    const inner = `<small>${esc(src.label)}</small><b>${esc(ratingText(k, r[k]))}</b>`;
    const attrs = `class="title-rating${k === 'filmie' ? ' main' : ''}" title="${esc(ratingTitle(k, r[k]))}"`;
    return link(k) ? `<a ${attrs} href="${esc(link(k))}" target="_blank">${inner}</a>` : `<span ${attrs}>${inner}</span>`;
  });
  if (!mdb.connected) chips.push(`<a class="title-rating more" href="#/settings/ratings" title="Add an MDBList key for IMDb, Rotten Tomatoes, Metacritic and Letterboxd">${icon('plus')}<small>More ratings</small></a>`);
  box.innerHTML = chips.join('');
  box.hidden = false;
}

// ---------- Settings
const clock = at => new Date(at * 1000).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
function quotaText(m) {
  const parts = [];
  if (m.limit != null) parts.push(`${num(m.remaining ?? m.limit)} of ${num(m.limit)} left.`);
  else if (m.remaining != null) parts.push(`${num(m.remaining)} left.`);
  else parts.push('Not known until the first ratings arrive.');
  if (m.reset) parts.push(`Resets ${clock(m.reset)}.`);
  if (m.paused_until) parts.push(`MDBList asked Filmie to wait, so new ratings pause until ${clock(m.paused_until)}. Saved ones still show.`);
  else if (m.error) parts.push(`Last answer: ${m.error}.`);
  return parts.join(' ');
}
function renderRatingSettings(box) {
  const field = (title, help, control) => `<div class="field"><div><b>${title}</b><p class="muted">${help}</p></div>${control}</div>`;
  const draw = () => {
    const now = getCardRating();
    const picks = [...usableSources().map(s => ({ value: s.key, label: s.label })), { value: 'none', label: 'None' }];
    box.innerHTML = `<div class="card-head"><h2>Ratings</h2><p class="muted">Nanocrowd's audience rating works with no setup. A free MDBList key adds IMDb, Rotten Tomatoes, Metacritic, Letterboxd, Trakt, TMDB and MDBList's own score, to cards, title pages and the rating sort and filters.</p></div>
      ${field('On cards', 'The rating every card shows, unless its page is sorted by another.',
        `<select id="card-rating" aria-label="Rating on cards">${picks.map(p => `<option value="${p.value}"${p.value === now ? ' selected' : ''}>${esc(p.label)}</option>`).join('')}</select>`)}
      ${mdb.connected
        ? `${field('MDBList', `Connected${mdb.username ? ` as ${esc(mdb.username)}` : ''}${mdb.supporter ? ' · Supporter' : ''}. Its ratings are saved on this PC for 8 hours, so pages you come back to don't ask again.`, '<button id="mdb-remove" class="btn">Remove key</button>')}
          ${field('Requests left today', `<span id="mdb-quota">${esc(quotaText(mdb))}</span>`, '<button id="mdb-refresh" class="btn">Check again</button>')}`
        : field('MDBList API key', 'Sign in at MDBList, then copy your key from <a href="https://mdblist.com/preferences/#api" target="_blank">Preferences, API</a>. It is kept in Windows Credential Manager. The free tier allows 1,000 requests a day, and one request rates up to 100 titles.',
          '<form class="key-form" id="mdb-form"><input type="password" id="mdb-key" autocomplete="off" spellcheck="false" placeholder="Paste your key" aria-label="MDBList API key"><button class="btn primary" id="mdb-save">Save</button></form>')}`;
    box.querySelector('#card-rating').onchange = ev => { setCardRating(ev.target.value); toast('Card rating saved'); };
    const form = box.querySelector('#mdb-form');
    if (form) form.onsubmit = async ev => {
      ev.preventDefault();
      const button = box.querySelector('#mdb-save');
      button.disabled = true;
      try {
        mdb = await invoke('mdblist_set_key', { key: box.querySelector('#mdb-key').value });
        clearRatingMemo();
        toast('MDBList connected');
        draw();
      } catch (e) { button.disabled = false; toast(e); }
    };
    busy(box.querySelector('#mdb-refresh'), async () => { await refreshMdb(true); draw(); });
    const remove = box.querySelector('#mdb-remove');
    if (remove) remove.onclick = () => modal({
      title: 'Remove the MDBList key?',
      body: '<p class="muted">Cards and title pages go back to Nanocrowd and Trakt ratings. You can paste the key again any time.</p>',
      actions: [{ label: 'Cancel' }, { label: 'Remove key', primary: true, onClick: async () => {
        await invoke('mdblist_forget_key').catch(toast);
        mdb = { connected: false };
        clearRatingMemo();
        if (!usableRating(getCardRating())) setCardRating('nanocrowd');
        draw();
      } }],
    });
  };
  draw();
  if (mdb.connected) refreshMdb(true).then(() => { if (box.isConnected) draw(); });
}
