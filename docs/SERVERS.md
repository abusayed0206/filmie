# Video servers

Filmie includes no video servers. This page records the server list used for testing, its exact copyable form, and what the app does when it captures and saves a video from each one. Last tested on 2026-11-11 with the debug build (`0.2.1`), WebView2 157 and ffmpeg 9.0.2.

## Copyable list

Open **Settings → Video servers → Edit as text**, paste the whole block, then press **Save text**. The format is one server per line:

```
Name | movie URL | TV URL | note | #rrggbb accent
```

The movie URL must contain `{tmdb_id}`. The TV URL must contain `{tmdb_id}`, `{season}` and `{episode}`. The note and accent are optional; a note can't contain `|`. Accents are `#rrggbb` only.

```text
Rakan | https://vixsrc.to/movie/{tmdb_id}?autoPlay=true&lang=en | https://vixsrc.to/tv/{tmdb_id}/{season}/{episode}?autoPlay=true&lang=en | VixSrc · maxes out at 720p. | #e5484d
Xayah | https://vidsrc.sh/embed/movie?tmdb={tmdb_id}&autoplay=1 | https://vidsrc.sh/embed/tv?tmdb={tmdb_id}&season={season}&episode={episode}&autoplay=1 | VidSrc · maxes out at 800p. | #8b5cf6
Ekko | https://cinesrc.st/embed/movie/{tmdb_id}?autoPlay=true | https://cinesrc.st/embed/tv/{tmdb_id}?s={season}&e={episode}&autoPlay=true | CineSrc · has 1080p. | #22c55e
Naafiri | https://vidfast.vc/movie/{tmdb_id}?autoPlay=true | https://vidfast.vc/tv/{tmdb_id}/{season}/{episode}?autoPlay=true | VidFast · has 1080p and 4K. | #06b6d4
```

These four save offline copies. Bard (`moviesapi.to`) and Ryze (`vidlink.pro`) can still be added for playback, but they stream DASH and their downloads fail (see below), so they are left out of this list.

The radio button in the list picks the default server. A download checks that server first, then every other server, and stops at the first HLS playlist whose tallest variant reaches the download quality. If none reaches it, the best height seen is used, so a 720p server is still saved when no 1080p server works.

## How a download works

Downloads have two halves: the webview finds a playable address, and Rust saves it.

### 1. Finding the video (capture)

`captureMedia` in `ui/downloads.js` loads each server's page in a hidden, muted iframe (`captureFrom`), so the server's own player runs exactly as it would during playback. The page and its nested frames receive `{ __filmieCapture: 1 }` by `postMessage`, and `INJECT_PLAYER` (`src-tauri/src/main.rs`) replies with `{ __filmieMedia: { url, kind, page } }` for each playlist or video file it sees in resource timing and `<video>.currentSrc`. Reports are only accepted from inside the capture frame, and a request for an EME key system is reported as `{ drm: true }`.

`watch_media` in `src-tauri/src/main.rs` adds WebView2's own network events as a fallback (`media-seen`). That fallback can't tell which frame asked, so it only counts while nothing else is playing. The injected script's reports always count.

`pickCapture` in `ui/lib.js` ranks what was found: HLS first, then DASH, then a whole file. A DRM report with no playlist (or only a whole file) marks the item protected. After the first usable find the capture waits 2.5 seconds for a master playlist and its variants to arrive (5 seconds on a DRM report), and gives up after 25 seconds.

Once a server yields an HLS address, `captureMedia` sends it to the `download_probe` command, which fetches the playlist with the same headers and returns the tallest `RESOLUTION` it lists. The check is sequential: the selected server is first, and every server is tried until one reaches the requested height. With `auto`, every server is checked and the tallest one is kept. Probes add one small request per server and never download a segment.

The reported `page` becomes the `Referer` for every request Rust makes, with its origin as `Origin` and the webview's user agent as `User-Agent`. Webview cookies are not forwarded. Addresses are usually tokenised and short-lived, which is why each item is captured just before it starts, one item at a time (`pumpDownloads`).

### 2. Saving it

