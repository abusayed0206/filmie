// Pure helpers, shared by app.js and tests/ui.test.js.

// Filmie ships with no video servers: each user adds their own in Settings.
const DEFAULT_SOURCES = [];
const QUALITIES = ['auto', '1080p', '720p', '480p'];
const qualityOf = q => QUALITIES.includes(q) ? q : '1080p';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// One source per line: "Name | movie URL | TV URL | optional note | optional #rrggbb accent".
// The note and accent belong to that server only, so every server keeps its own design.
function parseSources(text) {
  return text.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const parts = line.split('|').map(x => x.trim());
    const [name, movie, tv] = parts;
    const valid = u => /^https:\/\/\S+$/.test(u ?? '') && u.includes('{tmdb_id}');
    if (!name || parts.length > 5 || !valid(movie) || !valid(tv)) {
      throw new Error(`Bad source line: ${line}. Use: Name | https://…{tmdb_id}… | https://…{tmdb_id}…{season}…{episode}… | note | #rrggbb`);
    }
    let note, accent;
    if (parts.length >= 5) [note, accent] = [parts[3], parts[4]];
    else if (parts.length === 4) parts[3].startsWith('#') ? accent = parts[3] : note = parts[3];
    if (accent !== undefined && !/^#[0-9a-f]{6}$/i.test(accent)) {
      throw new Error(`Bad accent on source line: ${line}. Use a hex colour like #e5484d.`);
    }
    return { name, movie, tv, ...(note ? { note } : {}), ...(accent ? { accent: accent.toLowerCase() } : {}) };
  });
}

// Writes the same format Settings uses, including each server's note and accent.
function formatSources(list) {
  return list.map(s => {
    let line = `${s.name} | ${s.movie} | ${s.tv}`;
    if (s.note || s.accent) line += ` | ${s.note ?? ''}`;
    if (s.accent) line += ` | ${s.accent}`;
    return line;
  }).join('\n');
}

function fillTemplate(template, values) {
  return template.replace(/\{(tmdb_id|season|episode)\}/g, (_, k) => encodeURIComponent(values[k] ?? ''));
}

// Common URL shapes suggested in Settings. Only paths: the server itself is always the user's own.
const MOVIE_STRUCTURES = ['/movie/{tmdb_id}', '/embed/movie/{tmdb_id}', '/embed/movie?tmdb={tmdb_id}'];
const TV_STRUCTURES = ['/tv/{tmdb_id}/{season}/{episode}', '/tv/{tmdb_id}-{season}-{episode}', '/embed/tv/{tmdb_id}/{season}/{episode}',
  '/embed/tv/{tmdb_id}?s={season}&e={episode}', '/embed/tv?tmdb={tmdb_id}&season={season}&episode={episode}'];

function joinStructure(base, structure, needed, label) {
  const s = (structure ?? '').trim();
  if (!s) throw new Error(`The ${label} structure is required.`);
  if (/[\s|]/.test(s)) throw new Error(`The ${label} structure can't contain spaces or |.`);
  for (const [p] of s.matchAll(/\{[^}]*\}/g)) if (!needed.includes(p)) throw new Error(`The ${label} structure can't use ${p}. Use ${needed.join(', ')}.`);
  const missing = needed.find(p => !s.includes(p));
  if (missing) throw new Error(`The ${label} structure needs ${missing}.`);
  if (/^https:\/\//i.test(s)) return s; // a full link, for a server that keeps movies and TV on different hosts
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) throw new Error(`The ${label} structure must be a path or an https:// link.`);
  return base + (/^[/?]/.test(s) ? s : `/${s}`);
}

