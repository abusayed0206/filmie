// Pure helpers, shared by app.js and tests/ui.test.js.

// Filmie ships with no video servers: each user adds their own in Settings.
const DEFAULT_SOURCES = [
  {
    name: 'Rakan',
    movie: 'https://vixsrc.to/movie/{tmdb_id}?autoPlay=true&lang=en',
    tv: 'https://vixsrc.to/tv/{tmdb_id}/{season}/{episode}?autoPlay=true&lang=en',
    note: 'VixSrc · generally better quality.',
    accent: '#e5484d',
  },
  {
    name: 'Bard',
    movie: 'https://moviesapi.to/movie/{tmdb_id}',
    tv: 'https://moviesapi.to/tv/{tmdb_id}-{season}-{episode}',
    note: 'MoviesAPI · recommended for recent movies.',
    accent: '#d4a72c',
  },
  {
    name: 'Xayah',
    movie: 'https://vidsrc.sh/embed/movie?tmdb={tmdb_id}&autoplay=1',
    tv: 'https://vidsrc.sh/embed/tv?tmdb={tmdb_id}&season={season}&episode={episode}&autoplay=1',
    note: 'VidSrc · current domain.',
    accent: '#8b5cf6',
  },
  {
    name: 'Ekko',
    movie: 'https://cinesrc.st/embed/movie/{tmdb_id}?autoPlay=true',
    tv: 'https://cinesrc.st/embed/tv/{tmdb_id}?s={season}&e={episode}&autoPlay=true',
    note: 'CineSrc · may have 4K.',
    accent: '#22c55e',
  },
  {
    name: 'Naafiri',
    movie: 'https://vidfast.vc/movie/{tmdb_id}?autoPlay=true',
    tv: 'https://vidfast.vc/tv/{tmdb_id}/{season}/{episode}?autoPlay=true',
    note: 'VidFast · may have 4K.',
    accent: '#06b6d4',
  },
  {
    name: 'Ryze',
    movie: 'https://vidlink.pro/movie/{tmdb_id}?title=true&poster=true&autoplay=true&player=jw',
    tv: 'https://vidlink.pro/tv/{tmdb_id}/{season}/{episode}?title=true&poster=true&autoplay=true&nextbutton=true&player=jw',
    note: 'VidLink · newer titles only.',
    accent: '#f97316',
  },
];
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

// A progress report comes from a third-party page, so only well-formed numbers count. Anything much shorter
// than the title's runtime is probably an ad.
function validProgress(p, runtimeMinutes) {
  const { t, d } = p ?? {};
  if (!Number.isFinite(t) || !Number.isFinite(d) || t < 0 || t > d) return null;
  return d >= Math.max(60, (runtimeMinutes ?? 0) * 30) ? { t, d } : null;
}

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

if (typeof module !== 'undefined') module.exports = { validProgress, playedNote, DEFAULT_SOURCES, QUALITIES, qualityOf, esc, parseSources, formatSources, fillTemplate, episodeAfter, norm };
