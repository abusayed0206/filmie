// Title pages, the episode drawer and person pages.
Object.assign(pages, {
  title: (type, id, season) => showTitle(type === 'tv' ? 'tv' : 'movie', +id, season === undefined ? null : +season),
  person: id => showPerson(+id),
});

pages.title.bar = { back: true };
pages.person.bar = { back: true, title: 'Person' };

const seasonChoice = new Map(); // show id -> the season being viewed, so a refresh stays on it
const statusText = s => s ? s.replace(/\b\w/g, c => c.toUpperCase()) : '';
const REGION = () => (navigator.language.split('-')[1] || 'US').toUpperCase();

// Writes something for this title, then redraws it in place.
async function titleWrite(path, body, done) {
  await write(path, body);
  await refreshProgress().catch(console.warn);
  if (done) toast(done);
  await route({ soft: true });
}

function trackDrawer({ type, id, name, next, watched }) {
  const options = next ? [{ value: 'next', label: `Next: S${next[0]}E${next[1]}` }, { value: 'all', label: 'All episodes' }] : null;
  let target = options ? 'next' : 'movie';
  const d = drawer({
    title: 'Mark as watched', width: 400,
    body: `<p class="muted">${esc(name)}</p>
      ${options ? `<div class="filter-switch">${segmented('track-target', options, target, v => { target = v; }, 'What to mark')}</div>` : ''}
      <div class="list-picker">
        <button type="button" class="btn primary" data-when="now">Just now</button>
        <button type="button" class="btn" data-when="released">Release date</button>
        <label class="filter-field"><span class="filter-label">Other date</span><input type="datetime-local" id="track-date" aria-label="Date watched" max="${isoDate()}T23:59"></label>
        <button type="button" class="btn" data-when="other" disabled>Save this date</button>
        ${watched && type === 'movie' ? '<button type="button" class="btn danger" data-remove-plays>Remove all plays</button>' : ''}
      </div>`,
  });
  const dateInput = d.querySelector('#track-date');
  dateInput.oninput = () => { d.querySelector('[data-when="other"]').disabled = !dateInput.value; };
  d.querySelector('.list-picker').onclick = ev => {
    const button = ev.target.closest('button');
    if (!button) return;
    const removing = button.dataset.removePlays !== undefined;
    const save = async () => {
      button.disabled = true;
      try {
        if (removing) {
          await titleWrite('/sync/history/remove', historyBody({ type, id }), 'Removed from your history');
        } else {
          const when = { now: undefined, released: 'released', other: dateInput.value && new Date(dateInput.value).toISOString() }[button.dataset.when];
          const what = target === 'next' ? { type, id, season: next[0], episode: next[1] } : { type, id };
          await titleWrite('/sync/history', historyBody(what, when), 'Marked watched on Trakt');
        }
        d.close();
      } catch (e) { button.disabled = false; toast(e); }
    };
    if (removing) modal({ title: 'Remove all plays?', body: `<p class="muted">This removes every play of ${esc(name)} from your Trakt history.</p>`, actions: [{ label: 'Cancel' }, { label: 'Remove plays', primary: true, onClick: save }] });
    else if (watched && target !== 'next') modal({ title: 'Already watched', body: `<p class="muted">This adds another play of ${esc(name)} to your Trakt history.</p>`, actions: [{ label: 'Cancel' }, { label: 'Add another play', primary: true, onClick: save }] });
    else save();
  };
}

function ratingsDrawer(rows, distribution) {
  const total = Object.values(distribution ?? {}).reduce((a, b) => a + b, 0);
  drawer({
    title: 'Ratings', width: 400,
    body: `<div class="rating-list">${rows.map(r => `<div class="rating-line"><span>${esc(r.label)}</span><b>${esc(r.value)}</b>${r.votes ? `<small class="muted">${num(r.votes)} votes</small>` : ''}${r.link ? `<a href="${esc(r.link)}" target="_blank" class="muted">Open</a>` : ''}</div>`).join('') || '<p class="muted">No ratings yet.</p>'}</div>
      ${total ? `<h3 class="filter-section">Trakt votes</h3><div class="rating-bars">${Object.entries(distribution).reverse().map(([k, v]) => `<div class="rating-bar"><span>${esc(k)}</span><i style="--w:${100 * v / total}%"></i><small class="muted">${num(v)}</small></div>`).join('')}</div>` : ''}`,
  });
}

