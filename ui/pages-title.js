// Title pages.
Object.assign(pages, {
  title: (type, id, season) => showTitle(type === 'tv' ? 'tv' : 'movie', +id, season === undefined ? null : +season),
});

pages.title.bar = { back: true };

async function showTitle(type, id, season = null) {
  const token = routeToken;
  const d = await tmdb(`/${type}/${id}`, { append_to_response: 'external_ids,videos,watch/providers,credits' });
  if (token !== routeToken) return;
  const tt = traktType(type);
  const name = d.title ?? d.name;
  const imdb = d.external_ids?.imdb_id;
  const trailer = d.videos?.results?.find(v => v.site === 'YouTube' && v.type === 'Trailer');
  const region = (navigator.language.split('-')[1] || 'US').toUpperCase();
  const prov = d['watch/providers']?.results?.[region];
  const length = d.runtime ? `${Math.floor(d.runtime / 60)}h ${d.runtime % 60}m` : d.number_of_seasons ? `${d.number_of_seasons} season${d.number_of_seasons > 1 ? 's' : ''}` : '';
  const q = encodeURIComponent(name);
  const links = [
    imdb && ['IMDb', `https://www.imdb.com/title/${imdb}/`],
    type === 'movie' && ['Letterboxd', `https://letterboxd.com/tmdb/${id}/`],
    ['TMDB', `https://www.themoviedb.org/${type}/${id}`],
    ['Rotten Tomatoes', `https://www.rottentomatoes.com/search?search=${q}`],
    ['Metacritic', `https://www.metacritic.com/search/${q}/`],
  ].filter(Boolean);
  const rating = myRating(tt, id);
  const cast = d.credits?.cast?.slice(0, 20) ?? [];
  const next = type === 'tv' && nextEps.get(id);

  app.innerHTML = `<section class="summary" ${d.backdrop_path ? `style="--backdrop:url('${IMG}w1280${esc(d.backdrop_path)}')"` : ''}>
    <div class="summary-inner">
      ${d.poster_path ? `<img class="summary-poster" src="${IMG}w342${esc(d.poster_path)}" alt="">` : ''}
      <div class="summary-info">
        <h1>${esc(name)} <span class="muted">${esc(yearOf(d))}</span></h1>
        <p class="muted">${esc([type === 'tv' ? 'Show' : 'Movie', length, d.genres?.map(g => g.name).join(', ')].filter(Boolean).join(' · '))}</p>
        <div class="ratings" id="ratings"><span>TMDB <b>${(d.vote_average ?? 0).toFixed(1)}</b></span>${rating ? `<span>You <b>♥ ${rating}</b></span>` : ''}</div>
        <div class="actions">
          <a class="btn primary big" href="${playHref(type, id)}">${icon('play')}${next ? `Play S${next[0]} · E${next[1]}` : 'Play'}</a>
          ${user ? `<button id="watchlist" class="btn${inWatchlist(tt, id) ? ' on' : ''}">${inWatchlist(tt, id) ? `${icon('check')}On watchlist` : `${icon('plus')}Watchlist`}</button>
            ${type === 'movie' ? `<button id="watched" class="btn${watchedMovie(id) ? ' on' : ''}">${icon('check')}${watchedMovie(id) ? 'Watched' : 'Mark watched'}</button>` : ''}
            <select id="rate" aria-label="Your rating"><option value="">Rate…</option>${[...Array(10)].map((_, i) => `<option value="${i + 1}" ${rating === i + 1 ? 'selected' : ''}>♥ ${i + 1}</option>`).join('')}</select>
            <select id="addlist" aria-label="Add to a Trakt list" hidden></select>` : ''}
          ${trailer ? `<a class="btn" href="https://www.youtube.com/watch?v=${encodeURIComponent(trailer.key)}" target="_blank">Trailer</a>` : ''}
        </div>
        <p class="overview">${esc(d.overview)}</p>
        <div class="links" id="links">${links.map(([n, u]) => `<a href="${esc(u)}" target="_blank">${n}</a>`).join('')}</div>
      </div>
      ${prov?.flatrate ? `<aside class="where"><h2>Where to watch</h2>
        <div class="providers">${prov.flatrate.map(p => `<img src="${IMG}w92${esc(p.logo_path)}" alt="${esc(p.provider_name)}" title="${esc(p.provider_name)}">`).join('')}</div>
        <small><a href="${esc(prov.link)}" target="_blank" class="muted">via JustWatch</a></small></aside>` : ''}
      </div></section>
    ${type === 'tv' ? `<section class="page episodes-wrap"><div class="row-head"><h2>Episodes</h2>
      <select id="season" aria-label="Season">${d.seasons.map(s => `<option value="${s.season_number}">${esc(s.name)} (${s.episode_count})</option>`).join('')}</select></div>
      <ol class="episodes" id="episodes"></ol></section>` : ''}
    <div class="page" id="related"></div>`;

  const body = { [`${tt}s`]: [ids(id)] };
  busy(document.getElementById('watchlist'), async () => { await write(inWatchlist(tt, id) ? '/sync/watchlist/remove' : '/sync/watchlist', body); await route({ soft: true }); });
  busy(document.getElementById('watched'), async () => { await write(watchedMovie(id) ? '/sync/history/remove' : '/sync/history', body); await route({ soft: true }); });
  listPicker(document.getElementById('addlist'), tt, id);
  const rate = document.getElementById('rate');
  if (rate) rate.onchange = () => write(rate.value ? '/sync/ratings' : '/sync/ratings/remove',
    { [`${tt}s`]: [{ ...ids(id), ...(rate.value && { rating: +rate.value }) }] }).then(() => toast('Rating saved'), toast);

  const lookup = traktGet(`/search/tmdb/${id}?type=${tt}&extended=full`).then(r => r[0]?.[tt]);
  let firstSeason;
  if (type === 'tv') {
    // Per-episode watched state, fetched fresh; null when signed out.
    const progress = user ? lookup.then(t => t && trakt('GET', `/shows/${t.ids.trakt}/progress/watched`, null)).catch(() => null) : null;
    const select = document.getElementById('season');
    const requested = d.seasons.some(s => s.season_number === season) ? season : null;
    select.value = String(requested ?? (next || [d.seasons.find(s => s.season_number > 0)?.season_number ?? 0])[0]);
    select.onchange = () => loadSeason(id, +select.value, progress).catch(toast);
    firstSeason = loadSeason(id, +select.value, progress).catch(toast);
  }

  const rows = renderRows([
    cast.length && ['Cast', async () => cast.map(personCard).join('')],
    ['Related', async () => {
      const t = await lookup;
      return t ? posters(await traktGet(`/${tt}s/${t.ids.trakt}/related?limit=20`), tt) : '';
    }],
  ], document.getElementById('related'));
  await firstSeason; // a soft refresh or restored scroll needs the page's full height
  const t = await lookup.catch(e => console.warn('Trakt lookup failed', e));
  if (t && token === routeToken) {
    if (t.votes) document.getElementById('ratings').insertAdjacentHTML('afterbegin', `<span>Trakt <b>${Math.round((t.rating ?? 0) * 10)}%</b> <small>${num(t.votes)} votes</small></span>`);
    document.getElementById('links').insertAdjacentHTML('afterbegin', `<a href="https://app.trakt.tv/${tt}s/${encodeURIComponent(t.ids.slug)}" target="_blank">Trakt</a>`);
  }
  await rows;
}

