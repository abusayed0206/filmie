#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod downloads;
mod keys;
mod trakt;

use serde_json::{Value, json};
use std::collections::BTreeMap;
use tauri::{Manager, Theme, Url, WebviewUrl, WebviewWindowBuilder, webview::NewWindowResponse, window::Color};
use tauri_plugin_opener::OpenerExt;

const INJECT_PLAYER: &str = r##"
(() => {
  const top = (() => { try { return window.top === window; } catch { return false; } })();
  if (top || !/^https?:$/.test(location.protocol) || location.hostname === 'tauri.localhost') return;
  // Trailers. YouTube's terms forbid changing its player, and this script clicks settings menus and removes nodes.
  if (/(^|\.)youtube(-nocookie)?\.com$/.test(location.hostname)) return;

  const adSrc = /(doubleclick\.net|googlesyndication\.com|googleadservices\.com|adservice\.google|popads|popcash|propellerads|onclickads|adsterra|highperformanceformat|juicyads|exoclick|trafficjunky|revcontent|mgid\.com|taboola\.com|outbrain\.com)/i;
  const adNode = '[id*="ad-overlay" i],[class*="ad-overlay" i],[id*="ad-banner" i],[class*="ad-banner" i],[id^="div-gpt-ad" i],[id^="google_ads" i],[class*="adsbygoogle" i],[data-ad-slot],[data-ad-client],[aria-label*="advertisement" i]';
  const drop = root => {
    try {
      root.querySelectorAll('iframe').forEach(f => { if (adSrc.test(f.src || '')) f.remove(); });
      root.querySelectorAll(adNode).forEach(el => el.remove());
    } catch {}
  };
  const watchAds = () => {
    drop(document);
    try {
      new MutationObserver(ms => {
        for (const m of ms) for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.tagName === 'IFRAME' && adSrc.test(n.src || '')) { n.remove(); continue; }
          if (n.matches && n.matches(adNode)) { n.remove(); continue; }
          drop(n);
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
    } catch {}
  };
  const rootReady = fn => {
    if (document.documentElement) return fn();
    try {
      const mo = new MutationObserver(() => { if (document.documentElement) { mo.disconnect(); fn(); } });
      mo.observe(document, { childList: true });
    } catch {}
  };
  rootReady(watchAds);
  document.addEventListener('DOMContentLoaded', () => drop(document), { once: true });

  let quality = '1080p';
  let probe = false; // a hidden frame in the app's server race: kept muted, and only reports its video height
  let capture = false; // a hidden frame finding a video to download: also reports the video's address

  // Download capture. Addresses seen before the app asks are kept, since the playlist often loads first.
  const seenMedia = [];
  const seenUrls = new Set();
  const reportMedia = m => {
    if (m.url) { if (seenUrls.has(m.url)) return; seenUrls.add(m.url); }
    m.page = location.href;
    if (capture) { try { window.top.postMessage({ __filmieMedia: m }, '*'); } catch {} }
    else if (seenMedia.length < 50) seenMedia.push(m);
  };
  try {
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        const kind = /\.m3u8(?:[?#]|$)/i.test(e.name) ? 'hls' : /\.mpd(?:[?#]|$)/i.test(e.name) ? 'dash' : null;
        if (kind && /^https?:/.test(e.name) && !adSrc.test(e.name)) reportMedia({ url: e.name, kind });
      }
    }).observe({ type: 'resource', buffered: true });
  } catch {}
  // A key-system (EME) request means media that can't be saved offline. The call itself is unchanged.
  try {
    const keys = navigator.requestMediaKeySystemAccess;
    if (keys) navigator.requestMediaKeySystemAccess = function (...a) { reportMedia({ drm: true }); return keys.apply(this, a); };
  } catch {}
  let applied = null;
  let timer = null;
  let tickN = 0;
  let uiN = 0;
  const target = () => quality === 'auto' ? 0 : +quality.replace(/p$/i, '');
  const visible = el => {
    try {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 1 && r.height > 1 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
    } catch { return false; }
  };
  const label = el => (el.getAttribute?.('aria-label') || el.title || el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  const deep = (root, sel, out = []) => {
    try { root.querySelectorAll(sel).forEach(e => out.push(e)); } catch {}
    try { root.querySelectorAll('*').forEach(e => { if (e.shadowRoot) deep(e.shadowRoot, sel, out); }); } catch {}
    return out;
  };
  const click = el => {
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      try { el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })); } catch {}
    }
    try { el.click(); } catch {}
  };
  let autoDone = false;
  const autoPlay = () => {
    if (autoDone) return;
    try {
      const v = [...document.querySelectorAll('video')].find(x => x.readyState > 0);
      if (v) {
        if (!v.paused) { autoDone = true; return; }
        if (probe) v.muted = true; // probes have no autoplay permission, so only a muted video may start
        const p = v.play();
        if (p && p.then) p.then(() => { autoDone = true; }).catch(() => {});
        else autoDone = true;
        return;
      }
      const b = document.querySelector('#bigPlay, .jw-bigplay');
      if (b && visible(b)) { click(b); autoDone = true; }
    } catch {}
  };
  const startPlay = () => {
    autoPlay();
    setTimeout(autoPlay, 1500);
    setTimeout(autoPlay, 4000);
    setTimeout(autoPlay, 8000);
  };
  rootReady(startPlay);
  const norm = q => {
    const s = String(q ?? '').toLowerCase();
    if (s === 'auto') return 'auto';
    const n = +((s.match(/(\d{3,4})/) || [])[1] || 0);
    if (n >= 2160) return '2160p';
    if (n >= 1080) return '1080p';
    if (n >= 720) return '720p';
    if (n >= 480) return '480p';
    return '1080p';
  };
  const levels = p => {
    try { return (p.getQualityLevels() || []).map((l, i) => ({ i, h: +l.height || +((String(l.label || '').match(/(\d{3,4})/) || [])[1] || 0), a: /auto/i.test(String(l.label || '')), label: String(l.label || '') })); } catch { return []; }
  };
  const best = (ls, h) => {
    const exact = ls.find(l => !l.a && (l.h === h || new RegExp('^' + h + 'p?$', 'i').test(l.label)));
    if (exact) return exact.i;
    const hs = ls.filter(l => !l.a && l.h > 0);
    if (!hs.length) return -1;
    const lower = hs.filter(l => l.h <= h).sort((a, b) => b.h - a.h)[0];
    return (lower || hs.sort((a, b) => a.h - b.h)[0]).i;
  };
  const jw = () => {
    try {
      const f = window.jwplayer;
      if (typeof f !== 'function') return null;
      const p = f();
      return p && typeof p.getQualityLevels === 'function' ? p : null;
    } catch { return null; }
  };
  const apply = () => {
    if (quality === 'auto' || applied === quality) return true;
    const p = jw();
    if (p) {
      const ls = levels(p);
      if (!ls.length) return false;
      const i = best(ls, target());
      if (i < 0) return false;
      let cur = null; try { cur = p.getCurrentQuality(); } catch {}
      if (cur !== i) { try { p.setCurrentQuality(i); } catch {} }
      applied = quality;
      return true;
    }
    if (uiN >= 3) return false;
    const h = target();
    const opt = deep(document, 'button,[role="option"],[role="menuitemradio"],[role="menuitem"],li,a').find(el => visible(el) && !/auto/i.test(label(el)) && new RegExp('^' + h + 'p?$', 'i').test(label(el)));
    if (opt) {
      click(opt.closest('button,[role="option"],[role="menuitemradio"],[role="menuitem"],[tabindex],li') || opt);
      applied = quality;
      return true;
    }
    const q = deep(document, 'button,[role="button"],[aria-label],[tabindex]').find(el => visible(el) && /^(quality|settings)$/i.test(label(el)));
    if (q) { uiN++; click(q.closest('button,[role="button"],[tabindex]') || q); return false; }
    return false;
  };
  const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
  const tick = () => {
    tickN++;
    if (quality === 'auto' || applied === quality) { stop(); return; }
    if (apply()) { stop(); return; }
    if (tickN >= 40) stop();
  };
  const start = () => {
    if (timer || quality === 'auto' || applied === quality) return;
    timer = setInterval(tick, 750);
    setTimeout(tick, 800);
  };
  const relay = q => {
    try {
      document.querySelectorAll('iframe').forEach(f => {
        try { f.contentWindow.postMessage({ __filmieQuality: q }, '*'); } catch {}
        if (probe) try { f.contentWindow.postMessage({ __filmieProbe: 1 }, '*'); } catch {}
        if (capture) try { f.contentWindow.postMessage({ __filmieCapture: 1 }, '*'); } catch {}
      });
    } catch {}
  };
  const watchFrames = () => {
    try {
      document.querySelectorAll('iframe').forEach(f => {
        if (f.__filmieQ) return;
        f.__filmieQ = 1;
        f.addEventListener('load', () => relay(quality));
      });
      new MutationObserver(ms => {
        for (const m of ms) for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.tagName === 'IFRAME') { if (!n.__filmieQ) { n.__filmieQ = 1; n.addEventListener('load', () => relay(quality)); } }
          else if (n.querySelectorAll) n.querySelectorAll('iframe').forEach(f => { if (!f.__filmieQ) { f.__filmieQ = 1; f.addEventListener('load', () => relay(quality)); } });
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
    } catch {}
  };
  rootReady(watchFrames);

  // Reports playback to the app for its local "Recently played" list. Short videos are usually ads.
  let reported = -1;
  setInterval(() => {
    try {
      const list = document.querySelectorAll('video');
      const videos = list.length ? [...list] : deep(document, 'video');
      const v = videos.filter(x => Number.isFinite(x.duration) && x.duration >= 60).sort((a, b) => b.duration - a.duration)[0];
      if (probe || !v || v.currentTime < 1 || v.currentTime === reported) return;
      reported = v.currentTime;
      window.top.postMessage({ __filmieProgress: { t: v.currentTime, d: v.duration } }, '*');
    } catch {}
  }, 5000);

  // Reports the tallest main video to the app, which races its servers on it.
  let tallest = 0;
  let heightTicks = 0;
  setInterval(() => {
    // Every second through the race, then every 5 so idle frames don't walk their DOM forever.
    if (++heightTicks > 30 && heightTicks % 5) return;
    try {
      const list = document.querySelectorAll('video');
      const videos = list.length ? [...list] : deep(document, 'video');
      if (probe) videos.forEach(x => { x.muted = true; });
      const v = videos.filter(x => Number.isFinite(x.duration) && x.duration >= 60).sort((a, b) => b.duration - a.duration)[0];
      if (!v) return;
      // A plain file plays straight from its address; a blob: address is a stream, found by its playlist instead.
      if (capture && /^https?:/.test(v.currentSrc || '')) reportMedia({ url: v.currentSrc, kind: 'file' });
      const p = jw();
      const h = Math.max(v.videoHeight || 0, ...(p ? levels(p).map(l => l.h) : []));
      if (h <= tallest) return;
      tallest = h;
      window.top.postMessage({ __filmieVideo: { h } }, '*');
    } catch {}
  }, 1000);

  window.addEventListener('message', e => {
    const d = e.data;
    if (d && typeof d === 'object' && d.__filmieProbe && !probe) { probe = true; relay(quality); return; }
    if (d && typeof d === 'object' && d.__filmieCapture && !capture) {
      probe = capture = true;
      relay(quality);
      seenMedia.splice(0).forEach(m => { try { window.top.postMessage({ __filmieMedia: m }, '*'); } catch {} });
      return;
    }
    if (!d || typeof d !== 'object' || !('__filmieQuality' in d)) return;
    const q = norm(d.__filmieQuality);
    if (q !== quality) { quality = q; applied = null; tickN = 0; uiN = 0; stop(); }
    relay(q);
    if (q === 'auto') { applied = 'auto'; stop(); return; }
    start();
  });
  setTimeout(() => { if (!applied) start(); }, 1000);
})();
"##;