`download_start` in `src-tauri/src/downloads.rs` hands the address to `run`, which decides what it is from the first bytes:

- **HLS.** The master playlist is parsed, a variant is chosen, separate audio is fetched, and each media playlist is rewritten to point at local files. Segments download four at a time, with up to three retries each and resumable `.part` files. Afterwards ffmpeg copies the result into `video.mp4` when it is installed and succeeds; otherwise the segments and `index.m3u8` stay and play through the bundled hls.js.
- **DASH.** The MPD is fetched by Rust (with the same headers), `ContentProtection` is refused, and ffmpeg is asked to save the stream to `video.mp4`. ffmpeg is required for DASH.
- **Whole file.** An `.mp4`/`.mkv`/`.webm` and similar is streamed straight to `video.<ext>`.

Files go in `<download folder>/<Title (tmdb id)>/Movie/` or `.../S01E02/`. Cancelling deletes the partial item. A failure keeps its parts so a retry can resume; a protected item keeps nothing. The folder can't be on the Windows drive.

## Server by server

The chains below are what the player actually loaded during the test, not what the page source suggests. Times are warm captures.

### Rakan — vixsrc.to

- **Pages:** `/movie/{tmdb_id}?autoPlay=true&lang=en`, `/tv/{tmdb_id}/{season}/{episode}?autoPlay=true&lang=en`
- **Chain:** page → `/embed/<file id>?token=…` → `/playlist/<file id>?token=…&h=1&lang=en` (an HLS master)
- **Stream:** HLS. Master offers `1280x720` at 1.8 Mbps and `854x480` at 1.08 Mbps, with a separate audio group (`AUDIO="audio"`) and a subtitle group (`SUBTITLES="subs"`). Audio is saved; subtitles are not.
- **Keys:** media playlists carry `#EXT-X-KEY:METHOD=AES-128,URI="/storage/enc.key",IV=0x…` per segment. Filmie saves the key beside the segments and rewrites the playlist, so AES-128 works in every build. Playlists that need a DRM key system, `SAMPLE-AES`, or a non-identity `KEYFORMAT` are still refused.
- **Capture:** about 3.2–3.4 s.
- **Download:** a full 480p episode (Breaking Bad S1E1, 58 minutes) downloaded as 348 MB and was remuxed to `video.mp4` (H.264 480p, AAC stereo); it played from the Downloads page with no error. The key and the local playlists were part of that run.
- **Notes:** the playlist and key are tokenised, so the whole chain expires; capture has to happen immediately before the download.

### Bard — moviesapi.to

- **Pages:** `/movie/{tmdb_id}`, `/tv/{tmdb_id}-{season}-{episode}`
- **Chain:** page → player frame on `cdn.vidspark.to` → DASH manifest through a `workers.dev/dash-mpd?blob=…&filename=index_web.mpd` proxy
- **Stream:** DASH only. HEVC (`hev1`) video at `1920x1080` (1.6 Mbps), `1280x720` (916 kbps) and `854x480` (500 kbps), plus AAC 128 kbps audio. The MPD has a `BaseURL` under `/dash-seg/…` on the same proxy.
- **Protection:** none found; no `ContentProtection`.
- **Capture:** about 5–8 s.
- **Download:** capture works, but the item fails with `ffmpeg couldn't save this stream.` Rust can fetch the MPD with `Referer`/`Origin`/UA, but ffmpeg's DASH demuxer fails to open the same manifest with `Unable to read to manifest`, even when `-headers` is passed. A local-manifest plus localhost header-proxy attempt was tried and removed; it failed inside WebView2 with `WSAECONNABORTED` (-10053).
- **Notes:** this is a player-level block, not a DRM or capture problem. The download quality setting is not applied on the DASH path; ffmpeg picks the stream. Downloads from Bard are unsupported.

### Xayah — vidsrc.sh

