// Run: node --test tests/ui.test.js
const test = require('node:test');
const assert = require('node:assert');
const { validProgress, playedNote, DEFAULT_SOURCES, QUALITIES, qualityOf, esc, parseSources, formatSources, fillTemplate, episodeAfter, norm } = require('../ui/lib.js');

test('norm', () => {
  const ids = { trakt: 1, tmdb: 272 };
  assert.deepEqual(norm({ watchers: 5, movie: { title: 'B', year: 2005, ids } }), { type: 'movie', id: 272, title: 'B', year: 2005 });
  assert.deepEqual(norm({ type: 'show', show: { title: 'S', year: 2008, ids } }).type, 'tv');
  assert.deepEqual(norm({ title: 'P', year: 1, ids }, 'show'), { type: 'tv', id: 272, title: 'P', year: 1 });
  assert.equal(norm({ movie: { title: 'x', ids: { trakt: 2 } } }), null); // no TMDB id
  assert.equal(norm({ title: 'x', ids }), null); // bare item without a type
  assert.equal(norm(null, 'movie'), null);
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

test('validProgress trusts only sensible reports from player frames', () => {
  assert.deepEqual(validProgress({ t: 600, d: 2400 }, 47), { t: 600, d: 2400 });
  assert.deepEqual(validProgress({ t: 0, d: 300 }), { t: 0, d: 300 });
  assert.equal(validProgress({ t: 10, d: 30 }), null); // shorter than a minute
  assert.equal(validProgress({ t: 10, d: 600 }, 47), null); // 10 minutes in a 47-minute title: an ad
  assert.equal(validProgress({ t: 900, d: 600 }), null);
  assert.equal(validProgress({ t: -1, d: 600 }), null);
  for (const bad of [null, undefined, 'x', {}, { t: '1', d: '600' }, { t: NaN, d: 600 }, { t: 1, d: Infinity }]) assert.equal(validProgress(bad), null);
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

test('no video servers are bundled', () => assert.deepEqual(DEFAULT_SOURCES, []));

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

// lib.js alone passing says nothing about app.js: one bad line there leaves the app blank.
test('app.js parses and every icon it uses is in the sprite', () => {
  const read = f => require('node:fs').readFileSync(require('node:path').join(__dirname, '../ui', f), 'utf8');
  const js = read('app.js');
  new (require('node:vm').Script)(js);
  const html = read('index.html');
  for (const [, name] of js.matchAll(/icon\('([\w-]+)'\)/g)) assert.ok(html.includes(`id="i-${name}"`), `missing icon ${name}`);
});