// Turns the Settings form into a saved server. Whatever passes here also survives parseSources.
function buildServer({ link, movie, tv, name, note, accent }) {
  const text = (link ?? '').trim();
  let url;
  try { url = new URL(text); } catch { throw new Error('Enter the server link, like https://example.com.'); }
  if (url.protocol !== 'https:') throw new Error('The server link must start with https://.');
  if (/[{}|\s]/.test(text) || url.search || url.hash) throw new Error('The server link is only the address, like https://example.com. The rest goes in the structures.');
  const base = url.origin + url.pathname.replace(/\/+$/, '');
  const [cleanName, cleanNote] = [name, note].map(x => (x ?? '').trim());
  if (cleanName.includes('|') || cleanNote.includes('|')) throw new Error("The name and note can't contain |.");
  if (accent && !/^#[0-9a-f]{6}$/i.test(accent)) throw new Error('The accent must be a hex colour like #e5484d.');
  return {
    name: cleanName || url.hostname.replace(/^www\./, ''),
    movie: joinStructure(base, movie, ['{tmdb_id}'], 'movie'),
    tv: joinStructure(base, tv, ['{tmdb_id}', '{season}', '{episode}'], 'TV'),
    ...(cleanNote ? { note: cleanNote } : {}),
    ...(accent ? { accent: accent.toLowerCase() } : {}),
  };
}

// The reverse, for editing. A link on another host stays whole in its structure.
function splitServer(s) {
  const origin = u => { try { return new URL(u).origin; } catch { return ''; } };
  const link = origin(s.movie);
  const rest = u => origin(u) === link && u.toLowerCase().startsWith(link) ? u.slice(link.length) : u;
  return { link, movie: rest(s.movie), tv: rest(s.tv) };
}

// The default server is saved as an index, so it has to follow the list when one is removed.
const serverAfterRemove = (current, removed) => current === removed ? 0 : current > removed ? current - 1 : current;

// Episode after s/e using TMDB's season list, or null at the end of the show.
function episodeAfter(show, s, e) {
  const count = n => show.seasons?.find(x => x.season_number === n)?.episode_count ?? 0;
  return e < count(s) ? [s, e + 1] : count(s + 1) ? [s + 1, 1] : null;
}

// Trakt items come bare ({title, ids}) or wrapped ({movie}, {show}, {type, movie}). Returns null without a TMDB id.
function norm(x, bareType) {
  // /media/popular returns bare items with no type, and only shows have aired_episodes.
  const tt = x?.movie ? 'movie' : x?.show ? 'show' : x?.aired_episodes !== undefined ? 'show' : bareType;
  const m = x?.movie ?? x?.show ?? x;
  if (!m?.ids?.tmdb || !tt) return null;
  // Lists only carry the extra details when asked for with extended=full.
  const released = m.released ?? m.first_aired;
  return {
    type: tt === 'show' ? 'tv' : 'movie', id: m.ids.tmdb, title: m.title, year: m.year,
    ...(m.runtime ? { runtime: m.runtime } : {}),
    ...(m.aired_episodes ? { episodes: m.aired_episodes } : {}),
    ...(released ? { released } : {}),
    ...(m.rating ? { rating: m.rating } : {}),
    ...(m.genres?.length ? { genres: m.genres } : {}),
    ...(m.after_credits || m.during_credits ? { postCredits: true } : {}),
  };
}

// YYYY-MM-DD in the person's own timezone, as calendars take it.
const isoDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// A date with no time (a movie's release) means that calendar day everywhere, so it mustn't shift with the timezone.
const shortDate = s => !s ? '' : new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(s.length === 10 ? { timeZone: 'UTC' } : {}) });

const fullDate = s => !s ? '' : new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', ...(s.length === 10 ? { timeZone: 'UTC' } : {}) });
// Date arithmetic on YYYY-MM-DD. It's done in UTC so a clock change can't move a day.
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);
const weekStart = iso => addDays(iso, -((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7));

// What a summary card shows in place of the rating under a given sort. Undefined keeps the rating.
function sortValue(x, by, mine) {
  const m = x?.movie ?? x?.show ?? x;
  if (by === 'added') return fullDate(x?.listed_at) || undefined;
  if (by === 'runtime') return runtimeText(m?.runtime) || undefined;
  if (by === 'my_rating') return mine ? `${mine}/10` : undefined;
  if (by === 'released') return fullDate(m?.released ?? m?.first_aired) || undefined;
  if (by === 'rank') return x?.rank ? `#${x.rank}` : undefined;
  return undefined;
}

// Trakt's progress page splits finished shows on whether more episodes can come.
const hasEnded = status => status === 'ended' || status === 'canceled';

// Trakt returns lists in the person's own order, so 'rank' keeps it.
function sortLists(lists, by) {
  const newest = key => (a, b) => (b[key] ?? '').localeCompare(a[key] ?? '');
  const order = { name: (a, b) => a.name.localeCompare(b.name), updated: newest('updated_at'), created: newest('created_at') }[by];
  return order ? [...lists].sort(order) : lists;
}

// Consecutive watched days ending today or yesterday, so a streak survives until a day is really missed.
function streakFrom(days, today) {
  const seen = new Set(days);
  let day = seen.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (seen.has(day)) {
    streak++;
    day = addDays(day, -1);
  }
  return streak;
}
// The last seven days, today last.
const weekHeatmap = (days, today) => [6, 5, 4, 3, 2, 1, 0].map(n => days.includes(addDays(today, -n)));

// A long total reads better in days than in hundreds of hours.
function durationText(minutes) {
  const m = minutes ?? 0;
  if (m < 60) return `${m}m`;
  if (m < 1440) return runtimeText(m);
  return [`${Math.floor(m / 1440)}d`, m % 1440 >= 60 && `${Math.floor(m % 1440 / 60)}h`].filter(Boolean).join(' ');
}

// The last n months, oldest first, including those with no plays so the chart's time axis is even.
function recentMonths(byMonth, today, n) {
  const plays = new Map(byMonth.map(x => [x.month, x.plays]));
  const [year, month] = today.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(year, month - 1 - (n - 1 - i), 1));
    const key = d.toISOString().slice(0, 7);
    return { month: key, plays: plays.get(key) ?? 0 };
  });
}

