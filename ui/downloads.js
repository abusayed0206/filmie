// Offline downloads: the queue, finding each video on the user's own servers, live progress wherever a download
// shows, the Downloads page and the offline player. Rust does the downloading and keeps the queue in SQLite.
const { listen } = window.__TAURI__.event;
const { convertFileSrc } = window.__TAURI__.core;
let downloads = []; // every row from `download_list`, kept current by the `download` event

function getDownloadQuality() {
  try { return qualityOf(localStorage.getItem('download-quality')); } catch { return '1080p'; }
}
const setDownloadQuality = q => { try { localStorage.setItem('download-quality', qualityOf(q)); } catch {} };

const downloadFor = (kind, id, s = 0, e = 0) => downloads.find(d => sameDownload(d, kind, id, s, e));
const downloadLabel = d => d.kind === 'tv' ? `${d.title} S${d.season}E${d.episode}` : d.title;
const movieDownload = (id, title) => ({ kind: 'movie', tmdb_id: id, season: 0, episode: 0, title });
const episodeDownload = (id, title, s, e, name) => ({ kind: 'tv', tmdb_id: id, season: s, episode: e, title, episode_title: name || null });

async function refreshDownloads() {
  downloads = await invoke('download_list');
  paintDownloads();
}

listen('download', ({ payload: d }) => {
  const i = downloads.findIndex(x => x.id === d.id);
  const before = i >= 0 ? downloads[i] : null;
  if (d.status === 'removed') { if (i >= 0) downloads.splice(i, 1); }
  else if (i >= 0) downloads[i] = d;
  else downloads.push(d);
  paintDownloads();
  if (before?.status === d.status) return; // only progress
  if (d.status === 'done') toast(`Downloaded ${downloadLabel(d)}`);
  if (d.status === 'failed' || d.status === 'protected') toast(`Couldn't download ${downloadLabel(d)}. ${d.error ?? ''}`);
  if (['done', 'failed', 'protected', 'removed'].includes(d.status)) pumpDownloads();
  if (location.hash === '#/downloads') route({ soft: true });
});

// ---------- painting: the rail item, and every download button and progress bar on the page
const DOWNLOAD_TITLES = {
  queued: 'Waiting to download', finding: 'Finding the video', downloading: 'Downloading',
  done: 'Downloaded. Play offline', failed: "Couldn't download. Try again", protected: 'Protected, so it can\'t be downloaded. Try again',
};
function downloadTitle(d) {
  if (!d) return 'Download for offline viewing';
  const pct = downloadPct(d);
  return d.status === 'downloading' && pct !== null ? `Downloading, ${Math.round(pct)}%` : DOWNLOAD_TITLES[d.status] ?? 'Download';
}
function paintDownloads() {
  const rail = document.getElementById('rail-downloads');
  const sum = downloadSummary(downloads);
  rail.classList.toggle('dl-active', sum.count > 0);
  rail.style.setProperty('--p', `${sum.pct}%`);
  rail.querySelector('.rail-dl-count').textContent = sum.count || '';
  rail.setAttribute('aria-label', sum.count ? `Downloads, ${sum.count} in progress, ${sum.pct}%` : 'Downloads');
  for (const b of document.querySelectorAll('[data-dl]')) {
    const [kind, id, s, e] = b.dataset.dl.split(':');
    const d = downloadFor(kind, +id, +s, +e);
    b.dataset.state = d?.status ?? '';
    b.querySelector('.dl-icon use')?.setAttribute('href', d?.status === 'done' ? '#i-downloaded' : '#i-download');
    b.style.setProperty('--p', `${downloadPct(d ?? {}) ?? 0}%`);
    b.title = downloadTitle(d);
    b.setAttribute('aria-label', `${downloadTitle(d)}: ${b.dataset.dlName}`);
    const label = b.querySelector('.label');
    if (label) label.textContent = d?.status === 'done' ? 'Downloaded' : d && isActiveDownload(d) ? 'Downloading' : 'Download';
  }
  for (const row of document.querySelectorAll('[data-dl-row]')) {
    const d = downloads.find(x => x.id === +row.dataset.dlRow);
    if (!d) continue;
    const pct = downloadPct(d);
    const bar = row.querySelector('.bar');
    if (bar) {
      bar.classList.toggle('busy', pct === null);
      bar.firstElementChild.style.width = `${pct ?? 0}%`;
    }
    const note = row.querySelector('.dl-note');
    if (note) note.textContent = downloadNote(d);
  }
}
const downloadNote = d => d.status === 'downloading'
  ? [downloadPct(d) === null ? 'Downloading' : `${Math.round(downloadPct(d))}%`, d.done_bytes && `${bytesText(d.done_bytes)}${d.total_bytes ? ` of about ${bytesText(d.total_bytes)}` : ''}`].filter(Boolean).join(' · ')
  : d.status === 'done' ? bytesText(d.done_bytes) : d.status === 'failed' || d.status === 'protected' ? d.error ?? '' : DOWNLOAD_TITLES[d.status];

