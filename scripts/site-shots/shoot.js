// Renders the real ui/ with mocked Tauri calls and generated artwork, and saves screenshots.
// node shoot.js <repo> <outdir> [names...]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const http = require('http');

const [repo, out, ...only] = process.argv.slice(2);
const ui = path.join(repo, 'ui');
const mock = fs.readFileSync(path.join(__dirname, 'mock.js'), 'utf8');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' };

// Deterministic palette per id
const PALETTES = [['#2b1a3f', '#e0567a', '#f6c177'], ['#0e2a3b', '#2d8fa8', '#d8f3ff'], ['#2a1810', '#c4622d', '#ffd29d'], ['#13261a', '#3f9a5a', '#d9f7c4'],
  ['#1c1d3a', '#6b5cff', '#ffb8f0'], ['#301018', '#b8323f', '#ffd0a8'], ['#10222a', '#e2a33a', '#fff2c8'], ['#1d1d22', '#8a8fa8', '#f1e9dc'], ['#0f2a2a', '#22b39a', '#ffe08a'], ['#2a1530', '#9b4bd1', '#ffd36b']];
function art(file) {
  const id = [...file].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) % 99991, 7);
  const [a, b, c] = PALETTES[id % PALETTES.length];
  const portrait = file.includes('poster') || file.includes('person');
  const [w, h] = portrait ? [500, 750] : [1280, 720];
  const seed = id * 9301 % 233;
  const sun = `<circle cx="${w * (0.25 + (seed % 50) / 100)}" cy="${h * (portrait ? 0.38 : 0.42)}" r="${(portrait ? w : h) * 0.22}" fill="${c}" opacity=".9"/>`;
  const hills = [0, 1, 2].map(k => {
    const y = h * (0.58 + k * 0.12);
    return `<path d="M0 ${y} C ${w * 0.3} ${y - 60 - k * 20 - seed % 40}, ${w * 0.6} ${y + 40}, ${w} ${y - 30 - seed % 30} L${w} ${h} L0 ${h}Z" fill="${k === 2 ? a : b}" opacity="${0.45 + k * 0.25}"/>`;
  }).join('');
  if (file.includes('person')) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="${a}"/><circle cx="250" cy="300" r="120" fill="${b}"/><ellipse cx="250" cy="720" rx="230" ry="260" fill="${b}"/></svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>${sun}${hills}</svg>`;
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/embed/')) {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(`<body style="margin:0;background:#000;overflow:hidden"><img src="/still.svg" style="width:100%;height:100%;object-fit:cover;opacity:.92">
      <div style="position:fixed;left:0;right:0;bottom:0;padding:18px 24px;background:linear-gradient(transparent,#000c);display:flex;gap:16px;align-items:center;font:14px system-ui;color:#fff">
      <svg width="22" height="22" viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="#fff"/></svg><span>18:42 / 47:10</span>
      <div style="flex:1;height:4px;background:#ffffff40;border-radius:2px"><div style="width:39%;height:100%;background:#fff;border-radius:2px"></div></div><span>1080p</span></div></body>`);
  }
  if (u.pathname === '/still.svg') { res.writeHead(200, { 'content-type': 'image/svg+xml' }); return res.end(art('backdrop-1003')); }
  const file = path.join(ui, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname));
  if (!file.startsWith(ui) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const SHOTS = [
  { name: 'home', hash: '#/', },
  { name: 'discover', hash: '#/discover' },
  { name: 'title', hash: '#/title/tv/1000' },
  { name: 'movie', hash: '#/title/movie/2009' },
  { name: 'player', hash: '#/play/tv/1000/2/3', sources: true, after: async p => { await p.click('#episode-btn'); await p.waitForTimeout(600); } },
  { name: 'profile', hash: '#/profile' },
  { name: 'trending', hash: '#/discover/trending' },
  { name: 'settings', hash: '#/settings' },
  { name: 'palette', hash: '#/', after: async p => { await p.keyboard.press('Control+k'); await p.waitForTimeout(300); await p.keyboard.type('the'); await p.waitForTimeout(800); } },
  { name: 'filters', hash: '#/discover', after: async p => { await p.click('#filter-btn, [aria-label*="ilter"]'); await p.waitForTimeout(600); } },
];

(async () => {
  await new Promise(r => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  for (const shot of SHOTS.filter(s => !only.length || only.includes(s.name))) {
    const ctx = await browser.newContext({ viewport: { width: shot.w ?? 1440, height: shot.h ?? 900 }, deviceScaleFactor: 2, colorScheme: 'dark' });
    await ctx.route('https://image.tmdb.org/**', r => r.fulfill({ contentType: 'image/svg+xml', body: art(new URL(r.request().url()).pathname.split('/').pop()) }));
    await ctx.addInitScript(mock);
    await ctx.addInitScript(([sources, embed]) => {
      localStorage.setItem('mode', 'media');
      localStorage.setItem('rail', 'wide');
      if (sources) localStorage.setItem('sources', JSON.stringify([{ name: 'My server', movie: `${embed}embed/movie/{tmdb_id}`, tv: `${embed}embed/tv/{tmdb_id}/{season}/{episode}`, accent: '#e5484d' }, { name: 'Backup', movie: `${embed}embed/m/{tmdb_id}`, tv: `${embed}embed/t/{tmdb_id}`, note: 'Slower, more languages' }]));
    }, [!!shot.sources, base]);
    const page = await ctx.newPage();
    page.on('pageerror', e => console.error(shot.name, 'pageerror', e.message));
    await page.goto(base + shot.hash);
    await page.waitForTimeout(2500);
    if (shot.after) await shot.after(page).catch(e => console.error(shot.name, e.message));
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(out, `${shot.name}.png`) });
    console.log('saved', shot.name);
    await ctx.close();
  }
  await browser.close();
  server.close();
})();