// Trakt's exact search still returns near-matches, so true title matches go first. The rest keep their order.
function exactFirst(items, query) {
  const q = query.toLowerCase();
  const exact = x => (x.movie ?? x.show)?.title?.toLowerCase() === q;
  return [...items].sort((a, b) => exact(b) - exact(a));
}

// Continue Watching mixes shows in progress with paused movies, most recent first.
const continueTime = x => x.progress?.last_watched_at ?? x.paused_at ?? '';
const mergeContinue = (shows, movies) => [...shows, ...movies].sort((a, b) => continueTime(b).localeCompare(continueTime(a)));

// Start Watching is the watchlist without what isn't out yet or has already been started. showsInProgress holds TMDB ids.
function startWatching(items, today, showsInProgress) {
  return items.filter(x => {
    const m = x.movie ?? x.show;
    const released = m?.released ?? m?.first_aired;
    return released && released.slice(0, 10) <= today && !(x.show && showsInProgress.has(m.ids?.tmdb));
  });
}

// What goes to /sync/history. watchedAt is left out for "now", or is a UTC time or 'released'.
function historyBody({ type, id, season, episode }, watchedAt) {
  const at = watchedAt ? { watched_at: watchedAt } : {};
  if (type === 'movie') return { movies: [{ ids: { tmdb: id }, ...at }] };
  if (season === undefined) return { shows: [{ ids: { tmdb: id }, ...at }] };
  return { shows: [{ ids: { tmdb: id }, seasons: [{ number: season, episodes: [{ number: episode, ...at }] }] }] };
}

