#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod trakt;

use serde_json::Value;
use std::collections::BTreeMap;
use tauri::{Manager, Theme, Url, WebviewUrl, WebviewWindowBuilder, webview::NewWindowResponse, window::Color};
use tauri_plugin_opener::OpenerExt;

const TMDB_KEY: &str = env!("TMDB");

const INJECT_PLAYER: &str = r##"
(() => {
  const top = (() => { try { return window.top === window; } catch { return false; } })();
  if (top || !/^https?:$/.test(location.protocol) || location.hostname === 'tauri.localhost') return;

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
      if (!v || v.currentTime < 1 || v.currentTime === reported) return;
      reported = v.currentTime;
      window.top.postMessage({ __filmieProgress: { t: v.currentTime, d: v.duration } }, '*');
    } catch {}
  }, 5000);

  window.addEventListener('message', e => {
    const d = e.data;
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
const EXTERNAL_HOSTS: &[&str] = &[
    "imdb.com",
    "letterboxd.com",
    "trakt.tv",
    "themoviedb.org",
    "rottentomatoes.com",
    "metacritic.com",
    "youtube.com",
    "justwatch.com",
    "myanimelist.net",
];

fn is_external_allowed(url: &Url) -> bool {
    url.scheme() == "https" && url.host_str().is_some_and(|h| EXTERNAL_HOSTS.iter().any(|d| h == *d || h.ends_with(&format!(".{d}"))))
}

fn is_app_page(url: &Url) -> bool {
    url.host_str() == Some("tauri.localhost")
}

#[tauri::command]
async fn tmdb(s: tauri::State<'_, trakt::State>, path: String, query: Option<BTreeMap<String, String>>) -> Result<Value, String> {
    if !path.starts_with('/') {
        return Err("bad path".into());
    }
    let query = query.unwrap_or_default();
    // Airing shows gain episodes; a movie's details rarely change. TMDB's terms allow caching for up to 6 months.
    let ttl = if path.starts_with("/movie/") { 7 * 86_400 } else { 86_400 };
    let fetch = async {
        let res = s
            .http
            .get(format!("https://api.themoviedb.org/3{path}"))
            .query(&[("api_key", TMDB_KEY)])
            .query(&query)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let status = res.status();
        let body: Value = res.json().await.map_err(|e| e.to_string())?;
        if status.is_success() {
            Ok(body)
        } else {
            Err(format!("{} TMDB: {}", status.as_u16(), body["status_message"].as_str().unwrap_or("request failed")))
        }
    };
    // The key leaves out the API key, and BTreeMap keeps the query in a stable order.
    s.db.through(&format!("tmdb {path} {}", serde_json::to_string(&query).map_err(|e| e.to_string())?), ttl, false, fetch).await
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            keyring_core::set_default_store(windows_native_keyring_store::Store::new()?);
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            app.manage(trakt::State::new(data_dir.join("library.json"), db::Db::open(data_dir.join("filmie.sqlite3"))));

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
            window.build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            tmdb,
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
            db::stats
        ])
        .run(tauri::generate_context!())
        .expect("error while running Filmie");
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn only_app_pages_navigate() {
        assert!(is_app_page(&Url::parse("http://tauri.localhost/index.html").unwrap()));
        assert!(!is_app_page(&Url::parse("https://ads.example.com/").unwrap()));
    }
}