// Every pop-up is denied. Only links to these sites open, in the system browser.
const EXTERNAL_HOSTS: &[&str] =
    &["imdb.com", "letterboxd.com", "trakt.tv", "themoviedb.org", "rottentomatoes.com", "metacritic.com", "youtube.com", "myanimelist.net"];

fn is_external_allowed(url: &Url) -> bool {
    url.scheme() == "https" && url.host_str().is_some_and(|h| EXTERNAL_HOSTS.iter().any(|d| h == *d || h.ends_with(&format!(".{d}"))))
}

fn is_app_page(url: &Url) -> bool {
    url.host_str() == Some("tauri.localhost")
}

/// What a response seen by WebView2 could be downloaded as: a playlist, or a whole video file big enough not to be
/// an ad or one segment of a stream. Filmie's own pages are left out.
fn media_kind(url: &str, content_type: &str, size: u64) -> Option<&'static str> {
    let parsed = Url::parse(url).ok()?;
    if !["http", "https"].contains(&parsed.scheme()) || parsed.host_str().is_some_and(|h| h.ends_with(".localhost")) {
        return None;
    }
    let path = parsed.path().to_ascii_lowercase();
    let ct = content_type.to_ascii_lowercase();
    if ct.contains("mpegurl") || path.ends_with(".m3u8") {
        Some("hls")
    } else if ct.contains("dash+xml") || path.ends_with(".mpd") {
        Some("dash")
    } else if (ct.starts_with("video/mp4") || ct.starts_with("video/webm") || ct.starts_with("video/x-matroska")) && size >= 50 << 20 {
        Some("file")
    } else {
        None
    }
}