- **Pages:** `/embed/movie?tmdb={tmdb_id}&autoplay=1`, `/embed/tv?tmdb={tmdb_id}&season={season}&episode={episode}&autoplay=1`
- **Chain:** page → nested player on `stellarconductornexus.com/embed/player/…?vs=…` → master playlist on `sageandsolstice.space/pl/<blob>/master.m3u8?token=<JWT>`
- **Stream:** HLS master with `640x266`, `1280x534` and `1920x800` renditions. Clear: no keys.
- **Capture:** about 5.5–13.2 s, the slowest of the set.
- **Download:** starts and transfers normally. The tested 800p copy was ~1.5 GB and downloaded at several MB/s; it was cancelled and deleted after the check.
- **Notes:** there is no 1080p rendition, so the download quality setting picks 800p at `1080p`, 534p at `720p` and 266p at `480p`.

### Ekko — cinesrc.st

- **Pages:** `/embed/movie/{tmdb_id}?autoPlay=true`, `/embed/tv/{tmdb_id}?s={season}&e={episode}&autoPlay=true`
- **Chain:** page → `cinesrc.st/api/playlist/<token>.m3u8` (an HLS master)
- **Stream:** HLS master with `1920x1080` at 4.69 Mbps and `1280x720` at 2.63 Mbps. Clear: no keys.
- **Capture:** about 3.5 s.
- **Download:** starts normally; ~330 MB of ~2.9 GB in 12 s (~27 MB/s), cancelled and deleted.
- **Notes:** there is no 480p variant, so a 480p download falls back to 720p (the shortest available). That makes an offline copy noticeably large.

### Naafiri — vidfast.vc

- **Pages:** `/movie/{tmdb_id}?autoPlay=true`, `/tv/{tmdb_id}/{season}/{episode}?autoPlay=true`
- **Chain:** page → master playlist on `moon.goldenkite.top/vd/<blob>/master.m3u8?s=<signature>`
- **Stream:** HLS master with `3840x2160` (16.2 Mbps), `1920x1080` (6.2 Mbps), `1280x720` (3.1 Mbps) and `852x480` (1.3 Mbps). Clear: no keys.
- **Capture:** about 3.7–5.7 s.
- **Download:** starts normally; ~257 MB of ~1.47 GB in 12 s (~21 MB/s). 480p is honoured.
- **Notes:** the only tested server that actually offers 4K. Use 1080p or lower for offline copies.

### Ryze — vidlink.pro

- **Pages:** `/movie/{tmdb_id}?title=true&poster=true&autoplay=true&player=jw`, `/tv/{tmdb_id}/{season}/{episode}?title=true&poster=true&autoplay=true&nextbutton=true&player=jw`
- **Chain:** page → player frame on `vidlink.pro` → DASH manifest through `surge.flooderrr.store/sacdn/dash/<id>/index_web.mpd?host=…&sc=…`
- **Stream:** DASH, same shape as Bard: HEVC `1920x1080`, `1280x720`, `854x480`, plus AAC audio.
- **Protection:** none found; no `ContentProtection`.
- **Capture:** about 3.8–5.4 s.
- **Download:** fails exactly like Bard, with `ffmpeg couldn't save this stream.`
- **Notes:** the list note says newer titles only. The TV shape was checked with a recent show (The Last of Us, TMDB 100088); an old show is not a useful test. Downloads from Ryze are unsupported.

## Variants and quality

Two different settings exist and they don't share a key:

- **Playback → Preferred quality** (`localStorage` key `quality`) is for the player.
- **Downloads → Download quality** (`localStorage` key `download-quality`) is used by `download_start`.

Both take `auto`, `1080p`, `720p` or `480p`, defaulting to `1080p` when unset or invalid. `auto` means the tallest variant available.

For HLS, `pick_variant` in `src-tauri/src/downloads.rs` reads `RESOLUTION` from each `#EXT-X-STREAM-INF`, chooses the tallest variant at or below the cap, and breaks ties by bandwidth. If every variant is taller than the cap it chooses the shortest, because saving something is better than saving nothing. A single media playlist has no variants to choose from.

Observed variants and what each setting resolves to:

