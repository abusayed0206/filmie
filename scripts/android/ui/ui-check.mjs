// Renders ui/ at a 390x844 phone viewport with mocked Tauri data and saves screenshots.
// Run: npm --prefix scripts/android/ui run check
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const ui = path.join(repo, 'ui');
const out = path.join(repo, 'artifacts/ui-phone');
fs.mkdirSync(out, { recursive: true });
const mock = fs.readFileSync(path.join(repo, 'scripts/site-shots/mock.js'), 'utf8');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' };

// Same deterministic artwork as scripts/site-shots/shoot.js.
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
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>${sun}${hills}</svg>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const file = path.join(ui, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
  if (!file.startsWith(ui) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const SHOTS = [
  ['home', '#/'],
  ['discover', '#/discover'],
  ['title', '#/title/tv/1000'],
  ['settings', '#/settings'],
  ['search', '#/search'],
  ['lists', '#/lists'],
];

let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
} catch (error) {
  console.error('Could not launch Microsoft Edge. Install Edge, or install Playwright Chromium with: npx playwright install chromium');
  console.error(error.message);
  process.exit(1);
}

await new Promise(resolve => server.listen(0, resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
let failed = false;

for (const [name, hash] of SHOTS) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark',
  });
  await context.route('https://image.tmdb.org/**', route => {
    const file = new URL(route.request().url()).pathname.split('/').pop();
    return route.fulfill({ contentType: 'image/svg+xml', body: art(file) });
  });
  await context.addInitScript(mock);
  await context.addInitScript(() => {
    localStorage.setItem('mode', 'media');
    localStorage.setItem('rail', 'narrow');
  });

  const page = await context.newPage();
  page.on('pageerror', error => {
    failed = true;
    console.error(`${name}: ${error.message}`);
  });
  await page.goto(base + hash);
  await page.waitForTimeout(2500);
  const file = path.join(out, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`${name}: ${file}`);
  await context.close();
}

await browser.close();
server.close();
if (failed) process.exitCode = 1;