/// Reports every playlist or video file any frame loads, as a `media-seen` event. The injected script sees most of
/// them first; this also catches requests it can't, like those made from a worker.
#[cfg(windows)]
fn watch_media(window: &tauri::WebviewWindow) {
    use tauri::Emitter;
    let app = window.app_handle().clone();
    let _ = window.with_webview(move |wv| unsafe {
        use webview2_com::{Microsoft::Web::WebView2::Win32::*, WebResourceResponseReceivedEventHandler, take_pwstr};
        use windows::core::{Interface, PWSTR, w};
        let Some(core) = wv.controller().CoreWebView2().ok().and_then(|c| c.cast::<ICoreWebView2_2>().ok()) else { return };
        let handler = WebResourceResponseReceivedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };
            let request = args.Request()?;
            let mut uri = PWSTR::null();
            request.Uri(&mut uri)?;
            let url = take_pwstr(uri);
            let headers = args.Response()?.Headers()?;
            let header = |name| {
                let mut value = PWSTR::null();
                headers.GetHeader(name, &mut value).ok().map(|_| take_pwstr(value)).unwrap_or_default()
            };
            let content_type = header(w!("content-type"));
            // A range response states the whole file's size after the slash.
            let size = header(w!("content-range"))
                .rsplit('/')
                .next()
                .and_then(|n| n.parse().ok())
                .or_else(|| header(w!("content-length")).parse().ok());
            if let Some(kind) = media_kind(&url, &content_type, size.unwrap_or(0)) {
                let mut referer = PWSTR::null();
                let referer =
                    request.Headers()?.GetHeader(w!("referer"), &mut referer).ok().map(|_| take_pwstr(referer)).unwrap_or_default();
                let _ = app.emit("media-seen", json!({ "url": url, "referer": referer, "kind": kind }));
            }
            Ok(())
        }));
        let mut token = 0i64;
        if let Err(e) = core.add_WebResourceResponseReceived(&handler, &mut token) {
            eprintln!("no WebView2 network events: {e}");
        }
    });
}