async function loadSeason(id, n, progress) {
  const [season, prog] = await Promise.all([tmdb(`/tv/${id}/season/${n}`), progress]);
  const list = document.getElementById('episodes');
  if (!list) return;
  const eps = prog?.seasons?.find(s => s.number === n)?.episodes ?? [];
  const watchedEp = e => eps.some(x => x.number === e && x.completed);
  list.innerHTML = season.episodes.map(e => `<li>
    <a class="still" href="#/play/tv/${id}/${n}/${e.episode_number}" ${e.still_path ? `style="background-image:url('${IMG}w300${esc(e.still_path)}')"` : ''} aria-label="Play episode ${e.episode_number}"><span class="play-icon">${icon('play')}</span></a>
    <div class="episode-body"><a class="episode-link" href="#/play/tv/${id}/${n}/${e.episode_number}">
      <h3>${e.episode_number}. ${esc(e.name)}</h3>
      <p class="muted">${esc(e.air_date ?? 'TBA')}${e.runtime ? ` · ${e.runtime}m` : ''}</p>
      <p>${esc(e.overview)}</p></a>
      ${user ? `<label class="check"><input type="checkbox" data-ep="${e.episode_number}" ${watchedEp(e.episode_number) ? 'checked' : ''}> Watched</label>` : ''}
    </div></li>`).join('');
  list.querySelectorAll('[data-ep]').forEach(box => box.addEventListener('change', async () => {
    box.disabled = true;
    try {
      await write(box.checked ? '/sync/history' : '/sync/history/remove', episodeBody(id, n, box.dataset.ep));
      const ep = eps.find(x => x.number === +box.dataset.ep);
      if (ep) ep.completed = box.checked; // keeps the cached progress right when switching seasons
      refreshProgress().catch(console.warn);
    }
    catch (e) { box.checked = !box.checked; toast(e); }
    box.disabled = false;
  }));
}
