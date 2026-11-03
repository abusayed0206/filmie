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
  const tt = x?.movie ? 'movie' : x?.show ? 'show' : bareType;
  const m = x?.movie ?? x?.show ?? x;
  return m?.ids?.tmdb && tt ? { type: tt === 'show' ? 'tv' : 'movie', id: m.ids.tmdb, title: m.title, year: m.year } : null;
}

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
  lists: ['lists'], list: ['lists'], watchlist: ['watchlist', 'lists'], history: ['history'], library: ['library'], settings: ['settings'], profile: ['profile'],
};
function navFor(page, sub) {
  if (page === 'discover' && sub) return sub === 'recommended' ? ['discover/recommended', ''] : [`discover/${sub}`, 'discover'];
  if (page === 'lists' && sub) return [`lists/${sub}`, 'lists'];
  return Object.hasOwn(RAIL_ITEMS, page) ? RAIL_ITEMS[page] : [];
}

const MODES = ['media', 'show', 'movie'];
const modeOf = m => MODES.includes(m) ? m : 'media';

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

if (typeof module !== 'undefined') module.exports = { validProgress, playedNote, navFor, modeOf, scrollTarget, DEFAULT_SOURCES, QUALITIES, qualityOf, esc, parseSources, formatSources, fillTemplate, buildServer, splitServer, serverAfterRemove, MOVIE_STRUCTURES, TV_STRUCTURES, episodeAfter, norm };
