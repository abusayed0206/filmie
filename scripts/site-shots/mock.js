// Mock of Filmie's Tauri commands with invented titles, for website screenshots only.
(() => {
  const SHOWS = ['The Long Road', 'Harbour Lights', 'Northbound', 'Glass Orchard', 'Signal Hill', 'Low Tide', 'The Quiet Office', 'Ember County', 'Paper Moons', 'Second Shift', 'Wildwater', 'Static Bloom', 'Night Ferry', 'Copper Valley', 'The Understudy'];
  const MOVIES = ['Midnight Atlas', 'Lanterns', 'The Last Orbit', 'Saltwater Kings', 'Velvet Static', 'Echo Park Run', 'Iron Meadow', 'A Small Fire', 'Polar Drift', 'The Cartographer', 'Neon Harvest', 'Golden Hour', 'Undertow', 'Kites Over Lisbon', 'Blue Pavilion'];
  const GENRES = [['drama', 'mystery'], ['thriller', 'crime'], ['comedy'], ['science-fiction', 'adventure'], ['drama', 'romance'], ['action', 'thriller'], ['animation', 'family'], ['documentary']];
  const show = (title, i) => ({ title, year: 2019 + (i % 7), ids: { tmdb: 1000 + i, trakt: 5000 + i, slug: title.toLowerCase().replace(/\W+/g, '-') }, aired_episodes: 8 + (i * 5) % 30, runtime: 45 + i % 15, genres: GENRES[i % 8], rating: 7.1 + (i % 9) / 5, first_aired: `202${i % 6}-0${1 + i % 9}-1${i % 9}T00:00:00Z`, overview: 'An invented series used to show Filmie.', status: i % 3 ? 'returning series' : 'ended', network: 'Northlight', country: 'gb', language: 'en' });
  const movie = (title, i) => ({ title, year: 2016 + (i % 10), ids: { tmdb: 2000 + i, trakt: 7000 + i, slug: title.toLowerCase().replace(/\W+/g, '-') }, runtime: 94 + (i * 7) % 60, genres: GENRES[(i + 3) % 8], rating: 6.8 + (i % 11) / 5, released: `202${i % 6}-0${1 + i % 9}-2${i % 8}`, overview: 'An invented film used to show Filmie.', status: 'released', certification: 'PG-13', country: 'us', language: 'en' });
  const shows = SHOWS.map(show);
  const movies = MOVIES.map(movie);
  const byTmdb = new Map([...shows.map(s => [s.ids.tmdb, ['show', s]]), ...movies.map(m => [m.ids.tmdb, ['movie', m]])]);
  window.__mockTitles = byTmdb;

  const today = new Date();
  const day = n => new Date(today.getTime() + n * 864e5).toISOString();
  const mixed = (n, off = 0) => Array.from({ length: n }, (_, i) => i % 2 ? { type: 'show', show: shows[(i + off) % shows.length] } : { type: 'movie', movie: movies[(i + off) % movies.length] });
  const ofType = (t, n, off = 0) => Array.from({ length: n }, (_, i) => t === 'show' ? { show: shows[(i + off) % shows.length] } : { movie: movies[(i + off) % movies.length] });
  const chart = (path, n, off) => {
    const extra = (x, i) => ({ ...x, watchers: 4200 - i * 233, list_count: 9800 - i * 410, watcher_count: 3000 - i * 120, play_count: 51000 - i * 2100 });
    if (path.startsWith('/media')) return mixed(n, off).map(extra);
    if (path.startsWith('/shows')) return ofType('show', n, off).map(extra);
    return ofType('movie', n, off).map(extra);
  };

  const user = { user: { username: 'filmie', name: 'Sam Rivers', vip: false, images: { avatar: { full: '' } } }, limits: { watchlist: { item_count: 100 }, list: { count: 2, item_count: 100 } } };
  const lib = {
    activities: { all: 'x' },
    watched_movies: movies.slice(9, 12).map(m => ({ movie: m })),
    watched_shows: shows.slice(4, 8).map(s => ({ show: s })),
    watchlist_movies: movies.slice(4, 8).map(m => ({ movie: m })),
    watchlist_shows: shows.slice(8, 11).map(s => ({ show: s })),
  };
  const progress = shows.slice(0, 6).map((s, i) => ({ show: s, progress: { aired: 20, completed: 4 + i * 3, next_episode: { season: 2, number: 3 + i, title: ['Harbour Lights', 'The Crossing', 'Tin Roof', 'Daybreak', 'Far Signal', 'Old Friends'][i] } } }));

  const months = Array.from({ length: 24 }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth() - 23 + i, 1);
    return { month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, plays: Math.round(30 + 25 * Math.sin(i / 2.3) + i * 2.2 + (i % 3) * 6) };
  });
  const stats = {
    synced: 4280, total: 4280, complete: true, movies: 312, shows: 86, episodes: 3968, minutes: 211840,
    top_genres: [['drama', 1240], ['comedy', 860], ['thriller', 610], ['science-fiction', 540], ['crime', 470], ['mystery', 390], ['animation', 250], ['documentary', 180]].map(([genre, plays]) => ({ genre, plays })),
    ratings: [[5, 4], [6, 11], [7, 38], [8, 64], [9, 41], [10, 17]].map(([rating, count]) => ({ rating, count })),
    by_month: months, days: Array.from({ length: 12 }, (_, i) => day(-i).slice(0, 10)),
  };

  const tmdbDetail = id => {
    const [t, m] = byTmdb.get(+id) ?? ['movie', movies[0]];
    const cast = ['Ana Lowe', 'Theo Marsh', 'Iris Kane', 'Ben Okafor', 'Maya Lund', 'Jon Pell', 'Rosa Vidal', 'Kit Hale', 'Lena Shaw', 'Omar Reyes'].map((name, i) => ({ id: 9000 + i, name, character: ['Nora', 'Eli', 'June', 'Marcus', 'Tess', 'Abe', 'Clara', 'Finn', 'Ruth', 'Sal'][i], profile_path: `/person-${i}.svg` }));
    const base = { id: +id, overview: t === 'show'
      ? 'When a lighthouse keeper finds a ship\'s log that should not exist, a quiet coastal town begins to remember a winter it agreed to forget. Each season follows a different family as the tide brings something new back to shore.'
      : 'A mapmaker hired to chart a city that keeps changing overnight starts to suspect the streets are rearranging themselves around her. Her only guide is a stranger who seems to know the next turn before it appears.',
      poster_path: `/poster-${id}.svg`, backdrop_path: `/backdrop-${id}.svg`, genres: m.genres.map(g => ({ name: g })), credits: { cast, crew: [{ id: 9100, name: 'Hana Cole', job: 'Director' }] }, external_ids: {}, videos: { results: [] }, tagline: t === 'show' ? 'Every tide brings something back.' : 'The city has other plans.' };
    if (t === 'movie') return { ...base, title: m.title, release_date: m.released, runtime: m.runtime };
    return { ...base, name: m.title, first_air_date: m.first_aired.slice(0, 10), number_of_episodes: 24, created_by: [{ id: 9101, name: 'Ruth Adair' }],
      seasons: [1, 2, 3].map(n => ({ season_number: n, name: `Season ${n}`, episode_count: 8, poster_path: `/poster-${id}-s${n}.svg`, air_date: `202${n}-03-01` })) };
  };
  const EP_NAMES = ['First Light', 'Northbound', 'Harbour Lights', 'The Crossing', 'Tin Roof', 'Daybreak', 'Far Signal', 'Old Friends'];
  const season = (id, s) => ({ episodes: EP_NAMES.map((name, i) => ({ episode_number: i + 1, season_number: +s, name, runtime: 44 + i % 9, air_date: `2024-0${1 + i % 9}-1${i}`, still_path: `/backdrop-${id}-e${i}.svg`, overview: 'An invented episode.' })) });

  function traktGet(path) {
    const p = path.split('?')[0];
    if (p === '/sync/progress/watched') return progress;
    if (p === '/sync/progress/up_next_nitro') return progress;
    if (p === '/sync/playback/movies') return [{ movie: movies[2], progress: 46 }];
    if (p.startsWith('/sync/watchlist')) return [...ofType('movie', 4, 4), ...ofType('show', 3, 8)].map(x => ({ ...x, listed_at: day(-3) }));
    if (p.startsWith('/calendars/')) return Array.from({ length: 14 }, (_, i) => i % 3 === 2 ? { released: day(i).slice(0, 10), movie: movies[(i + 5) % 15] } : { first_aired: day(i), show: shows[(i + 2) % 15], episode: { season: 1 + i % 3, number: 1 + i % 8, title: EP_NAMES[i % 8] } });
    if (p.startsWith('/sync/history')) return Array.from({ length: 10 }, (_, i) => i % 3 === 1 ? { id: i, watched_at: day(-i), movie: movies[(i + 9) % 15] } : { id: i, watched_at: day(-i), show: shows[i % 15], episode: { season: 1, number: 1 + i % 8, title: EP_NAMES[i % 8] } });
    if (/^\/(media|shows|movies)\/(trending|popular|anticipated|watched|played|collected|favorited|boxoffice)/.test(p)) return chart(p, 20, p.length % 7);
    if (/recommendations/.test(p)) return p.includes('/media') ? mixed(20, 3) : ofType(p.includes('shows') ? 'show' : 'movie', 20, 3);
    if (p.startsWith('/search/tmdb/')) { const [t, m] = byTmdb.get(+p.split('/')[3]) ?? []; return m ? [{ type: t, [t]: m }] : []; }
    if (/^\/(shows|movies)\/\d+$/.test(p)) { const m = [...shows, ...movies].find(x => x.ids.trakt === +p.split('/')[2]); return { ...m, colors: { poster: ['#7a2d3a'] }, tagline: null, overview: null }; }
    if (p.endsWith('/sentiments')) return { good: [{ sentiment: 'Patient, rewarding mystery' }, { sentiment: 'Strong ensemble cast' }, { sentiment: 'Beautiful coastal photography' }], bad: [{ sentiment: 'Slow middle episodes' }] };
    if (p.endsWith('/related')) return ofType(p.startsWith('/shows') ? 'show' : 'movie', 12, 5);
    if (p.includes('/comments')) return [{ user: { username: 'quietviewer' }, created_at: day(-2), comment: 'The way each episode loops back to the first scene is so satisfying.', likes: 41, replies: 3 }, { user: { username: 'tidewatch' }, created_at: day(-6), comment: 'Took a few episodes to click, then I could not stop.', likes: 18, replies: 1 }];
    if (p.includes('/lists')) return [{ name: 'Rainy weekend', item_count: 24, ids: { trakt: 1 }, user: { username: 'filmie' }, description: 'Slow, cosy and a bit strange.' }, { name: 'Best of the decade', item_count: 50, ids: { trakt: 2 }, user: { username: 'filmie' } }];
    if (p.startsWith('/search/')) { const q = (new URLSearchParams(path.split('?')[1]).get('query') ?? '').toLowerCase(); return [...shows.map(show => ({ type: 'show', show })), ...movies.map(movie => ({ type: 'movie', movie }))].filter(x => (x.show ?? x.movie).title.toLowerCase().includes(q) && p.split('/')[2].split(',').includes(x.type)); }
    if (p.includes('/favorites')) return [];
    return [];
  }

  const invoke = async (cmd, a = {}) => {
    switch (cmd) {
      case 'status': return window.__signedOut ? null : user;
      case 'library': case 'sync': return lib;
      case 'avatar': throw new Error('no avatar');
      case 'stats': case 'history_sync': return stats;
      case 'history_list': return [{ kind: 'tv', id: 1000, title: 'The Long Road', season: 2, episode: 2, position: 1900, duration: 2800 }, { kind: 'movie', id: 2003, title: 'Saltwater Kings', position: 3200, duration: 6900 }, { kind: 'tv', id: 1003, title: 'Glass Orchard', season: 1, episode: 5, position: 600, duration: 2600 }];
      case 'history_save': return null;
      case 'cache_info': return { count: 1240, bytes: 18e6 };
      case 'art': return { poster: `/poster-${a.id}.svg`, backdrop: `/backdrop-${a.id}.svg` };
      case 'tmdb': {
        const m = a.path.match(/^\/(tv|movie)\/(\d+)(?:\/season\/(\d+))?/);
        if (m?.[3]) return season(m[2], m[3]);
        if (m) return tmdbDetail(m[2]);
        return { results: [] };
      }
      case 'trakt': return traktGet(a.path);
      default: return null;
    }
  };
  const win = { setFullscreen: async () => {}, isFullscreen: async () => false };
  window.__TAURI__ = { core: { invoke }, window: { getCurrentWindow: () => win }, event: { listen: async () => () => {} }, opener: { openUrl: async () => {} } };
})();