async function detailsDrawer({ d, t, tt, links }) {
  const facts = [
    ['Status', statusText(t?.status ?? d.status)], ['Certification', t?.certification], ['Released', t?.released ?? t?.first_aired?.slice(0, 10) ?? d.first_air_date], ['Runtime', runtimeText(t?.runtime ?? d.runtime)],
    ['Language', t?.language?.toUpperCase()], ['Country', t?.country?.toUpperCase()], ['Network', t?.network], ['Genres', (d.genres ?? []).map(g => g.name).join(', ')], ['Tagline', t?.tagline ?? d.tagline],
  ].filter(([, v]) => v);
  const box = drawer({ title: 'Details', body: `<div class="fact-list">${facts.map(([k, v]) => `<div class="fact"><span class="muted">${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}</div><div id="details-more"></div>
    <h3 class="filter-section">Elsewhere</h3><div class="links">${links.map(([n, u]) => `<a href="${esc(u)}" target="_blank">${esc(n)}</a>`).join('')}</div>` });
  if (!t) return;
  const base = `/${tt}s/${t.ids.trakt}`;
  const none = () => null;
  // Only movies have /releases in the API.
  const [stats, studios, aliases, watching, translations, releases] = await Promise.all([
    traktGet(`${base}/stats`).catch(none), traktGet(`${base}/studios`).catch(none), traktGet(`${base}/aliases`).catch(none), traktGet(`${base}/watching`).catch(none),
    traktGet(`${base}/translations`).catch(none), tt === 'movie' ? traktGet(`${base}/releases/${REGION().toLowerCase()}`).catch(none) : null,
  ]);
  const names = new Intl.DisplayNames(['en'], { type: 'language' });
  // of() throws on a malformed code, which would lose the whole section.
  const languageName = code => { try { return names.of(code); } catch { return code; } };
  const statLine = stats && [['Watchers', stats.watchers], ['Plays', stats.plays], ['Collectors', stats.collectors], ['Lists', stats.lists], ['Favorited', stats.favorited], ['Comments', stats.comments]].filter(([, v]) => v);
  const more = [
    statLine?.length && `<h3 class="filter-section">On Trakt</h3><div class="fact-list">${watching?.length ? `<div class="fact"><span class="muted">Watching now</span><span>${num(watching.length)}</span></div>` : ''}${statLine.map(([k, v]) => `<div class="fact"><span class="muted">${k}</span><span>${num(v)}</span></div>`).join('')}</div>`,
    releases?.length && `<h3 class="filter-section">Releases in ${esc(REGION())}</h3><div class="fact-list">${releases.map(r => `<div class="fact"><span class="muted">${esc(statusText(r.release_type) || 'Release')}${r.note ? ` · ${esc(r.note)}` : ''}</span><span>${esc(fullDate(r.release_date))}</span></div>`).join('')}</div>`,
    studios?.length && `<h3 class="filter-section">Studios</h3><p>${esc(studios.map(s => s.name).join(', '))}</p>`,
    aliases?.length && `<h3 class="filter-section">Also known as</h3><p class="muted">${esc([...new Set(aliases.map(a => a.title))].slice(0, 12).join(', '))}</p>`,
    translations?.length && `<h3 class="filter-section">Translated into</h3><p class="muted">${esc([...new Set(translations.map(x => languageName(x.language)))].join(', '))}</p>`,
  ].filter(Boolean).join('');
  box.querySelector('#details-more').innerHTML = more;
}

function whereDrawer(prov) {
  const group = (title, list) => list?.length ? `<h3 class="filter-section">${title}</h3><div class="providers">${list.map(p => `<img src="${IMG}w92${esc(p.logo_path)}" alt="${esc(p.provider_name)}" title="${esc(p.provider_name)}">`).join('')}</div>` : '';
  drawer({ title: 'Where to watch', width: 400, body: `${group('Stream', prov.flatrate)}${group('Free', prov.free)}${group('With ads', prov.ads)}${group('Rent', prov.rent)}${group('Buy', prov.buy)}
    <p><a href="${esc(prov.link)}" target="_blank" class="muted">Availability by JustWatch</a></p>` });
}

async function historyDrawer(title, tt, t) {
  const d = drawer({ title: `Your history`, width: 400, body: `<p class="muted">${esc(title)}</p><p class="muted" id="plays">Loading…</p>` });
  const plays = await traktGet(`/sync/history/${tt}s/${t.ids.trakt}?limit=100`).catch(() => null);
  const box = d.querySelector('#plays');
  if (!plays?.length) { box.textContent = 'No plays yet.'; return; }
  box.outerHTML = `<div class="fact-list">${plays.map(p => `<div class="fact"><span>${esc(p.episode ? episodeLine(p.episode) : title)}</span><span class="muted">${esc(new Date(p.watched_at).toLocaleDateString())}</span></div>`).join('')}</div>`;
}

const commentCard = c => {
  const who = c.user?.username ?? 'Trakt member';
  // shortcut: initials rather than avatars, because Trakt blocks hotlinked images. Upgrade if an image cache is added.
  return `<article class="comment-card"><div class="comment-head"><span class="avatar small" aria-hidden="true">${esc(who[0].toUpperCase())}</span><b>${esc(who)}</b><small class="muted">${esc(shortDate(c.created_at))}</small>${c.user_rating ? `<span class="meta-tag">${esc(c.user_rating)}/10</span>` : ''}</div>
    ${c.spoiler ? '<button type="button" class="btn spoiler-show">Contains spoilers. Show</button>' : ''}
    <p class="comment-text"${c.spoiler ? ' hidden' : ''}>${esc(c.comment)}</p>
    <div class="comment-foot muted"><small>${num(c.likes)} likes</small><small>${num(c.replies)} replies</small></div></article>`;
};
const videoCard = v => `<a class="video-card" href="${esc(v.url)}" target="_blank" title="${esc(v.title)}"><span class="play-icon">${icon('play')}</span><b>${esc(v.title)}</b><small class="muted">${esc(statusText(v.type))}</small></a>`;
const publicListCard = l => `<a class="list-tile" href="#/list/${l.ids.trakt}/public"><b>${esc(l.name)}</b><span>${num(l.item_count)} items${l.user?.username ? ` · ${esc(l.user.username)}` : ''}</span>${l.description ? `<p>${esc(l.description)}</p>` : ''}</a>`;

document.addEventListener('click', ev => {
  const show = ev.target.closest('.spoiler-show');
  if (!show) return;
  show.nextElementSibling.hidden = false;
  show.remove();
});

async function showTitle(type, id, season = null) {
  const token = routeToken;
  const tt = traktType(type);
  const none = e => { console.warn('Trakt lookup failed', e); return null; };
  const [d, t] = await Promise.all([
    tmdb(`/${type}/${id}`, { append_to_response: 'external_ids,videos,watch/providers,credits' }),
    traktGet(`/search/tmdb/${id}?type=${tt}`).then(r => {
      const found = r[0]?.[tt];
      return found ? traktGet(`/${tt}s/${found.ids.trakt}?extended=full,colors`) : null;
    }).catch(none),
  ]);
  if (token !== routeToken) return;
  const name = d.title ?? d.name;
  const imdb = d.external_ids?.imdb_id;
  const trailer = d.videos?.results?.find(v => v.site === 'YouTube' && v.type === 'Trailer');
  const trailerUrl = trailer && `https://www.youtube.com/watch?v=${encodeURIComponent(trailer.key)}`;
  const prov = d['watch/providers']?.results?.[REGION()];
  const q = encodeURIComponent(name);
  const links = [
    t && ['Trakt', `https://app.trakt.tv/${tt}s/${encodeURIComponent(t.ids.slug)}`],
    imdb && ['IMDb', `https://www.imdb.com/title/${imdb}/`],
    type === 'movie' && ['Letterboxd', `https://letterboxd.com/tmdb/${id}/`],
    ['TMDB', `https://www.themoviedb.org/${type}/${id}`],
    ['Rotten Tomatoes', `https://www.rottentomatoes.com/search?search=${q}`],
    ['Metacritic', `https://www.metacritic.com/search/${q}/`],
  ].filter(Boolean);
  const next = type === 'tv' ? nextEps.get(id) : null;
  const started = !!next;
  const watched = type === 'movie' ? watchedMovie(id) : !!watchedShow(id) && !started;
  const listed = inWatchlist(tt, id);
  const status = statusTag({ dropped: type === 'tv' && droppedShow(id), watched, started, postCredits: t?.after_credits || t?.during_credits, watchlisted: listed });
  const credits = type === 'movie'
    ? ['Directed by', (d.credits?.crew ?? []).filter(c => c.job === 'Director')]
    : ['Created by', d.created_by ?? []];
  const people = credits[1].slice(0, 2);
  const length = runtimeText(t?.runtime ?? d.runtime);
  const line = [yearOf(d), length, type === 'tv' && (t?.aired_episodes ?? d.number_of_episodes) && `${t?.aired_episodes ?? d.number_of_episodes} episodes`, t?.certification, statusText(t?.genres?.[0] ?? d.genres?.[0]?.name)].filter(Boolean);
  const glow = safeColor(t?.colors?.poster?.[0]);
  const tiles = (prov?.flatrate ?? prov?.free ?? prov?.rent ?? []).slice(0, 6);
  const canPlay = playHref(type, id);

  app.innerHTML = `<section class="summary"${glow ? ` style="--glow:${glow}"` : ''}>
    <div class="summary-inner">
      <div class="hero-poster">${trailerUrl ? `<a href="${esc(trailerUrl)}" target="_blank" aria-label="Watch the trailer">` : '<div>'}
        ${d.poster_path ? `<img class="summary-poster" src="${IMG}w500${esc(d.poster_path)}" alt="">` : `<div class="summary-poster no-poster">${esc(name)}</div>`}${trailerUrl ? '</a>' : '</div>'}
        ${status ? `<i class="status-tag">${esc(status)}</i>` : ''}</div>
      <div class="summary-info">
        <h1>${esc(name)}</h1>
        ${people.length ? `<p class="credit-line">${esc(credits[0])} ${people.map(p => `<a href="#/person/${+p.id}">${esc(p.name)}</a>`).join(', ')}</p>` : ''}
        <p class="meta-line muted"><span>${esc(line.join(' • '))}</span> <button type="button" class="link-btn" id="open-details">Details</button></p>
        ${t?.status || d.status ? `<p class="status-line">${esc(statusText(t?.status ?? d.status))}</p>` : ''}
        <button type="button" class="ratings" id="ratings" aria-label="Show ratings"><span class="rating-item"><b>TMDB</b> ${(d.vote_average ?? 0).toFixed(1)}</span>${icon('chevron')}</button>
        <p class="overview" id="overview">${esc(t?.overview ?? d.overview)}</p>
        <div class="action-bar">
          <a class="action-play" href="${canPlay}">${icon('play')}<span>${next ? `S${next[0]}E${next[1]}` : 'Play'}</span></a>
          ${user ? `<button type="button" class="action-btn track-btn${watched ? ' on' : ''}" id="track" title="Mark as watched" aria-label="Mark as watched">${icon('check')}</button>
            <button type="button" class="action-btn${listed ? ' on' : ''}" id="watchlist" title="${listed ? 'On your watchlist' : 'Add to watchlist'}" aria-label="${listed ? 'Remove from watchlist' : 'Add to watchlist'}" aria-pressed="${!!listed}">${icon('bookmark')}</button>` : ''}
          ${trailerUrl ? `<a class="action-btn" href="${esc(trailerUrl)}" target="_blank" title="Trailer" aria-label="Watch the trailer">${icon('video')}</a>` : ''}
          ${user ? `<button type="button" class="action-btn" id="more-actions" title="More" aria-label="More actions">${icon('more')}</button>` : ''}
        </div>
        ${user ? `<div class="rate-row">${starRating(myRating(tt, id), `Your rating of ${name}`)}<button type="button" class="action-btn" id="favorite" title="Favorite" aria-label="Favorite" aria-pressed="false">${icon('heart')}</button></div>` : ''}
      </div>
      ${prov ? `<aside class="where"><div class="where-head"><h2>Where to Watch</h2><button type="button" class="link-btn" id="open-where">All</button></div>
        <div class="where-tiles">${tiles.map(p => `<span class="where-tile"><img src="${IMG}w154${esc(p.logo_path)}" alt="${esc(p.provider_name)}" title="${esc(p.provider_name)}"></span>`).join('')}</div>
        <small><a href="${esc(prov.link)}" target="_blank" class="muted">via JustWatch</a></small>
        <div id="sentiment"></div></aside>` : '<aside class="where where-empty"><div id="sentiment"></div></aside>'}
    </div></section>
    <div class="page title-rows" id="title-rows"></div>`;

  const $ = s => document.getElementById(s);
  $('open-details').onclick = () => detailsDrawer({ d, t, tt, links });
  if (prov) $('open-where').onclick = () => whereDrawer(prov);
  const body = { [`${tt}s`]: [ids(id)] };
  if (user) {
    busy($('track'), () => trackDrawer({ type, id, name, next, watched }));
    busy($('watchlist'), () => titleWrite(listed ? '/sync/watchlist/remove' : '/sync/watchlist', body, listed ? 'Removed from watchlist' : 'Added to watchlist'));
    const moreItems = [
      { label: 'Add to list', icon: 'list', onClick: () => openListPicker({ type, id, title: name }) },
      { label: 'Add to library', icon: 'library', onClick: () => titleWrite('/sync/collection', body, 'Added to your library').catch(toast) },
      t && { label: 'Your history', icon: 'history', onClick: () => historyDrawer(name, tt, t) },
      // shortcut: no way to add a note here, because Trakt's contract doesn't say what the note's `item` must hold. Upgrade once a real POST /notes is confirmed.
      type === 'tv' && droppedShow(id) && { label: 'Undrop this show', icon: 'plus', onClick: () => titleWrite('/users/hidden/dropped/remove', body, 'Back in your progress').catch(toast) },
      type === 'tv' && !droppedShow(id) && { label: 'Drop this show', icon: 'close', danger: true, onClick: () => modal({
        title: 'Drop this show?',
        body: `<p class="muted">${esc(name)} will move to your dropped shows, and leave Continue Watching.</p>`,
        actions: [{ label: 'Cancel' }, { label: 'Drop show', primary: true, onClick: () => titleWrite('/users/hidden/dropped', body, 'Show dropped').catch(toast) }],
      }) },
    ].filter(Boolean);
    menu($('more-actions'), moreItems);
    bindStars(app.querySelector('.rate-row'), v => (v
      ? write('/sync/ratings', { [`${tt}s`]: [{ ...ids(id), rating: v }] })
      : write('/sync/ratings/remove', body)).then(() => toast(v ? 'Rating saved' : 'Rating removed')));
    const favorite = $('favorite');
    // Favourites aren't in the library mirror, so this asks once the page is up.
    traktGet(`/sync/favorites/${tt}s/rank/asc?limit=100`).then(list => {
      const on = (list ?? []).some(x => x[tt]?.ids?.tmdb === id);
      favorite.classList.toggle('on', on);
      favorite.setAttribute('aria-pressed', String(on));
    }).catch(console.warn);
    busy(favorite, async () => {
      const on = favorite.getAttribute('aria-pressed') === 'true';
      await trakt('POST', on ? '/sync/favorites/remove' : '/sync/favorites', body);
      favorite.classList.toggle('on', !on);
      favorite.setAttribute('aria-pressed', String(!on));
      toast(on ? 'Removed from favorites' : 'Added to favorites');
    });
  }

  // Ratings and sentiment fill in without moving what's already on the page.
  let distribution = null;
  let ratingList = [{ label: 'TMDB', value: (d.vote_average ?? 0).toFixed(1), votes: d.vote_count }];
  $('ratings').onclick = () => ratingsDrawer(ratingList, distribution);
  const base = t && `/${tt}s/${t.ids.trakt}`;
  const rated = t ? traktGet(`${base}/ratings?extended=all`).then(r => {
    if (token !== routeToken) return;
    const rows = ratingRows(r);
    if (!rows.length) return;
    ratingList = rows;
    distribution = r.trakt?.distribution ?? null;
    const box = $('ratings');
    if (box) box.innerHTML = rows.filter(x => x.main).map(x => `<span class="rating-item"><b>${esc(x.label)}</b> ${esc(x.value)}</span>`).join('') + icon('chevron');
  }).catch(console.warn) : null;
  if (t) traktGet(`${base}/sentiments`).then(s => {
    const box = $('sentiment');
    if (!box || token !== routeToken || !(s?.good?.length || s?.bad?.length)) return;
    const list = (title, items, cls) => items?.length ? `<div class="sentiment-group"><b class="${cls}">${title}</b><ul>${items.slice(0, 3).map(i => `<li>${esc(i.sentiment)}</li>`).join('')}</ul></div>` : '';
    box.innerHTML = `<h2 class="sentiment-title">Sentiment</h2>${list('Good', s.good, 'good')}${list('Bad', s.bad, 'bad')}`;
  }).catch(console.warn);

  const into = $('title-rows');
  const seasons = type === 'tv' ? await seasonRail({ d, id, t, into, season, next }) : null;
  if (token !== routeToken) return;
  const cast = d.credits?.cast?.slice(0, 20) ?? [];
  const rows = renderRows([
    cast.length && { id: 'cast', title: 'Actors', load: async () => cast.map(personCard).join('') },
    t && { id: 'comments', title: 'Comments', kind: 'list', load: async () => (await traktGet(`${base}/comments/likes?limit=10`)).map(commentCard).join('') },
    t && { id: 'videos', title: 'Videos', kind: 'landscape', load: async () => (await traktGet(`${base}/videos`)).filter(v => youtubeUrl(v.url)).map(videoCard).join('') },
    t && { id: 'related', title: 'Related', bright: true, load: async () => posters(await traktGet(`${base}/related?limit=20&extended=full`), tt) },
    t && { id: 'lists', title: 'Lists', kind: 'list', load: async () => (await traktGet(`${base}/lists/personal/popular?limit=10`)).map(publicListCard).join('') },
  ], into);
  await Promise.all([rated, seasons, rows]);
}

// ---------- seasons
async function seasonRail({ d, id, t, into, season, next }) {
  const token = routeToken;
  const list = (d.seasons ?? []).filter(s => s.episode_count > 0);
  if (!list.length) return;
  const requested = season ?? seasonChoice.get(id);
  const fallback = (next ?? [list.find(s => s.season_number > 0)?.season_number ?? list[0].season_number])[0];
  let current = list.some(s => s.season_number === requested) ? requested : fallback;
  // Per-episode watched state, fetched fresh; null when signed out.
  const progress = user && t ? await trakt('GET', `/shows/${t.ids.trakt}/progress/watched`, null).catch(() => null) : null;
  if (token !== routeToken) return;
  into.insertAdjacentHTML('beforeend', `<section class="row" id="season-row"><div class="row-head"><div class="row-heading"><h2>Seasons</h2></div>
      <div class="row-tools season-tools"><select id="season" aria-label="Season">${list.map(s => `<option value="${s.season_number}">${esc(s.name)} (${s.episode_count})</option>`).join('')}</select>
      <button type="button" class="btn" id="view-seasons">View All</button></div></div>
    <div class="row-body"><div class="track kind-landscape" id="episodes">${skeletonCards(6, 'landscape')}</div></div></section>`);
  const select = document.getElementById('season');
  select.value = String(current);
  const seasonDone = n => {
    const s = progress?.seasons?.find(x => x.number === n);
    return s ? `${s.completed}/${s.aired}` : '';
  };
  const load = async n => {
    current = n;
    seasonChoice.set(id, n);
    select.value = String(n);
    const data = await tmdb(`/tv/${id}/season/${n}`);
    if (token !== routeToken) return;
    const eps = progress?.seasons?.find(x => x.number === n)?.episodes ?? [];
    const isWatched = e => eps.some(x => x.number === e && x.completed);
    const track = document.getElementById('episodes');
    track.innerHTML = (data.episodes ?? []).map(e => `<div class="media-card landscape-card episode-card${isWatched(e.episode_number) ? ' is-watched' : ''}">
      <button type="button" class="episode-open" data-episode="${e.episode_number}" aria-label="Episode ${e.episode_number}: ${esc(e.name)}">
        <div class="art${e.still_path ? ' has-art' : ''}"${e.still_path ? ` style="background-image:url('${IMG}w500${esc(e.still_path)}')"` : ''}><span class="cover-title">${esc(e.name)}</span>${isWatched(e.episode_number) ? '<i class="status-tag">Watched</i>' : ''}</div>
        <b>${e.episode_number}. ${esc(e.name)}</b><small class="muted">${esc(shortDate(e.air_date) || 'TBA')}${e.runtime ? ` · ${runtimeText(e.runtime)}` : ''}</small></button></div>`).join('');
    track.onclick = ev => {
      const open = ev.target.closest('[data-episode]');
      if (!open) return;
      const e = data.episodes.find(x => x.episode_number === +open.dataset.episode);
      episodeDrawer({ id, season: n, e, watched: isWatched(e.episode_number), name: d.name ?? d.title, onChange: () => route({ soft: true }) });
    };
    // Opens on the next episode to watch.
    const target = next && next[0] === n ? track.querySelector(`[data-episode="${next[1]}"]`)?.closest('.media-card') : null;
    track.scrollLeft = target ? target.offsetLeft - track.offsetLeft : 0;
  };
  select.onchange = () => load(+select.value).catch(toast);
  document.getElementById('view-seasons').onclick = () => {
    const box = drawer({ title: 'Seasons', width: 400, body: `<div class="list-picker">${list.map(s => `<button type="button" class="btn${s.season_number === current ? ' on' : ''}" data-season="${s.season_number}"><span>${esc(s.name)}</span><small class="muted">${s.episode_count} episodes${seasonDone(s.season_number) ? ` · ${seasonDone(s.season_number)} watched` : ''}</small></button>`).join('')}</div>` });
    box.querySelector('.list-picker').onclick = ev => {
      const button = ev.target.closest('[data-season]');
      if (!button) return;
      box.close();
      load(+button.dataset.season).catch(toast);
    };
  };
  await load(current).catch(toast);
}

function episodeDrawer({ id, season, e, watched, name, onChange }) {
  const title = `S${season}E${e.episode_number}: ${e.name}`;
  const d = drawer({
    title: e.name,
    body: `${e.still_path ? `<img class="episode-still" src="${IMG}w780${esc(e.still_path)}" alt="">` : ''}
      <p class="muted">${esc(name)} · S${season}E${e.episode_number}${e.air_date ? ` · ${esc(shortDate(e.air_date))}` : ''}${e.runtime ? ` · ${runtimeText(e.runtime)}` : ''}${e.vote_average ? ` · TMDB ${e.vote_average.toFixed(1)}` : ''}</p>
      <div class="episode-actions"><a class="btn primary" href="#/play/tv/${id}/${season}/${e.episode_number}" data-close>${icon('play')}Play</a>
        ${user ? `<button type="button" class="btn${watched ? ' on' : ''}" id="episode-watch">${icon('check')}${watched ? 'Watched' : 'Mark watched'}</button>` : ''}</div>
      ${user ? `<div class="rate-row" id="episode-rate"></div>` : ''}
      <p class="overview">${esc(e.overview)}</p>`,
  });
  d.querySelector('a[data-close]').addEventListener('click', () => d.close());
  if (!user) return;
  // Episode ratings aren't in the library mirror, so the stars wait for them rather than showing a false empty.
  traktGet('/sync/ratings/episodes').catch(() => []).then(list => {
    if (!d.open) return;
    d.querySelector('#episode-rate').innerHTML = starRating(list.find(x => x.episode?.ids?.tmdb === e.id)?.rating, `Your rating of ${title}`);
    bindStarsFor(d);
  });
  busy(d.querySelector('#episode-watch'), async () => {
    await write(watched ? '/sync/history/remove' : '/sync/history', episodeBody(id, season, e.episode_number));
    await refreshProgress().catch(console.warn);
    toast(watched ? 'Removed from your history' : 'Marked watched on Trakt');
    d.close();
    onChange();
  });
  const bindStarsFor = root => bindStars(root, v => {
    const item = { ids: { tmdb: e.id } };
    return (v ? trakt('POST', '/sync/ratings', { episodes: [{ ...item, rating: v }] }) : trakt('POST', '/sync/ratings/remove', { episodes: [item] })).then(() => toast(v ? 'Rating saved' : 'Rating removed'));
  });
}

// ---------- people. Cast comes from TMDB, so a person's address is their TMDB id.
async function showPerson(id) {
  const token = routeToken;
  const none = () => null;
  const [photo, found] = await Promise.all([tmdb(`/person/${id}`).catch(none), traktGet(`/search/tmdb/${id}?type=person`).catch(none)]);
  if (token !== routeToken) return;
  const slug = found?.[0]?.person?.ids?.trakt;
  const p = slug ? await traktGet(`/people/${slug}?extended=full`).catch(none) : null;
  if (token !== routeToken) return;
  const name = p?.name ?? photo?.name;
  if (!name) throw new Error('This person could not be found.');
  setBarTitle(name);
  const born = p?.birthday ?? photo?.birthday;
  const died = p?.death ?? photo?.deathday;
  const facts = [born && `Born ${shortDate(born)}, ${born.slice(0, 4)}`, died && `Died ${shortDate(died)}, ${died.slice(0, 4)}`, p?.birthplace ?? photo?.place_of_birth].filter(Boolean);
  app.innerHTML = `<section class="summary"><div class="summary-inner">
      <div class="hero-poster">${photo?.profile_path ? `<img class="summary-poster" src="${IMG}w500${esc(photo.profile_path)}" alt="">` : `<div class="summary-poster no-poster">${icon('user')}</div>`}</div>
      <div class="summary-info"><h1>${esc(name)}</h1><p class="meta-line muted">${esc(facts.join(' • '))}</p><p class="overview">${esc(p?.biography ?? photo?.biography ?? '')}</p></div>
    </div></section><div class="page title-rows" id="person-rows"></div>`;
  const credits = (kind, type) => ({
    id: `person-${kind}`, title: kind === 'movies' ? 'Movies' : 'Shows', bright: true,
    load: async () => (slug ? posters(newestCredits((await traktGet(`/people/${slug}/${kind}?extended=full`)).cast), type, x => x.character || '') : ''),
  });
  await renderRows([credits('movies', 'movie'), credits('shows', 'show')], document.getElementById('person-rows'));
}