// A button that downloads, shows progress, then plays offline. `item` is what download_add takes.
function downloadButton(item, { cls = 'action-btn', label = false } = {}) {
  const name = item.kind === 'tv' ? `${item.title} S${item.season}E${item.episode}` : item.title;
  return `<button type="button" class="${cls} dl-btn" data-dl="${item.kind}:${item.tmdb_id}:${item.season}:${item.episode}" data-dl-name="${esc(name)}" data-dl-item="${esc(JSON.stringify(item))}">
    <span class="dl-icon">${icon('download')}</span>${label ? '<span class="label">Download</span>' : ''}</button>`;
}
const downloadBadge = (kind, id) => isDownloaded(downloads, kind, id) ? `<i class="dl-badge" title="Downloaded">${icon('downloaded')}</i>` : '';

document.addEventListener('click', ev => {
  const b = ev.target.closest('[data-dl]');
  if (!b) return;
  ev.preventDefault();
  ev.stopPropagation();
  const item = JSON.parse(b.dataset.dlItem);
  const d = downloadFor(item.kind, item.tmdb_id, item.season, item.episode);
  const go = href => { b.closest('dialog')?.close(); location.hash = href; };
  if (d?.status === 'done') go(`#/offline/${d.id}`);
  else if (d && isActiveDownload(d)) go('#/downloads');
  else queueDownloads([item]);
}, true);

// ---------- the queue
async function queueDownloads(items) {
  if (!items.length) return;
  try { downloads = await invoke('download_add', { items }); }
  catch (e) {
    toast(e);
    if (String(e).includes('download folder')) location.hash = '#/settings/downloads';
    return;
  }
  paintDownloads();
  toast(items.length === 1 ? `Downloading ${downloadLabel(items[0])}` : `Downloading ${items.length} episodes`);
  pumpDownloads();
}

// Video addresses often expire within minutes, so each download is found just before it starts, one at a time.
let pumping = false;
async function pumpDownloads() {
  if (pumping) return;
  pumping = true;
  try {
    for (let d; (d = await invoke('download_next'));) {
      const found = await captureMedia(d);
      try {
        if (found.url) {
          await invoke('download_start', { id: d.id, url: found.url, page: found.page, agent: navigator.userAgent, quality: getDownloadQuality() });
          return; // the next one starts when this one ends
        }
        await invoke('download_fail', { id: d.id, protected: !!found.protected, error: found.protected ? "This video is protected, so it can't be downloaded." : found.error });
      } catch (e) { console.warn('download', d.id, e); } // removed while it was being found
    }
  } catch (e) { console.warn(e); }
  finally { pumping = false; }
}

// ---------- finding the video. Each server loads in a hidden, muted frame like the Auto race's, and the injected
// script reports the playlists and video files it loads. WebView2's own network events are the fallback.
const CAPTURE_WAIT = 25e3;
async function captureMedia(d) {
  const sources = getSources();
  if (!sources.length) return { error: 'Add a video server in Settings to download.' };
  const first = getServer(sources.length);
  let sawProtected = false;
  for (const i of [first, ...sources.keys()].filter((x, n, all) => all.indexOf(x) === n)) {
    const found = await captureFrom(sources[i], d);
    if (found?.url) return found;
    if (found?.protected) sawProtected = true;
  }
  return sawProtected ? { protected: true } : { error: "None of your servers showed a video Filmie could download." };
}