async fn tmdb_fetch(s: &trakt::State, path: &str, query: &BTreeMap<String, String>) -> Result<Value, String> {
    let res = s
        .http
        .get(format!("https://api.themoviedb.org/3{path}"))
        .query(&[("api_key", keys::TMDB.as_str())])
        .query(query)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status();
    trakt::log_request("tmdb", "GET", status.as_u16(), path);
    let body: Value = res.json().await.map_err(|e| e.to_string())?;
    if status.is_success() {
        Ok(body)
    } else {
        Err(format!("{} TMDB: {}", status.as_u16(), body["status_message"].as_str().unwrap_or("request failed")))
    }
}

#[tauri::command]
async fn tmdb(s: tauri::State<'_, trakt::State>, path: String, query: Option<BTreeMap<String, String>>) -> Result<Value, String> {
    if !path.starts_with('/') {
        return Err("bad path".into());
    }
    let query = query.unwrap_or_default();
    // Airing shows gain episodes; a movie's details rarely change. TMDB's terms allow caching for up to 6 months.
    let ttl = if path.starts_with("/movie/") { 7 * 86_400 } else { 86_400 };
    // The key leaves out the API key, and BTreeMap keeps the query in a stable order.
    let key = format!("tmdb {path} {}", serde_json::to_string(&query).map_err(|e| e.to_string())?);
    s.db.through(&key, ttl, false, tmdb_fetch(&s, &path, &query)).await
}