// A title's colour goes into a style attribute, so only a plain hex colour gets through.
const safeColor = c => /^#[0-9a-f]{6}$/i.test(c ?? '') ? c : null;
// A YouTube video's id, which goes into an embed address, so nothing else gets through.
function youtubeKey(url) {
  return /^https:\/\/(?:(?:www\.|m\.)?youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/)|youtu\.be\/)([\w-]{1,32})(?:[&?#/]|$)/.exec(url ?? '')?.[1] ?? null;
}
// TMDB lists videos in no useful order: an official trailer first, then any trailer, then a teaser.
function pickTrailer(videos) {
  const rank = v => ({ Trailer: 0, Teaser: 2 })[v.type] + (v.official ? 0 : 1);
  return (videos ?? []).filter(v => v.site === 'YouTube' && /^[\w-]{1,32}$/.test(v.key ?? '') && rank(v) >= 0).sort((a, b) => rank(a) - rank(b))[0] ?? null;
}
// A person's credits, newest first, with each title once however many characters they played.
function newestCredits(credits) {
  const seen = new Set();
  return [...(credits ?? [])].sort((a, b) => ((b.movie ?? b.show)?.year ?? 0) - ((a.movie ?? a.show)?.year ?? 0)).filter(x => {
    const id = (x.movie ?? x.show)?.ids?.tmdb;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

const runtimeText = min => !min ? '' : [Math.floor(min / 60) && `${Math.floor(min / 60)}h`, min % 60 && `${min % 60}m`].filter(Boolean).join(' ');

// A card shows one status at most, in Trakt's order of importance.
const STATUS_ORDER = [['dropped', 'Dropped'], ['watched', 'Watched'], ['started', 'Started'], ['postCredits', 'Post-credits'], ['watchlisted', 'Watchlist']];
const statusTag = flags => STATUS_ORDER.find(([key]) => flags[key])?.[1] ?? '';

// A progress report comes from a third-party page, so only well-formed numbers count. Anything much shorter
// than the title's runtime is probably an ad.
function validProgress(p, runtimeMinutes) {
  const { t, d } = p ?? {};
  if (!Number.isFinite(t) || !Number.isFinite(d) || t < 0 || t > d) return null;
  return d >= Math.max(60, (runtimeMinutes ?? 0) * 30) ? { t, d } : null;
}

// The rail items a route highlights, the exact one first. Title and player pages belong to none.
const RAIL_ITEMS = {
  '': [''], search: ['search'], progress: ['progress', ''], calendar: ['calendar', ''], discover: ['discover'],
  lists: ['lists'], list: ['lists'], watchlist: ['watchlist', 'lists'], history: ['history'], library: ['library'], settings: ['settings'], hidden: ['settings'], profile: ['profile'],
};
function navFor(page, sub) {
  if (page === 'discover' && sub) return sub === 'recommended' ? ['discover/recommended', ''] : [`discover/${sub}`, 'discover'];
  if (page === 'lists' && sub) return [`lists/${sub}`, 'lists'];
  return Object.hasOwn(RAIL_ITEMS, page) ? RAIL_ITEMS[page] : [];
}

const MODES = ['media', 'show', 'movie'];
const modeOf = m => MODES.includes(m) ? m : 'media';

// Filters. The state is { param: value } exactly as the API takes it, so a preset is expanded when it's picked.
// Facts from the 2026-11-03 probe: `statuses` works and `status` is ignored; parental filters only take numeric ranges.
function decadeOptions(year = new Date().getFullYear()) {
  const decades = [];
  for (let d = Math.floor(year / 10) * 10; d >= 1960; d -= 10) decades.push({ label: `${d}s`, value: `${d}-${d + 9}` });
  return [{ label: 'This year', value: String(year) }, ...decades];
}
const GRADES = ['None', 'Mild', 'Moderate', 'Severe'];
const parental = (key, label) => ({ key: `parental_${key}`, label, range: [0, 3], grades: GRADES, advancedOnly: true });
const FILTERS = [
  // shortcut: Trakt's "My favorites" option is left out of Genre and Availability, upgrade once Settings can show those favourites.
  { key: 'genres', label: 'Genre', source: 'genres', exclude: true },
  // shortcut: no individual streaming services, because their list returned 403 in the probe. Upgrade if Trakt opens /watchnow/sources.
  { key: 'watchnow', label: 'Availability', options: [{ label: 'Streaming now', value: 'subscriptions' }, { label: 'Free', value: 'free' }, { label: 'All digital releases', value: 'any' }] },
  { key: 'years', label: 'Decade', advancedLabel: 'Released', options: decadeOptions(), range: [1930, 2030] },
  { key: 'runtimes', label: 'Runtime', options: ['0-30', '31-60', '61-90', '91-120'].map(r => ({ label: `${r} min`, value: r })).concat({ label: '121+ min', value: '121-' }), range: [0, 500], unit: ' min' },
  { key: 'ratings', label: 'Trakt rating', advancedLabel: 'Ratings', range: [0, 100], unit: '%', simpleRange: true },
  { key: 'certifications', label: 'Certification', source: 'certifications', exclude: true, options: [
    { label: 'All Ages', value: 'g,tv-y,tv-y7,tv-g' }, { label: 'Parental Guidance', value: 'pg,tv-pg' }, { label: 'Teens', value: 'pg-13,tv-14' }, { label: 'Mature', value: 'r,tv-ma' }, { label: 'Unrated', value: 'nr' },
  ] },
  { key: 'countries', label: 'Region', advancedLabel: 'Country', source: 'countries', options: [
    { label: 'North America', value: 'us,ca' },
    { label: 'Latin America', value: 'mx,br,ar,cl,co,pe,ve,uy,cu' },
    { label: 'Europe', value: 'gb,fr,de,it,es,dk,ie,se,be,ru,no,pl,nl,at,fi,ro,gr,hu,is,ch,cz,ua,pt' },
    { label: 'Middle East', value: 'tr,il,ir,ae,sa,lb,iq,jo,kw,qa' },
    { label: 'Africa', value: 'za,ng,eg,ke,ma,gh,et,dz,tn,sn' },
    { label: 'Asia', value: 'in,jp,kr,hk,cn,tw,th,sg,my,id,ph,vn,pk,bd' },
    { label: 'Oceania', value: 'au,nz' },
  ] },
  { key: 'statuses', label: 'Status', options: [
    { label: 'Released', value: 'returning series,continuing,released' }, { label: 'Upcoming', value: 'upcoming,in production,planned,post production' },
    { label: 'Ended', value: 'ended' }, { label: 'Canceled', value: 'canceled' }, { label: 'Rumored', value: 'rumored' },
  ], multi: ['returning series', 'released', 'continuing', 'upcoming', 'in production', 'post production', 'planned', 'ended', 'canceled', 'rumored'] },
  parental('nudity', 'Nudity'), parental('violence', 'Violence'), parental('profanity', 'Profanity'), parental('alcohol', 'Alcohol'), parental('frightening', 'Frightening'),
  // Asking to see watched titles means not ignoring them, so Yes sends false.
  { key: 'ignore_watched', label: 'Watched', display: true, auth: true, flag: true, options: [{ label: 'Yes', value: 'false' }, { label: 'No', value: 'true' }] },
  { key: 'ignore_watchlisted', label: 'Watchlisted', display: true, auth: true, flag: true, options: [{ label: 'Yes', value: 'false' }, { label: 'No', value: 'true' }] },
  // Advanced's ratings slider also sets these, so they count as one filter.
  { key: 'imdb_ratings', alias: true, range: [0, 10] }, { key: 'rt_meters', alias: true, range: [0, 100] }, { key: 'rt_user_meters', alias: true, range: [0, 100] },
];
const filterDef = key => FILTERS.find(f => f.key === key);

function cleanFilters(filters) {
  const clean = {};
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) return clean;
  for (const [key, value] of Object.entries(filters)) {
    const def = filterDef(key);
    if (!def || typeof value !== 'string') continue;
    const valid = def.flag ? /^(true|false)$/.test(value) : /^-?[\w +.-]+(,-?[\w +.-]+)*$/.test(value);
    const fullRange = def.range && value === def.range.join('-');
    if (valid && !fullRange) clean[key] = value;
  }
  return clean;
}

// Commas separate multiple values in Trakt's query strings, so they stay readable.
const filterQuery = filters => Object.entries(cleanFilters(filters)).map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%2C/g, ',')}`).join('&');
const filterCount = filters => Object.keys(cleanFilters(filters)).filter(k => !filterDef(k).alias).length;
const addQuery = (path, query) => query ? `${path}${path.includes('?') ? '&' : '?'}${query}` : path;

// Whether Simple's controls can show these values. If not, leaving Advanced has to clear them.
function fitsSimple(filters) {
  return Object.entries(cleanFilters(filters)).every(([key, value]) => {
    const def = filterDef(key);
    if (def.alias || def.advancedOnly) return false;
    if (def.simpleRange) return true;
    if (def.options) return def.options.some(o => o.value === value);
    return !value.includes(',') && !value.startsWith('-');
  });
}

// Where a page starts: back and forward return to the saved spot, anything else opens at the top.
const scrollTarget = (navType, saved) => navType === 'traverse' ? saved ?? 0 : 0;

// The small print on a Recently played card.
function playedNote(p, now = Date.now() / 1000) {
  if (p.duration > 0) {
    if (p.position / p.duration >= 0.95) return 'Finished';
    return `${Math.max(1, Math.round((p.duration - p.position) / 60))} min left`;
  }
  const mins = Math.floor((now - p.updated_at) / 60);
  if (mins < 1) return 'Opened just now';
  if (mins < 60) return `Opened ${mins} min ago`;
  if (mins < 1440) return `Opened ${Math.floor(mins / 60)} h ago`;
  return `Opened ${Math.floor(mins / 1440)} d ago`;
}

if (typeof module !== 'undefined') module.exports = { validProgress, playedNote, historyBody, safeColor, youtubeKey, pickTrailer, newestCredits, isoDate, shortDate, fullDate, addDays, weekStart, sortValue, hasEnded, sortLists, exactFirst, streakFrom, weekHeatmap, durationText, recentMonths, mergeContinue, startWatching, runtimeText, statusTag, navFor, modeOf, FILTERS, decadeOptions, cleanFilters, filterQuery, filterCount, addQuery, fitsSimple, scrollTarget, DEFAULT_SOURCES, QUALITIES, qualityOf, esc, parseSources, formatSources, fillTemplate, buildServer, splitServer, serverAfterRemove, MOVIE_STRUCTURES, TV_STRUCTURES, episodeAfter, norm };
