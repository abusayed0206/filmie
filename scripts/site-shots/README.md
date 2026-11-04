# Website screenshots

The website and README use screenshots of the real app, signed in to a real Trakt account. `capture.mjs` takes them from a running debug build over the DevTools protocol, with no extra dependencies (Node 22 or later).

1. Close Filmie, then start a debug build with its own data folder and WebView2 profile. `FILMIE_DATA_DIR` makes the debug build refuse Trakt writes, so nothing changes on the account.

   ```bash
   cd src-tauri && cargo build
   FILMIE_DATA_DIR=/tmp/filmie-data WEBVIEW2_USER_DATA_FOLDER=/tmp/filmie-wv \
     WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 ./target/debug/filmie.exe
   ```

2. Set the wide rail and, for the player shot, a trailer as the only server (Filmie ships with no video servers), then reload:

   ```bash
   node scripts/site-shots/capture.mjs eval "localStorage.setItem('rail','wide'); localStorage.setItem('mode','media'); localStorage.setItem('sources', JSON.stringify([{name:'Trailers', movie:'https://www.youtube-nocookie.com/embed/bR2i8-z_fvc', tv:'https://www.youtube-nocookie.com/embed/bR2i8-z_fvc'}])); location.reload()"
   ```

3. Wait until Profile no longer says it's copying your Trakt history, then go to each page and save it:

   | Name | Steps |
   |---|---|
   | `home` | `location.hash='#/'` |
   | `discover` | `location.hash='#/discover'` |
   | `title` | `location.hash='#/title/tv/60622'` |
   | `player` | `location.hash='#/play/tv/60622/3/1'`, then `document.querySelector('#episode-btn').click()` |
   | `profile` | `location.hash='#/profile'` |
   | `palette` | On Home, dispatch Ctrl+K, then type into the focused input |
   | `filters` | On Discover, `document.querySelector('#filter-btn').click()` |

   ```bash
   node scripts/site-shots/capture.mjs eval "location.hash='#/discover'"
   node scripts/site-shots/capture.mjs shot /tmp/shots/discover.png
   ```

4. Convert to WebP at two widths, and make the social image from Home:

   ```bash
   python3 -c "
   from PIL import Image
   for n in ['home','title','player','profile','palette','filters','discover']:
     im = Image.open(f'/tmp/shots/{n}.png').convert('RGB')
     for w in (1440, 960): im.resize((w, w * 5 // 8), Image.LANCZOS).save(f'site/public/shots/{n}-{w}.webp', quality=82, method=6)
   im = Image.open('/tmp/shots/home.png').convert('RGB').resize((1440, 900), Image.LANCZOS)
   im.crop((0, 0, 1440, 756)).resize((1200, 630), Image.LANCZOS).save('site/public/og.png', optimize=True)
   "
   ```

## Mocked screenshots

`shoot.js` renders `ui/` in Chromium with `mock.js` standing in for the Tauri commands, with invented titles and generated posters. It needs no account or keys, so use it when real data isn't wanted.

```bash
node scripts/site-shots/shoot.js . /tmp/shots            # every screenshot, as 2880x1800 PNGs
node scripts/site-shots/shoot.js . /tmp/shots home title # only some
```

It needs Playwright (`npm i -g playwright`, or set `NODE_PATH` to where it's installed). `mock.js` only covers the commands and Trakt paths these pages call, so a new page or endpoint may need an entry there.
