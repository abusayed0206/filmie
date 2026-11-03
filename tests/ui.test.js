// Run: node --test tests/ui.test.js
const test = require('node:test');
const assert = require('node:assert');
const { validProgress, playedNote, navFor, modeOf, FILTERS, decadeOptions, cleanFilters, filterQuery, filterCount, addQuery, fitsSimple, scrollTarget, DEFAULT_SOURCES, QUALITIES, qualityOf, esc, parseSources, formatSources, fillTemplate, buildServer, splitServer, serverAfterRemove, MOVIE_STRUCTURES, TV_STRUCTURES, episodeAfter, norm } = require('../ui/lib.js');

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