/// All a card draws from TMDB's record for a title.
fn art_of(d: &Value) -> Value {
    json!({
        "poster": d["poster_path"].as_str().or(d["profile_path"].as_str()),
        "backdrop": d["backdrop_path"].as_str(),
        "logo": d["images"]["logos"][0]["file_path"].as_str(),
    })
}

/// Artwork for a card. Pictures rarely change, so one small entry lasts a month, whichever kind of card asks,
/// where storing the whole record for each card cost a request a day per show and many times the disk space.
#[tauri::command]
async fn art(s: tauri::State<'_, trakt::State>, kind: String, id: u64) -> Result<Value, String> {
    if !["movie", "tv", "person"].contains(&kind.as_str()) {
        return Err("bad art kind".into());
    }
    let query = BTreeMap::from([
        ("append_to_response".to_string(), "images".to_string()),
        ("include_image_language".to_string(), "en,null".to_string()),
    ]);
    let path = format!("/{kind}/{id}");
    let fetch = async {
        match tmdb_fetch(&s, &path, &query).await {
            Ok(d) => Ok(art_of(&d)),
            // Gone from TMDB, so remember that rather than asking again for every card.
            Err(e) if e.starts_with("404") => Ok(json!({})),
            Err(e) => Err(e),
        }
    };
    s.db.through(&format!("art {kind} {id}"), 30 * 86_400, false, fetch).await
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            keyring_core::set_default_store(windows_native_keyring_store::Store::new()?);
            let data_dir = match trakt::test_dir() {
                Some(dir) => dir,
                None => app.path().app_data_dir()?,
            };
            std::fs::create_dir_all(&data_dir)?;
            app.manage(trakt::State::new(data_dir.join("library.json"), db::Db::open(data_dir.join("filmie.sqlite3"))));
            app.manage(downloads::Downloads::default());
            downloads::allow_finished(app.handle());

            let handle = app.handle().clone();
            let mut window = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Filmie")
                .inner_size(1280.0, 820.0)
                .min_inner_size(800.0, 500.0)
                // Matches --bg in style.css, so the window never flashes white or gets a light title bar.
                .background_color(Color(21, 20, 24, 255))
                .theme(Some(Theme::Dark))
                // shortcut: browser accelerator keys (reload, find) stay on, turning them off needs webview2-com through with_webview.
                .initialization_script_for_all_frames(INJECT_PLAYER)
                // Stops embedded players from redirecting the whole app to an ad.
                .on_navigation(is_app_page)
                .on_new_window(move |url, _| {
                    if is_external_allowed(&url) {
                        let _ = handle.opener().open_url(url.as_str(), None::<&str>);
                    }
                    NewWindowResponse::Deny
                });
            let extensions = app.path().resource_dir().ok().map(|p| p.join("extensions")).filter(|p| p.is_dir()).or_else(|| {
                let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("extensions");
                p.is_dir().then_some(p)
            });
            if let Some(extensions) = extensions {
                window = window.browser_extensions_enabled(true).extensions_path(extensions);
            }
            let window = window.build()?;
            #[cfg(windows)]
            watch_media(&window);
            #[cfg(not(windows))]
            let _ = window;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            tmdb,
            art,
            trakt::trakt,
            trakt::device_start,
            trakt::device_poll,
            trakt::sign_out,
            trakt::status,
            trakt::sync,
            trakt::library,
            trakt::avatar,
            trakt::history_sync,
            db::history_save,
            db::history_list,
            db::history_clear,
            db::cache_info,
            db::cache_clear,
            db::stats,
            downloads::download_folder,
            downloads::download_folder_pick,
            downloads::download_probe,
            downloads::download_list,
            downloads::download_add,
            downloads::download_next,
            downloads::download_start,
            downloads::download_fail,
            downloads::download_remove
        ])
        .run(tauri::generate_context!())
        .expect("error while running Filmie");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn art_keeps_only_what_a_card_draws() {
        let movie = json!({ "title": "x", "poster_path": "/p.jpg", "backdrop_path": "/b.jpg", "images": { "logos": [{ "file_path": "/l.png" }, { "file_path": "/m.png" }] } });
        assert_eq!(art_of(&movie), json!({ "poster": "/p.jpg", "backdrop": "/b.jpg", "logo": "/l.png" }));
        assert_eq!(art_of(&json!({ "profile_path": "/f.jpg" })), json!({ "poster": "/f.jpg", "backdrop": null, "logo": null }));
        assert_eq!(
            art_of(&json!({ "poster_path": null, "images": { "logos": [] } })),
            json!({ "poster": null, "backdrop": null, "logo": null })
        );
    }

    #[test]
    fn external_links_allowlist() {
        let ok = |u: &str| is_external_allowed(&Url::parse(u).unwrap());
        assert!(ok("https://www.imdb.com/title/tt0372784/"));
        assert!(ok("https://letterboxd.com/tmdb/272/"));
        assert!(ok("https://auth.trakt.tv/activate"));
        assert!(!ok("http://www.imdb.com/")); // https only
        assert!(!ok("https://evilimdb.com/")); // suffix must be a real subdomain
        assert!(!ok("https://imdb.com.evil.io/"));
        assert!(!ok("https://ads.example.com/pop"));
    }

    #[test]
    fn media_responses_worth_downloading() {
        assert_eq!(media_kind("https://cdn.example.com/v/master.m3u8?t=1", "", 0), Some("hls"));
        assert_eq!(media_kind("https://cdn.example.com/v/x", "application/vnd.apple.mpegurl", 0), Some("hls"));
        assert_eq!(media_kind("https://cdn.example.com/v/x", "application/dash+xml", 0), Some("dash"));
        assert_eq!(media_kind("https://cdn.example.com/film.mp4", "video/mp4", 900 << 20), Some("file"));
        assert_eq!(media_kind("https://ads.example.com/ad.mp4", "video/mp4", 2 << 20), None, "too small to be the film");
        assert_eq!(media_kind("https://cdn.example.com/seg1.ts", "video/mp2t", 0), None, "a segment");
        assert_eq!(media_kind("http://tauri.localhost/index.html", "text/html", 0), None);
        assert_eq!(media_kind("http://asset.localhost/D%3A/a/index.m3u8", "", 0), None, "Filmie's own downloads");
        assert_eq!(media_kind("blob:https://x/1", "", 0), None);
    }

    #[test]
    fn only_app_pages_navigate() {
        assert!(is_app_page(&Url::parse("http://tauri.localhost/index.html").unwrap()));
        assert!(!is_app_page(&Url::parse("https://ads.example.com/").unwrap()));
    }
}
