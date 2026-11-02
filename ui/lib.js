// Pure helpers, shared by app.js and tests/ui.test.js.

// Filmy ships with no video servers: each user adds their own in Settings.
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

if (typeof module !== 'undefined') module.exports = { DEFAULT_SOURCES, QUALITIES, qualityOf, esc, parseSources, formatSources, fillTemplate, episodeAfter, norm };