function captureFrom(source, d) {
  const src = fillTemplate(source[d.kind === 'movie' ? 'movie' : 'tv'], { tmdb_id: d.tmdb_id, season: d.season, episode: d.episode });
  return new Promise(resolve => {
    const f = document.createElement('iframe');
    f.className = 'player-probe capture-frame';
    f.tabIndex = -1;
    f.setAttribute('aria-hidden', 'true');
    f.allow = 'encrypted-media';
    f.referrerPolicy = 'origin';
    f.src = src;
    const tell = () => { try { f.contentWindow.postMessage({ __filmieCapture: 1 }, '*'); } catch {} };
    f.addEventListener('load', () => { tell(); setTimeout(tell, 1500); });
    const reports = [];
    let settle = null;
    const add = r => {
      reports.push(r);
      // Wait a moment after the first find, since a master playlist and its variants arrive close together.
      if (!settle && (pickCapture(reports) || r.drm)) settle = setTimeout(finish, r.drm ? 5000 : 2500);
    };
    const onMessage = ev => {
      const m = ev.data?.__filmieMedia;
      if (!m || typeof m !== 'object') return;
      for (let w = ev.source; w; w = w.parent) {
        if (w === f.contentWindow) {
          return add({ url: typeof m.url === 'string' ? m.url : null, kind: m.kind, drm: m.drm === true, page: typeof m.page === 'string' ? m.page : src });
        }
        if (w === w.parent) return;
      }
    };
    addEventListener('message', onMessage);
    // shortcut: the network events can't say which frame asked, so they only count while no other video is playing; the injected script's reports always count.
    const unlisten = listen('media-seen', ({ payload: p }) => {
      if (!nowPlaying && typeof p?.url === 'string') add({ url: p.url, kind: p.kind, page: p.referer || src });
    });
    const timer = setTimeout(finish, CAPTURE_WAIT);
    function finish() {
      clearTimeout(timer);
      clearTimeout(settle);
      removeEventListener('message', onMessage);
      unlisten.then(u => u());
      f.remove();
      resolve(pickCapture(reports));
    }
    document.body.append(f);
  });
}

// ---------- the Downloads page
pages.downloads = async () => {
  await refreshDownloads();
  const info = await invoke('download_folder');
  const shown = downloads.filter(d => forMode(true, d.kind === 'tv', d.kind === 'movie'));
  const g = groupDownloads(shown);
  const row = d => `<div class="dl-row" data-dl-row="${d.id}">
      <a class="dl-thumb" href="#/title/${d.kind}/${d.tmdb_id}" data-type="${d.kind}" data-id="${d.tmdb_id}" aria-label="${esc(d.title)}"><div class="art"><span class="cover-title">${esc(d.title)}</span></div></a>
      <div class="dl-info"><b>${esc(d.kind === 'tv' ? `S${d.season}E${d.episode}${d.episode_title ? ` · ${d.episode_title}` : ''}` : d.title)}</b>
        ${d.kind === 'tv' ? `<small class="muted">${esc(d.title)}</small>` : ''}
        <small class="dl-note${d.status === 'failed' || d.status === 'protected' ? ' error' : ' muted'}">${esc(downloadNote(d))}</small>
        ${isActiveDownload(d) ? `<div class="bar${downloadPct(d) === null ? ' busy' : ''}"><i style="width:${downloadPct(d) ?? 0}%"></i></div>` : ''}</div>
      <div class="dl-actions">
        ${d.status === 'done' ? `<a class="btn primary" href="#/offline/${d.id}">${icon('play')}Play</a>` : ''}
        ${d.status === 'failed' || d.status === 'protected' ? `<button type="button" class="btn" data-dl-retry="${d.id}">${icon('sync')}Try again</button>` : ''}
        <button type="button" class="btn" data-dl-remove="${d.id}">${icon('close')}${isActiveDownload(d) ? 'Cancel' : 'Remove'}</button></div></div>`;
  const section = (title, rows) => rows ? `<section class="dl-section"><h2>${esc(title)}</h2>${rows}</section>` : '';
  const empty = !shown.length ? `<section class="callout"><h2>Nothing downloaded yet</h2>
      <p class="muted">Use ${icon('download')} on a movie, an episode or a season to watch it here without a connection.</p></section>` : '';
  app.innerHTML = `<div class="page downloads"><h1 class="sr-only">Downloads</h1>
    <p class="muted dl-folder">${info.folder ? `Saving to ${esc(info.folder)}` : 'No download folder chosen yet.'} <a href="#/settings/downloads">${info.folder ? 'Change' : 'Choose one'}</a></p>
    ${empty}${section('Downloading', g.active.map(row).join(''))}${section('Movies', g.movies.map(row).join(''))}
    ${g.shows.map(s => section(s.title, s.episodes.map(row).join(''))).join('')}
    ${section("Couldn't download", g.problems.map(row).join(''))}</div>`;
  observeArt(app);
  app.querySelector('.downloads').onclick = ev => {
    const retry = ev.target.closest('[data-dl-retry]');
    if (retry) return queueDownloads([downloads.find(d => d.id === +retry.dataset.dlRetry)].filter(Boolean));
    const remove = ev.target.closest('[data-dl-remove]');
    if (!remove) return;
    const d = downloads.find(x => x.id === +remove.dataset.dlRemove);
    if (!d) return;
    const drop = () => invoke('download_remove', { id: d.id }).catch(toast);
    if (isActiveDownload(d)) return drop();
    modal({
      title: d.status === 'done' ? 'Delete this download?' : 'Remove this download?',
      body: `<p class="muted">${esc(downloadLabel(d))}${d.dir ? ` will be deleted from ${esc(d.dir)}` : ' will be removed from the list'}.</p>`,
      actions: [{ label: 'Cancel' }, { label: d.status === 'done' ? 'Delete' : 'Remove', primary: true, onClick: drop }],
    });
  };
};
pages.downloads.bar = () => ({ title: 'Downloads', meta: downloads.length ? `${downloads.filter(d => d.status === 'done').length} saved` : '', mode: 'bar' });

