# Website screenshots

`shoot.js` renders the real `ui/` in Chromium with `mock.js` standing in for the Tauri commands. All titles, people and artwork are invented, and posters are generated SVGs, so the screenshots show no TMDB or Trakt artwork.

```bash
node scripts/site-shots/shoot.js . /tmp/shots            # every screenshot, as 2880x1800 PNGs
node scripts/site-shots/shoot.js . /tmp/shots home title # only some
```

It needs Playwright (`npm i -g playwright`, or set `NODE_PATH` to where it's installed). The site uses WebP at two widths:

```bash
python3 -c "
from PIL import Image
for n in ['home','title','player','profile','palette','filters','discover']:
  im = Image.open(f'/tmp/shots/{n}.png').convert('RGB')
  for w in (1440, 960): im.resize((w, w * 5 // 8), Image.LANCZOS).save(f'site/public/shots/{n}-{w}.webp', quality=80, method=6)
"
```

`mock.js` only covers the commands and Trakt paths these pages call. A new page or endpoint may need an entry there.
