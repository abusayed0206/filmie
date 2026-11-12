// Run: node --test tests/ui.test.js
const test = require('node:test');
const assert = require('node:assert');
const { isActiveDownload, sameDownload, isDownloaded, downloadPct, bytesText, pickCapture, downloadSummary, groupDownloads, nextDownloaded, validProgress, playedNote, historyBody, safeColor, youtubeKey, pickTrailer, newestCredits, isoDate, shortDate, fullDate, addDays, weekStart, sortValue, hasEnded, sortLists, exactFirst, streakFrom, weekHeatmap, durationText, recentMonths, mergeContinue, startWatching, runtimeText, statusTag, navFor, modeOf, FILTERS, decadeOptions, cleanFilters, filterQuery, filterCount, addQuery, fitsSimple, scrollTarget, DEFAULT_SOURCES, QUALITIES, qualityOf, esc, parseSources, formatSources, fillTemplate, buildServer, splitServer, serverAfterRemove, betterServer, MOVIE_STRUCTURES, TV_STRUCTURES, episodeAfter, norm } = require('../ui/lib.js');

test('norm', () => {
  const ids = { trakt: 1, tmdb: 272 };
  assert.deepEqual(norm({ watchers: 5, movie: { title: 'B', year: 2005, ids } }), { type: 'movie', id: 272, title: 'B', year: 2005 });
  assert.deepEqual(norm({ type: 'show', show: { title: 'S', year: 2008, ids } }).type, 'tv');
  assert.deepEqual(norm({ title: 'P', year: 1, ids }, 'show'), { type: 'tv', id: 272, title: 'P', year: 1 });
  assert.equal(norm({ movie: { title: 'x', ids: { trakt: 2 } } }), null); // no TMDB id
  assert.equal(norm({ title: 'x', ids }), null); // bare item without a type
  assert.equal(norm(null, 'movie'), null);
  // /media/popular: bare items with no type
  assert.equal(norm({ title: 'S', ids, aired_episodes: 12 }, 'movie').type, 'tv');
  assert.equal(norm({ title: 'M', ids }, 'movie').type, 'movie');
  // extended=full, on each shape a list can return
  assert.deepEqual(norm({ watchers: 1, movie: { title: 'M', year: 2010, ids, runtime: 148, released: '2010-07-16', rating: 8.4, genres: ['sci-fi'], after_credits: true } }),
    { type: 'movie', id: 272, title: 'M', year: 2010, runtime: 148, released: '2010-07-16', rating: 8.4, genres: ['sci-fi'], postCredits: true });
  assert.deepEqual(norm({ list_count: 2, show: { title: 'S', year: 2008, ids, aired_episodes: 62, first_aired: '2008-01-20T00:00:00.000Z' } }),
    { type: 'tv', id: 272, title: 'S', year: 2008, episodes: 62, released: '2008-01-20T00:00:00.000Z' });
  assert.equal(norm({ movie: { title: 'M', ids, genres: [], after_credits: false } }).genres, undefined);
  assert.equal(norm({ movie: { title: 'M', ids, after_credits: false } }).postCredits, undefined);
  // recommendations, history and calendar items
  assert.equal(norm({ movie: { title: 'M', ids }, score: 1, sources: [] }).type, 'movie');
  assert.equal(norm({ id: 9, watched_at: 't', action: 'watch', type: 'episode', episode: { ids: {} }, show: { title: 'S', ids } }).type, 'tv');
  assert.equal(norm({ first_aired: 't', episode: { ids: {} }, show: { title: 'S', ids } }).title, 'S');
});