// ---------- the offline player. A single file plays as it is; a saved HLS stream plays through the bundled hls.js.
let hlsScript = null;
const loadHls = () => hlsScript ??= new Promise((ok, fail) => {
  const s = document.createElement('script');
  s.src = 'vendor/hls.min.js';
  s.onload = ok;
  s.onerror = () => { hlsScript = null; fail(new Error('The stream player could not load.')); };
  document.head.append(s);
});

pages.offline = async id => {
  const token = routeToken;
  if (!downloads.some(x => x.id === +id)) await refreshDownloads();
  const d = downloads.find(x => x.id === +id);
  if (!d || d.status !== 'done' || !d.file) throw new Error("This download isn't on this PC any more.");
  const next = d.kind === 'tv' ? nextDownloaded(downloads, d.tmdb_id, d.season, d.episode) : null;
  const backHref = d.kind === 'tv' ? `#/title/tv/${d.tmdb_id}/${d.season}` : `#/title/movie/${d.tmdb_id}`;
  app.innerHTML = `<div class="player-page offline-player">
    <div class="player-bar">
      <a class="icon-btn ghost" href="#/downloads" data-player-back aria-label="Back" title="Back">${icon('back')}</a>
      <a class="icon-btn ghost" href="#/" aria-label="Home" title="Home">${icon('home')}</a>
      <a class="player-title" href="${backHref}" title="Details"><b>${esc(d.title)}</b>
        <span>${d.kind === 'tv' ? `S${d.season} · E${d.episode}${d.episode_title ? ` · ${esc(d.episode_title)}` : ''} · ` : ''}Downloaded</span></a>
      ${next ? `<a class="btn primary" href="#/offline/${next.id}" title="Next downloaded episode: S${next.season} · E${next.episode}"><span class="label">Next</span>${icon('next')}</a>` : ''}
      ${fsButton}
    </div>
    <video class="player" controls autoplay title="Video player"></video></div>`;
  const page = app.querySelector('.player-page');
  page.addEventListener('click', ev => {
    const a = ev.target.closest('a[href]');
    if (!a) return;
    if (a.hasAttribute('data-player-back') && window.navigation?.canGoBack) { ev.preventDefault(); navigation.back(); }
    else if (a.getAttribute('href').startsWith('#/offline/')) { ev.preventDefault(); location.replace(a.getAttribute('href')); }
  });
  const video = app.querySelector('video');
  const src = convertFileSrc(d.file);
  if (/\.m3u8$/i.test(d.file)) {
    await loadHls();
    if (token !== routeToken) return;
    if (!window.Hls?.isSupported()) throw new Error("This PC can't play saved streams.");
    // No worker, so the CSP needs no worker-src. Segments load from the asset protocol like the file would.
    // convertFileSrc packs the whole path into one URL segment, so the playlists' relative names would resolve to
    // the asset root. Each request is pointed back at the download's own folder, where all its files sit side by side.
    const folder = d.file.replace(/[^\\/]+$/, '');
    const local = url => {
      const name = decodeURIComponent(url.split(/[?#]/)[0].split('/').pop());
      return convertFileSrc(/[\\/:]/.test(name) ? name : folder + name);
    };
    const hls = new Hls({ enableWorker: false, xhrSetup: (xhr, url) => xhr.open('GET', local(url)) });
    hls.loadSource(src);
    hls.attachMedia(video);
    addEventListener('hashchange', () => hls.destroy(), { once: true });
  } else video.src = src;
  nowPlaying = { entry: { kind: d.kind, id: d.tmdb_id, title: d.title, season: d.kind === 'tv' ? d.season : null, episode: d.kind === 'tv' ? d.episode : null, position: 0, duration: 0 }, runtime: null };
  savePlayed();
  let saved = 0;
  video.addEventListener('timeupdate', () => {
    if (!nowPlaying || Math.abs(video.currentTime - saved) < 5) return;
    const p = validProgress({ t: video.currentTime, d: video.duration });
    if (!p) return;
    saved = p.t;
    nowPlaying.entry.position = p.t;
    nowPlaying.entry.duration = p.d;
    savePlayed();
  });
  video.focus();
};
pages.offline.bar = {};