| Server | 2160p | 1080p | 720p | 480p | auto |
|---|---|---|---|---|---|
| Rakan | — | 720p (highest is 720p) | 720p | 480p | 720p |
| Bard | — | download fails | download fails | download fails | download fails |
| Xayah | — | 800p | 534p | 266p | 800p |
| Ekko | — | 1080p | 720p | 720p (fallback) | 1080p |
| Naafiri | 2160p | 1080p | 720p | 480p | 2160p |
| Ryze | — | download fails | download fails | download fails | download fails |

On the DASH path the app passes no height cap to ffmpeg, so ffmpeg's own stream selection applies; in practice the save fails on both tested DASH servers. The app-side quality setting governs HLS.

Separate audio: if a master playlist declares `AUDIO="…"`, Filmie picks the default audio rendition (or the first one) and saves it beside the video. Subtitle renditions are ignored.

## Test summary

| Server | Movie capture | TV capture | Media | Download | Quality honoured |
|---|---|---|---|---|---|
| Rakan | yes | yes | HLS + AES-128 | works | yes |
| Bard | yes | yes | DASH | fails in ffmpeg | no (DASH) |
| Xayah | yes | yes | HLS | works | yes, up to 800p |
| Ekko | yes | yes | HLS | works | yes, falls back to 720p |
| Naafiri | yes | yes | HLS | works | yes |
| Ryze | yes | yes | DASH | fails in ffmpeg | no (DASH) |

Capture was checked with Inception (TMDB 27205) and Breaking Bad S1E1 (TMDB 1396). Ryze's TV shape was checked with The Last of Us S1E1 (TMDB 100088). The latest quality check used `1080p`, Rakan as the selected server, and Inception: Rakan probed at 720p, Xayah at 800p, and Ekko at 1080p, so Ekko was chosen. With only Rakan and Xayah in the list, Xayah's 800p was chosen. A complete Rakan 480p episode download was then run to the `done` state and played offline, which exercised the AES-128 key, the local playlists and the ffmpeg remux. The other servers' transfers were stopped after a few seconds and deleted, so their full-file paths are covered by the same shared code and the Rust tests.

## Known limits

- **DASH servers (Bard, Ryze).** The manifest needs `Referer`/`Origin`/UA. Rust sends them, but ffmpeg's DASH demuxer fails to read the manifest and the save ends with `ffmpeg couldn't save this stream.` A local-manifest plus localhost header-relay prototype worked outside the app, but the same relay inside the app aborted every connection with `WSAECONNABORTED` (-10053), so it was removed. DASH downloads are unsupported for now; playback still works. The refusal of `ContentProtection` and EME-keyed media must stay.
- **DRM-protected media.** Playlists that name an EME key system, use `SAMPLE-AES`/`SAMPLE-AES-CTR`, omit `METHOD`, or carry a non-identity `KEYFORMAT` are marked protected and nothing is saved. AES-128 with an identity key is a normal clear-key HLS encryption and is saved.
- **Quality is a cap and a preference.** If no server reaches the requested height, the best height seen is saved. A whole-file capture has no playlist to probe, so its resolution is unknown and it can't win on height.
- **Probing adds time.** Each checked server costs one extra request for its playlist, on top of its capture. Checking four servers is usually a few seconds, and a server that shows nothing still uses the 25-second capture timeout.
- **Cookies.** Webview cookies aren't forwarded to Rust, so a server that only serves its video with the player's cookies can't be downloaded.
- **Subtitles** are not saved.
- **Expiry.** Playlist, key and segment addresses are tokenised and expire quickly. Each item is captured immediately before it downloads, and a retry starts with a fresh capture.
- **One at a time.** Segments from different items aren't mixed, because a stale address would fail the whole item.

## How the tests were run

A debug build with `FILMIE_DATA_DIR` pointing at a scratch folder (this refuses Trakt writes in the test harness), a fresh WebView2 profile, and `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` to drive the window. The download folder was on `D:` because the Windows drive is refused. Each item was queued through `download_add`, captured through `captureFrom`, started with `download_start`, watched for a few seconds, then removed with `download_remove`. The quality checks wrapped `captureFrom` to record each server's probed height. The scratch data and download folders were deleted afterwards.