test('dates for calendars and cards', () => {
  assert.equal(isoDate(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(shortDate(''), '');
  assert.equal(shortDate('2026-11-03'), 'Nov 3'); // a plain date doesn't shift with the timezone
  assert.match(shortDate('2026-11-03T12:00:00.000Z'), /^Nov [34]$/);
});

test('calendar date arithmetic', () => {
  assert.equal(addDays('2026-11-03', 7), '2026-11-10');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(weekStart('2026-11-03'), '2026-11-02'); // Tuesday
  assert.equal(weekStart('2026-11-02'), '2026-11-02'); // Monday stays
  assert.equal(weekStart('2026-11-08'), '2026-11-02'); // Sunday belongs to the week before it
  assert.equal(fullDate('2026-11-03'), 'Nov 3, 2026');
  assert.equal(fullDate(null), '');
});

test('sortValue shows what the list is sorted by', () => {
  const x = { rank: 4, listed_at: '2026-01-05', movie: { runtime: 148, rating: 8.4, released: '2010-07-16' } };
  assert.equal(sortValue(x, 'added'), 'Jan 5, 2026');
  assert.equal(sortValue(x, 'runtime'), '2h 28m');
  assert.equal(sortValue(x, 'my_rating', 8), '8/10');
  assert.equal(sortValue(x, 'my_rating'), undefined);
  assert.equal(sortValue(x, 'released'), 'Jul 16, 2010');
  assert.equal(sortValue(x, 'rank'), '#4');
  // These keep the rating.
  for (const by of ['', 'title', 'percentage']) assert.equal(sortValue(x, by), undefined);
  assert.equal(sortValue({ show: {} }, 'released'), undefined);
});

test('hasEnded and sortLists', () => {
  assert.ok(hasEnded('ended') && hasEnded('canceled'));
  assert.ok(!hasEnded('returning series') && !hasEnded(undefined));
  const a = { name: 'B', updated_at: '2026-01-01', created_at: '2026-03-01' };
  const b = { name: 'A', updated_at: '2026-02-01', created_at: '2026-01-01' };
  assert.deepEqual(sortLists([a, b], 'rank'), [a, b]);
  assert.deepEqual(sortLists([a, b], 'name'), [b, a]);
  assert.deepEqual(sortLists([a, b], 'updated'), [b, a]);
  assert.deepEqual(sortLists([a, b], 'created'), [a, b]);
});

test('exactFirst moves true title matches up and keeps the rest in order', () => {
  const near = { movie: { title: 'Heat Wave' } };
  const exact = { show: { title: 'HEAT' } };
  const other = { movie: { title: 'Hot' } };
  assert.deepEqual(exactFirst([near, other, exact], 'heat'), [exact, near, other]);
  assert.deepEqual(exactFirst([{ person: {} }], 'x'), [{ person: {} }]);
});

test('streakFrom counts days ending today or yesterday', () => {
  const today = '2026-11-03';
  assert.equal(streakFrom(['2026-11-03', '2026-11-02', '2026-11-01'], today), 3);
  assert.equal(streakFrom(['2026-11-02', '2026-11-01'], today), 2); // today isn't over yet
  assert.equal(streakFrom(['2026-11-01', '2026-10-31'], today), 0); // yesterday was missed
  assert.equal(streakFrom(['2026-11-03', '2026-11-01'], today), 1); // a gap ends it
  assert.equal(streakFrom(['2026-03-01', '2026-02-28'], '2026-03-01'), 2); // across a month
  assert.equal(streakFrom([], today), 0);
});

test('weekHeatmap marks the last seven days, today last', () => {
  assert.deepEqual(weekHeatmap(['2026-11-03', '2026-10-28', '2026-10-27'], '2026-11-03'), [true, false, false, false, false, false, true]); // Oct 27 is too old to show
  assert.deepEqual(weekHeatmap([], '2026-11-03'), Array(7).fill(false));
});

test('durationText and recentMonths', () => {
  assert.equal(durationText(0), '0m');
  assert.equal(durationText(undefined), '0m');
  assert.equal(durationText(45), '45m');
  assert.equal(durationText(125), '2h 5m');
  assert.equal(durationText(1440), '1d');
  assert.equal(durationText(1440 + 125), '1d 2h');
  assert.deepEqual(recentMonths([{ month: '2026-01', plays: 4 }, { month: '2025-12', plays: 2 }, { month: '2020-01', plays: 9 }], '2026-02-10', 3),
    [{ month: '2025-12', plays: 2 }, { month: '2026-01', plays: 4 }, { month: '2026-02', plays: 0 }]);
});

test('youtubeKey only takes YouTube video addresses', () => {
  for (const u of ['https://www.youtube.com/watch?v=abc-_1', 'https://youtube.com/watch?v=abc-_1&t=4', 'https://m.youtube.com/watch?list=x&v=abc-_1', 'https://youtu.be/abc-_1', 'https://www.youtube.com/embed/abc-_1?rel=0']) assert.equal(youtubeKey(u), 'abc-_1', u);
  for (const u of ['http://www.youtube.com/watch?v=abc', 'https://evil.test/watch?v=abc', 'https://youtube.com.evil.test/watch?v=abc', 'https://www.youtube.com/watch?v=a"b', 'https://www.youtube.com/channel/abc', '', null, undefined]) assert.equal(youtubeKey(u), null, u);
});

test('pickTrailer prefers an official trailer', () => {
  const v = (key, type, official, site = 'YouTube') => ({ key, type, official, site });
  assert.equal(pickTrailer([v('c', 'Clip', true), v('t', 'Teaser', true), v('u', 'Trailer', false), v('o', 'Trailer', true)]).key, 'o');
  assert.equal(pickTrailer([v('t', 'Teaser', false), v('u', 'Trailer', false)]).key, 'u');
  assert.equal(pickTrailer([v('t', 'Teaser', true)]).key, 't');
  assert.equal(pickTrailer([v('c', 'Clip', true), v('f', 'Featurette', true)]), null);
  assert.equal(pickTrailer([v('v', 'Trailer', true, 'Vimeo'), v('a"b', 'Trailer', true)]), null);
  assert.equal(pickTrailer(undefined), null);
});

test('mergeContinue puts the most recent first', () => {
  const show = { show: {}, progress: { last_watched_at: '2026-01-02T00:00:00Z' } };
  const movie = { movie: {}, paused_at: '2026-01-03T00:00:00Z' };
  const older = { show: {}, progress: { last_watched_at: '2025-12-01T00:00:00Z' } };
  assert.deepEqual(mergeContinue([older, show], [movie]), [movie, show, older]);
  assert.deepEqual(mergeContinue([], []), []);
});

test('startWatching hides what is unreleased or already started', () => {
  const out = { movie: { released: '2020-01-01', ids: { tmdb: 1 } } };
  const soon = { movie: { released: '2099-01-01', ids: { tmdb: 2 } } };
  const noDate = { movie: { ids: { tmdb: 3 } } };
  const newShow = { show: { first_aired: '2020-01-01T00:00:00.000Z', ids: { tmdb: 4 } } };
  const started = { show: { first_aired: '2020-01-01T00:00:00.000Z', ids: { tmdb: 5 } } };
  assert.deepEqual(startWatching([out, soon, noDate, newShow, started], '2026-11-03', new Set([5])), [out, newShow]);
});

test('historyBody says what was watched and when', () => {
  assert.deepEqual(historyBody({ type: 'movie', id: 1 }), { movies: [{ ids: { tmdb: 1 } }] });
  assert.deepEqual(historyBody({ type: 'movie', id: 1 }, 'released'), { movies: [{ ids: { tmdb: 1 }, watched_at: 'released' }] });
  assert.deepEqual(historyBody({ type: 'tv', id: 2 }), { shows: [{ ids: { tmdb: 2 } }] });
  assert.deepEqual(historyBody({ type: 'tv', id: 2, season: 0, episode: 3 }, '2026-01-01T00:00:00.000Z'),
    { shows: [{ ids: { tmdb: 2 }, seasons: [{ number: 0, episodes: [{ number: 3, watched_at: '2026-01-01T00:00:00.000Z' }] }] }] });
});

test('values from Trakt are checked before they reach a page', () => {
  assert.equal(safeColor('#a1B2c3'), '#a1B2c3');
  for (const bad of ['red', '#12', 'url(x)', '#000000;x', null, undefined]) assert.equal(safeColor(bad), null);
});

test('newestCredits sorts and removes repeats', () => {
  const m = (id, year) => ({ movie: { year, ids: { tmdb: id } } });
  assert.deepEqual(newestCredits([m(1, 2000), m(2, 2020), m(1, 2000), { movie: { year: 2030, ids: {} } }, m(3)]).map(x => x.movie.ids.tmdb), [2, 1, 3]);
  assert.deepEqual(newestCredits(undefined), []);
});

test('runtimeText', () => {
  assert.equal(runtimeText(148), '2h 28m');
  assert.equal(runtimeText(45), '45m');
  assert.equal(runtimeText(120), '2h');
  assert.equal(runtimeText(0), '');
  assert.equal(runtimeText(undefined), '');
});

test('statusTag shows only the most important status', () => {
  assert.equal(statusTag({}), '');
  assert.equal(statusTag({ watchlisted: true }), 'Watchlist');
  assert.equal(statusTag({ postCredits: true, watchlisted: true }), 'Post-credits');
  assert.equal(statusTag({ started: true, watchlisted: true }), 'Started');
  assert.equal(statusTag({ watched: true, started: true, watchlisted: true }), 'Watched');
  assert.equal(statusTag({ dropped: true, watched: true }), 'Dropped');
  assert.equal(statusTag({ watched: false, watchlisted: false }), '');
});

const show = {
  seasons: [{ season_number: 0, episode_count: 3 }, { season_number: 1, episode_count: 2 }, { season_number: 2, episode_count: 2 }],
  last_episode_to_air: { season_number: 2, episode_number: 1 },
};

test('esc', () => assert.equal(esc(`<a href="x">'&`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;'));

const source = (extra = '') => `Home | https://h/m/{tmdb_id} | https://h/t/{tmdb_id}/{season}/{episode}${extra}`;

test('parseSources', () => {
  assert.deepEqual(parseSources(` ${source()} \n\n`),
    [{ name: 'Home', movie: 'https://h/m/{tmdb_id}', tv: 'https://h/t/{tmdb_id}/{season}/{episode}' }]);
  assert.throws(() => parseSources('X | http://h/{tmdb_id} | https://h/{tmdb_id}'), /Bad source/);
  assert.throws(() => parseSources('X | https://h/m | https://h/{tmdb_id}'), /Bad source/);
  assert.throws(() => parseSources('X | https://h/{tmdb_id}'), /Bad source/);
  assert.throws(() => parseSources('X | javascript:alert(1) | https://h/{tmdb_id}'), /Bad source/);
});

test('per-server note and accent', () => {
  const base = { name: 'Home', movie: 'https://h/m/{tmdb_id}', tv: 'https://h/t/{tmdb_id}/{season}/{episode}' };
  assert.deepEqual(parseSources(source(' | 4K, faster | #12AB34')), [{ ...base, note: '4K, faster', accent: '#12ab34' }]);
  assert.deepEqual(parseSources(source(' | #123456')), [{ ...base, accent: '#123456' }]);
  assert.deepEqual(parseSources(source(' | Only a note')), [{ ...base, note: 'Only a note' }]);
  assert.throws(() => parseSources(source(' | note | red')), /Bad accent/);
  assert.throws(() => parseSources(source(' | note | #12345')), /Bad accent/);
  assert.throws(() => parseSources(source(' | note | #123456 | extra')), /Bad source/);
});

test('formatSources round-trips note and accent', () => {
  const list = [
    { name: 'A', movie: 'https://a/{tmdb_id}', tv: 'https://a/{tmdb_id}', note: 'Best picture', accent: '#123456' },
    { name: 'B', movie: 'https://b/{tmdb_id}', tv: 'https://b/{tmdb_id}', accent: '#abcdef' },
    { name: 'C', movie: 'https://c/{tmdb_id}', tv: 'https://c/{tmdb_id}', note: 'No accent' },
    { name: 'D', movie: 'https://d/{tmdb_id}', tv: 'https://d/{tmdb_id}' },
  ];
  assert.deepEqual(parseSources(formatSources(list)), list);
});

test('fillTemplate', () => {
  assert.equal(fillTemplate('https://h/tv/{tmdb_id}/{season}/{episode}', { tmdb_id: 1396, season: 1, episode: 2 }), 'https://h/tv/1396/1/2');
  assert.equal(fillTemplate('https://h/{tmdb_id}', { tmdb_id: 'a/b?c' }), 'https://h/a%2Fb%3Fc');
});

const form = (extra = {}) => ({ link: 'https://www.h.test', movie: '/movie/{tmdb_id}', tv: '/tv/{tmdb_id}/{season}/{episode}', ...extra });

test('buildServer needs only the link and the structures', () => {
  assert.deepEqual(buildServer(form()), { name: 'h.test', movie: 'https://www.h.test/movie/{tmdb_id}', tv: 'https://www.h.test/tv/{tmdb_id}/{season}/{episode}' });
  assert.deepEqual(buildServer(form({ link: ' https://h.test/api/ ', movie: 'm/{tmdb_id}', tv: '?id={tmdb_id}&s={season}&e={episode}', name: ' Home ', note: ' 4K ', accent: '#12AB34' })),
    { name: 'Home', movie: 'https://h.test/api/m/{tmdb_id}', tv: 'https://h.test/api?id={tmdb_id}&s={season}&e={episode}', note: '4K', accent: '#12ab34' });
});

test('buildServer rejects bad input with a helpful message', () => {
  for (const link of ['', 'h.test', 'not a url']) assert.throws(() => buildServer(form({ link })), /Enter the server link/);
  assert.throws(() => buildServer(form({ link: 'http://h.test' })), /must start with https/);
  for (const link of ['https://h.test/movie/{tmdb_id}', 'https://h.test?a=1', 'https://h.test#x']) assert.throws(() => buildServer(form({ link })), /only the address/);
  assert.throws(() => buildServer(form({ movie: '' })), /movie structure is required/);
  assert.throws(() => buildServer(form({ tv: '/tv/{tmdb_id}/{season}' })), /needs \{episode\}/);
  assert.throws(() => buildServer(form({ movie: '/movie/{id}' })), /can't use \{id\}/);
  assert.throws(() => buildServer(form({ movie: '/movie/{tmdb_id}/{season}' })), /can't use \{season\}/);
  assert.throws(() => buildServer(form({ movie: 'javascript:alert({tmdb_id})' })), /path or an https/);
  assert.throws(() => buildServer(form({ movie: 'http://h.test/{tmdb_id}' })), /path or an https/);
  assert.throws(() => buildServer(form({ movie: '/a b/{tmdb_id}' })), /spaces or \|/);
  assert.throws(() => buildServer(form({ name: 'a|b' })), /can't contain \|/);
  assert.throws(() => buildServer(form({ accent: 'red' })), /hex colour/);
});

test('saved servers survive the text format and the edit form', () => {
  const server = buildServer(form({ name: 'Home', note: 'Fast', accent: '#123456' }));
  assert.deepEqual(parseSources(formatSources([server])), [server]);
  assert.deepEqual(buildServer({ ...splitServer(server), name: server.name, note: server.note, accent: server.accent }), server);
  assert.deepEqual(splitServer(server), { link: 'https://www.h.test', movie: '/movie/{tmdb_id}', tv: '/tv/{tmdb_id}/{season}/{episode}' });
  const twoHosts = { movie: 'https://a.test/{tmdb_id}', tv: 'https://a.test.evil/{tmdb_id}/{season}/{episode}' };
  assert.deepEqual(splitServer(twoHosts), { link: 'https://a.test', movie: '/{tmdb_id}', tv: twoHosts.tv });
  assert.equal(buildServer({ ...splitServer(twoHosts) }).tv, twoHosts.tv);
});

test('every suggested structure is valid and names no host', () => {
  for (const movie of MOVIE_STRUCTURES) assert.ok(buildServer(form({ movie })).movie.startsWith('https://www.h.test'));
  for (const tv of TV_STRUCTURES) assert.ok(buildServer(form({ tv })).tv.startsWith('https://www.h.test'));
});

test('the default server follows the list when one is removed', () => {
  assert.equal(serverAfterRemove(2, 0), 1);
  assert.equal(serverAfterRemove(0, 2), 0);
  assert.equal(serverAfterRemove(2, 2), 0);
});

test('validProgress trusts only sensible reports from player frames', () => {
  assert.deepEqual(validProgress({ t: 600, d: 2400 }, 47), { t: 600, d: 2400 });
  assert.deepEqual(validProgress({ t: 0, d: 300 }), { t: 0, d: 300 });
  assert.equal(validProgress({ t: 10, d: 30 }), null); // shorter than a minute
  assert.equal(validProgress({ t: 10, d: 600 }, 47), null); // 10 minutes in a 47-minute title: an ad
  assert.equal(validProgress({ t: 900, d: 600 }), null);
  assert.equal(validProgress({ t: -1, d: 600 }), null);
  for (const bad of [null, undefined, 'x', {}, { t: '1', d: '600' }, { t: NaN, d: 600 }, { t: 1, d: Infinity }]) assert.equal(validProgress(bad), null);
});

test('navFor picks the rail items for a route', () => {
  assert.deepEqual(navFor(''), ['']);
  assert.deepEqual(navFor('discover'), ['discover']);
  assert.deepEqual(navFor('discover', 'trending'), ['discover/trending', 'discover']);
  assert.deepEqual(navFor('discover', 'recommended'), ['discover/recommended', '']);
  assert.deepEqual(navFor('progress'), ['progress', '']);
  assert.deepEqual(navFor('list'), ['lists']);
  assert.deepEqual(navFor('lists', 'liked'), ['lists/liked', 'lists']);
  assert.deepEqual(navFor('watchlist'), ['watchlist', 'lists']);
  assert.deepEqual(navFor('history'), ['history']);
  for (const page of ['title', 'play', 'shows', 'movies', 'nope', 'constructor']) assert.deepEqual(navFor(page), []);
});

test('modeOf falls back to Media', () => {
  for (const m of ['media', 'show', 'movie']) assert.equal(modeOf(m), m);
  for (const m of [null, undefined, 'tv', 'constructor']) assert.equal(modeOf(m), 'media');
});

test('cleanFilters keeps only known, well-formed filters', () => {
  assert.deepEqual(cleanFilters({ genres: 'action,-drama', nope: 'x', years: '1990-1999', runtimes: 5, ignore_watched: 'maybe', statuses: 'in production' }),
    { genres: 'action,-drama', years: '1990-1999', statuses: 'in production' });
  for (const bad of [null, undefined, 'x', 3, []]) assert.deepEqual(cleanFilters(bad), {});
  assert.deepEqual(cleanFilters({ genres: '"><script>' }), {});
  // A slider at full range means no filter.
  assert.deepEqual(cleanFilters({ ratings: '0-100', years: '1930-2030', runtimes: '0-500', parental_nudity: '0-3' }), {});
  assert.deepEqual(cleanFilters({ ratings: '50-100', parental_nudity: '0-1' }), { ratings: '50-100', parental_nudity: '0-1' });
});

test('filterQuery builds the query the API takes', () => {
  assert.equal(filterQuery({}), '');
  assert.equal(filterQuery({ genres: 'action,-drama', years: '2020-2029' }), 'genres=action,-drama&years=2020-2029');
  assert.equal(filterQuery({ statuses: 'returning series,continuing' }), 'statuses=returning%20series,continuing');
  assert.equal(filterQuery({ ignore_watched: 'true', bad: '1' }), 'ignore_watched=true');
  assert.equal(addQuery('/movies/trending', 'a=1'), '/movies/trending?a=1');
  assert.equal(addQuery('/movies/trending?limit=30', 'a=1'), '/movies/trending?limit=30&a=1');
  assert.equal(addQuery('/movies/trending', ''), '/movies/trending');
});

test('filterCount counts what the person set', () => {
  assert.equal(filterCount({}), 0);
  assert.equal(filterCount({ genres: 'action', years: '2020-2029' }), 2);
  assert.equal(filterCount({ ratings: '50-100', imdb_ratings: '5-10', rt_meters: '50-100', rt_user_meters: '50-100' }), 1, "Advanced's rating slider sets four params");
  assert.equal(filterCount({ ratings: '0-100' }), 0);
});

test('fitsSimple spots filters only Advanced can show', () => {
  assert.equal(fitsSimple({ genres: 'action', certifications: 'pg,tv-pg', years: '1990-1999', ratings: '50-100', ignore_watched: 'true' }), true);
  assert.equal(fitsSimple({ genres: 'action,drama' }), false);
  assert.equal(fitsSimple({ genres: '-drama' }), false);
  assert.equal(fitsSimple({ certifications: 'pg' }), false);
  assert.equal(fitsSimple({ years: '1955-1972' }), false);
  assert.equal(fitsSimple({ parental_violence: '0-1' }), false);
  assert.equal(fitsSimple({ imdb_ratings: '5-10' }), false);
});

test('filter definitions are complete', () => {
  assert.deepEqual(decadeOptions(2026).slice(0, 3), [{ label: 'This year', value: '2026' }, { label: '2020s', value: '2020-2029' }, { label: '2010s', value: '2010-2019' }]);
  assert.equal(decadeOptions(2026).at(-1).value, '1960-1969');
  for (const f of FILTERS) {
    assert.ok(f.alias || f.label, f.key);
    for (const o of f.options ?? []) assert.deepEqual(cleanFilters({ [f.key]: o.value }), { [f.key]: o.value }, `${f.key} option ${o.label}`);
  }
  assert.ok(!FILTERS.some(f => f.key === 'status'), 'the API only honours statuses');
});

test('scrollTarget restores only on back and forward', () => {
  assert.equal(scrollTarget('traverse', 640), 640);
  assert.equal(scrollTarget('traverse', undefined), 0);
  assert.equal(scrollTarget('push', 640), 0);
  assert.equal(scrollTarget('replace', 640), 0);
});

test('playedNote', () => {
  const now = 1_000_000;
  assert.equal(playedNote({ position: 600, duration: 2400 }, now), '30 min left');
  assert.equal(playedNote({ position: 2395, duration: 2400 }, now), 'Finished');
  assert.equal(playedNote({ position: 0, duration: 0, updated_at: now }, now), 'Opened just now');
  assert.equal(playedNote({ position: 0, duration: 0, updated_at: now - 300 }, now), 'Opened 5 min ago');
  assert.equal(playedNote({ position: 0, duration: 0, updated_at: now - 7200 }, now), 'Opened 2 h ago');
  assert.equal(playedNote({ position: 0, duration: 0, updated_at: now - 172800 }, now), 'Opened 2 d ago');
});

// The README, TERMS.md and the website all state this, so a bundled server fails CI.
test('Filmie ships with no video servers', () => assert.deepEqual(DEFAULT_SOURCES, []));

test('preferred quality is 1080p unless chosen', () => {
  assert.deepEqual(QUALITIES, ['auto', '1080p', '720p', '480p']);
  assert.equal(qualityOf('1080p'), '1080p');
  assert.equal(qualityOf('auto'), 'auto');
  assert.equal(qualityOf('4k'), '1080p');
  assert.equal(qualityOf(null), '1080p');
  assert.equal(qualityOf(undefined), '1080p');
});

test('episodeAfter', () => {
  assert.deepEqual(episodeAfter(show, 1, 1), [1, 2]);
  assert.deepEqual(episodeAfter(show, 1, 2), [2, 1]);
  assert.equal(episodeAfter(show, 2, 2), null);
});

// lib.js alone passing says nothing about the page scripts: one bad line there leaves the app blank.
test('every script parses, loads from index.html, and its icons are in the sprite', () => {
  const read = f => require('node:fs').readFileSync(require('node:path').join(__dirname, '../ui', f), 'utf8');
  const html = read('index.html');
  const scripts = require('node:fs').readdirSync(require('node:path').join(__dirname, '../ui')).filter(f => f.endsWith('.js'));
  for (const file of scripts) {
    const js = read(file);
    new (require('node:vm').Script)(js, { filename: file });
    assert.ok(html.includes(`src="${file}"`), `${file} is not loaded`);
    for (const [, name] of js.matchAll(/icon\('([\w-]+)'\)/g)) assert.ok(html.includes(`id="i-${name}"`), `missing icon ${name} in ${file}`);
  }
});

test('betterServer switches only to a taller video', () => {
  assert.equal(betterServer([720, 1080, 0], 0), 1);
  assert.equal(betterServer([1080, 1080, 720], 1), null); // a tie keeps the current one
  assert.equal(betterServer([0, 720, 720], 0), 1); // the current one never showed a video
  assert.equal(betterServer([0, 0, 0], 2), null);
  assert.equal(betterServer([1080, undefined], 0), null);
});

const dl = (over) => ({ id: 1, kind: 'movie', tmdb_id: 7, season: 0, episode: 0, title: 'M', status: 'done', done_bytes: 0, total_bytes: 0, ...over });

test('pickCapture prefers a playlist and never a protected file', () => {
  const master = { url: 'https://c.example/master.m3u8', kind: 'hls' };
  const variant = { url: 'https://c.example/720.m3u8', kind: 'hls' };
  const file = { url: 'https://c.example/film.mp4', kind: 'file' };
  assert.deepEqual(pickCapture([file, master, variant]), master); // the first playlist seen, which is the master
  assert.deepEqual(pickCapture([{ url: 'https://c.example/a.mpd', kind: 'dash' }, file]).kind, 'dash');
  assert.deepEqual(pickCapture([file]), file);
  assert.deepEqual(pickCapture([file, { drm: true }]), { protected: true });
  assert.deepEqual(pickCapture([{ drm: true }]), { protected: true });
  assert.deepEqual(pickCapture([master, { drm: true }]), master, 'Rust checks a playlist for encryption itself');
  assert.equal(pickCapture([]), null);
  assert.equal(pickCapture([{ url: 'blob:https://c.example/1', kind: 'file' }, { url: 'javascript:x', kind: 'hls' }, { url: 'https://c.example/x', kind: 'other' }]), null);
});

test('download state for cards, the rail and the Downloads page', () => {
  const list = [
    dl({ id: 1 }),
    dl({ id: 2, kind: 'tv', tmdb_id: 9, title: 'S', season: 1, episode: 2 }),
    dl({ id: 3, kind: 'tv', tmdb_id: 9, title: 'S', season: 1, episode: 1 }),
    dl({ id: 4, kind: 'tv', tmdb_id: 9, title: 'S', season: 2, episode: 1, status: 'downloading', done_bytes: 25, total_bytes: 100 }),
    dl({ id: 5, tmdb_id: 8, title: 'A', status: 'queued' }),
    dl({ id: 6, tmdb_id: 6, title: 'P', status: 'protected', error: 'encrypted' }),
  ];
  assert.ok(isDownloaded(list, 'movie', 7));
  assert.ok(isDownloaded(list, 'tv', 9), 'a show with any episode saved');
  assert.ok(!isDownloaded(list, 'movie', 8), 'still queued');
  assert.ok(!isDownloaded(list, 'tv', 7), 'a movie id is not a show id');
  assert.ok(sameDownload(list[1], 'tv', 9, 1, 2) && !sameDownload(list[1], 'tv', 9, 1, 3));
  assert.ok(isActiveDownload(list[3]) && isActiveDownload(list[4]) && !isActiveDownload(list[5]));
  assert.deepEqual(downloadSummary(list), { count: 2, pct: 25 });
  assert.deepEqual(downloadSummary([]), { count: 0, pct: 0 });
  assert.equal(downloadPct(list[3]), 25);
  assert.equal(downloadPct(list[4]), null, 'size not known yet');
  assert.equal(downloadPct(list[0]), 100);
  const g = groupDownloads(list);
  assert.deepEqual(g.active.map(d => d.id), [4, 5]);
  assert.deepEqual(g.movies.map(d => d.id), [1]);
  assert.deepEqual(g.shows.map(s => [s.title, s.episodes.map(d => d.id)]), [['S', [3, 2]]], 'episodes in order');
  assert.deepEqual(g.problems.map(d => d.id), [6]);
  assert.equal(nextDownloaded(list, 9, 1, 1).id, 2);
  assert.equal(nextDownloaded(list, 9, 1, 2), null, 'S2E1 is not finished');
  assert.equal(bytesText(1.5e9), '1.5 GB');
  assert.equal(bytesText(250e6), '250 MB');
  assert.equal(bytesText(1), '1 MB');
});

test('Downloads has its rail item', () => {
  assert.deepEqual(navFor('downloads'), ['downloads']);
  assert.deepEqual(navFor('offline', '3'), []);
});
