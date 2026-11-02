//! Trakt API (2026): device-code sign-in, single-use refresh tokens, rate-limited writes.
//! Docs: github.com/trakt/trakt-api (projects/developer guides, projects/api contracts).

use crate::db::Db;
use reqwest::{Method, header::CONTENT_TYPE};
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::sync::Mutex;

const CLIENT_ID: &str = env!("TRAKT");
const API: &str = "https://api.trakt.tv";
const AUTH: &str = "https://auth.trakt.tv"; // all OAuth calls go here, never to API
// Refresh requests must send the redirect URI registered on the Trakt app.
const REDIRECT_URI: &str = match option_env!("TRAKT_REDIRECT_URI") {
    Some(uri) => uri,
    None => "urn:ietf:wg:oauth:2.0:oob",
};
const USER_AGENT: &str = concat!("Filmie/", env!("CARGO_PKG_VERSION"));

// Library sections and the /sync/last_activities timestamps that say when each one changed.
const SECTIONS: &[(&str, &str, &[&str])] = &[
    ("watched_movies", "/sync/watched/movies", &["/movies/watched_at"]),
    ("watched_shows", "/sync/watched/shows", &["/episodes/watched_at"]),
    ("watchlist_movies", "/sync/watchlist/movies/rank/asc", &["/movies/watchlisted_at"]),
    ("watchlist_shows", "/sync/watchlist/shows/rank/asc", &["/shows/watchlisted_at"]),
    ("ratings_movies", "/sync/ratings/movies", &["/movies/rated_at"]),
    ("ratings_shows", "/sync/ratings/shows", &["/shows/rated_at"]),
    ("playback", "/sync/playback", &["/movies/paused_at", "/episodes/paused_at"]),
];

const HOUR: i64 = 3600;
const DAY: i64 = 24 * HOUR;

/// How long a GET may be reused, and whether it depends on the signed-in user. User responses can live long
/// because any write or new Trakt activity clears them.
fn cache_policy(path: &str) -> (i64, bool) {
    if path.starts_with("/recommendations") {
        (6 * HOUR, true)
    } else if path.starts_with("/sync/") || path.starts_with("/users/") || path.contains("/progress/") {
        (DAY, true)
    } else if path.starts_with("/search/") || path.contains("/related") {
        (DAY, false)
    } else {
        (HOUR, false)
    }
}

/// True when the section is missing or any timestamp behind it moved. A missing timestamp counts as moved.
fn section_changed(lib: &Value, key: &str, stamps: &[&str], activities: &Value) -> bool {
    lib.get(key).is_none_or(Value::is_null)
        || stamps.iter().any(|p| {
            let new = activities.pointer(p);
            new.is_none() || lib["activities"].pointer(p) != new
        })
}

#[derive(Clone)]
struct Tokens {
    access: String,
    refresh: String,
    expires_at: u64,
}

pub struct State {
    pub http: reqwest::Client,
    tokens: Mutex<Option<Tokens>>,
    last_write: Mutex<Instant>,
    library_path: PathBuf,
    pub db: Db,
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs()
}

fn tokens_from(v: &Value) -> Option<Tokens> {
    Some(Tokens {
        access: v["access_token"].as_str()?.into(),
        refresh: v["refresh_token"].as_str()?.into(),
        expires_at: v["created_at"].as_u64()? + v["expires_in"].as_u64()?,
    })
}

// Windows Credential Manager caps a secret at 2560 bytes, so each token gets its own entry.
fn entry(name: &str) -> Result<keyring_core::Entry, String> {
    keyring_core::Entry::new("filmie", name).map_err(err)
}

fn load_tokens() -> Option<Tokens> {
    let access = entry("trakt-access").ok()?.get_password().ok()?;
    let refresh = entry("trakt-refresh").ok()?.get_password().ok()?;
    let (expires_at, access) = access.split_once(' ')?;
    Some(Tokens { access: access.into(), refresh, expires_at: expires_at.parse().ok()? })
}

fn save_tokens(t: &Tokens) -> Result<(), String> {
    entry("trakt-refresh")?.set_password(&t.refresh).map_err(err)?;
    entry("trakt-access")?.set_password(&format!("{} {}", t.expires_at, t.access)).map_err(err)
}

fn clear_tokens() {
    for name in ["trakt-access", "trakt-refresh"] {
        if let Ok(e) = entry(name) {
            let _ = e.delete_credential();
        }
    }
}

impl State {
    pub fn new(library_path: PathBuf, db: Db) -> Self {
        Self { http: reqwest::Client::new(), tokens: Mutex::new(None), last_write: Mutex::new(Instant::now()), library_path, db }
    }

    fn read_library(&self) -> Value {
        std::fs::read(&self.library_path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .filter(Value::is_object)
            .unwrap_or_else(|| json!({}))
    }

    async fn auth_post(&self, path: &str, body: Value) -> Result<reqwest::Response, String> {
        self.http.post(format!("{AUTH}{path}")).header("User-Agent", USER_AGENT).json(&body).send().await.map_err(err)
    }

    /// Current access token, refreshed when under a day is left. `None` when signed out.
    async fn access_token(&self) -> Result<Option<String>, String> {
        // Held across the refresh: refresh tokens are single-use, so two parallel refreshes would sign the user out.
        let mut guard = self.tokens.lock().await;
        if guard.is_none() {
            *guard = load_tokens();
        }
        let Some(t) = guard.clone() else { return Ok(None) };
        if t.expires_at > now() + 86_400 {
            return Ok(Some(t.access));
        }
        let res = self
            .auth_post(
                "/oauth/token",
                json!({
                    "refresh_token": t.refresh,
                    "client_id": CLIENT_ID,
                    "redirect_uri": REDIRECT_URI,
                    "grant_type": "refresh_token",
                }),
            )
            .await;
        let res = match res {
            Ok(res) => res,
            Err(_) if t.expires_at > now() => return Ok(Some(t.access)), // offline; the current token still works
            Err(e) => return Err(e),
        };
        let status = res.status();
        let body: Value = res.json().await.unwrap_or(Value::Null);
        if let Some(new) = status.is_success().then(|| tokens_from(&body)).flatten() {
            *guard = Some(new.clone());
            if let Err(e) = save_tokens(&new) {
                eprintln!("could not store refreshed Trakt tokens: {e}");
            }
            Ok(Some(new.access))
        } else if status == 400 || status == 401 {
            eprintln!("Trakt refresh rejected: {body}");
            clear_tokens();
            *guard = None;
            Err("401 Trakt session expired. Sign in again in Settings.".into())
        } else if t.expires_at > now() {
            Ok(Some(t.access)) // transient failure; the current token still works
        } else {
            Err(format!("{} Trakt token refresh failed", status.as_u16()))
        }
    }

    async fn request(&self, method: Method, path: &str, body: Option<Value>) -> Result<Value, String> {
        let token = self.access_token().await?;
        let write = method != Method::GET;
        if write && token.is_none() {
            return Err("401 Sign in to Trakt first.".into());
        }
        // Writes are limited to 1 per second per user.
        let mut last_write = if write { Some(self.last_write.lock().await) } else { None };
        for attempt in 0..2 {
            if let Some(last) = &last_write {
                tokio::time::sleep_until((**last + Duration::from_secs(1)).into()).await;
            }
            let mut req = self
                .http
                .request(method.clone(), format!("{API}{path}"))
                .header(CONTENT_TYPE, "application/json")
                .header("User-Agent", USER_AGENT)
                .header("trakt-api-key", CLIENT_ID)
                .header("trakt-api-version", "2");
            if let Some(t) = &token {
                req = req.bearer_auth(t);
            }
            if let Some(b) = &body {
                req = req.json(b);
            }
            let res = req.send().await.map_err(err)?;
            if let Some(last) = last_write.as_mut() {
                **last = Instant::now();
            }
            let status = res.status().as_u16();
            if status == 429 && attempt == 0 {
                let wait = res.headers().get("retry-after").and_then(|v| v.to_str().ok()?.parse().ok()).unwrap_or(10u64);
                tokio::time::sleep(Duration::from_secs(wait.min(60))).await;
                continue;
            }
            let upgrade = res.headers().get("x-upgrade-url").and_then(|v| v.to_str().ok()).map(String::from);
            let text = res.text().await.map_err(err)?;
            let json = if text.is_empty() { Value::Null } else { serde_json::from_str(&text).unwrap_or(Value::String(text)) };
            return match status {
                200..=299 => Ok(json),
                420 => Err("420 Trakt account limit reached (for example a full watchlist). Remove items or upgrade to Trakt VIP.".into()),
                423 => Err("423 Your Trakt account is locked. Contact Trakt support.".into()),
                426 => Err(format!("426 This needs Trakt VIP: {}", upgrade.as_deref().unwrap_or("https://app.trakt.tv/vip"))),
                _ => Err(format!("{status} Trakt: {json}")),
            };
        }
        Err("429 Trakt rate limit. Try again in a minute.".into())
    }
}

#[tauri::command]
pub async fn trakt(s: tauri::State<'_, State>, method: String, path: String, body: Option<Value>) -> Result<Value, String> {
    if !path.starts_with('/') {
        return Err("bad path".into());
    }
    let method = Method::from_bytes(method.as_bytes()).map_err(err)?;
    if method == Method::GET {
        let (ttl, user_scoped) = cache_policy(&path);
        return s.db.through(&format!("trakt {path}"), ttl, user_scoped, s.request(Method::GET, &path, None)).await;
    }
    let result = s.request(method, &path, body).await;
    s.db.clear_user();
    result
}

#[tauri::command]
pub async fn device_start(s: tauri::State<'_, State>) -> Result<Value, String> {
    let res = s.auth_post("/oauth/device/code", json!({ "client_id": CLIENT_ID })).await?;
    if !res.status().is_success() {
        return Err(format!("{} Could not start Trakt sign-in", res.status().as_u16()));
    }
    res.json().await.map_err(err)
}

/// One poll. The page repeats it every `interval` seconds until the code expires.
#[tauri::command]
pub async fn device_poll(s: tauri::State<'_, State>, device_code: String) -> Result<&'static str, String> {
    let res = s.auth_post("/oauth/device/token", json!({ "code": device_code, "client_id": CLIENT_ID })).await?;
    match res.status().as_u16() {
        200 => {
            let t = tokens_from(&res.json().await.map_err(err)?).ok_or("Trakt sent an unexpected token response")?;
            save_tokens(&t)?;
            *s.tokens.lock().await = Some(t);
            Ok("ok")
        }
        400 => Ok("pending"),
        429 => Ok("slow_down"),
        404 => Err("Invalid code. Start again.".into()),
        409 => Err("This code was already used.".into()),
        410 => Err("The code expired. Start again.".into()),
        418 => Err("Sign-in was denied on Trakt.".into()),
        code => Err(format!("{code} Trakt sign-in failed")),
    }
}

/// The user's Trakt avatar, cached on disk because Trakt blocks hotlinked images.
#[tauri::command]
pub async fn avatar(s: tauri::State<'_, State>, url: String) -> Result<tauri::ipc::Response, String> {
    let parsed = reqwest::Url::parse(&url).map_err(err)?;
    let name = parsed.path_segments().and_then(|mut p| p.next_back()).unwrap_or_default().to_string();
    let trakt_host = parsed.host_str().is_some_and(|h| h == "trakt.tv" || h.ends_with(".trakt.tv"));
    if parsed.scheme() != "https" || !trakt_host || name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '.') {
        return Err("bad avatar url".into());
    }
    // The file name changes when the user uploads a new avatar, so it doubles as the cache key.
    let path = s.library_path.with_file_name(format!("avatar-{name}"));
    if let Ok(bytes) = std::fs::read(&path) {
        return Ok(tauri::ipc::Response::new(bytes));
    }
    let res = s.http.get(parsed).header("User-Agent", USER_AGENT).send().await.map_err(err)?;
    let bytes = res.error_for_status().map_err(err)?.bytes().await.map_err(err)?.to_vec();
    let _ = std::fs::write(&path, &bytes);
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn sign_out(s: tauri::State<'_, State>) -> Result<(), String> {
    let tokens = s.tokens.lock().await.take().or_else(load_tokens);
    clear_tokens();
    s.db.clear_user();
    let _ = std::fs::remove_file(&s.library_path);
    if let Some(dir) = s.library_path.parent().and_then(|d| std::fs::read_dir(d).ok()) {
        for f in dir.flatten().filter(|f| f.file_name().to_string_lossy().starts_with("avatar-")) {
            let _ = std::fs::remove_file(f.path());
        }
    }
    if let Some(t) = tokens {
        let _ = s.auth_post("/oauth/revoke", json!({ "token": t.access, "client_id": CLIENT_ID })).await;
    }
    Ok(())
}

/// The signed-in user's settings and account limits, or null when signed out.
#[tauri::command]
pub async fn status(s: tauri::State<'_, State>) -> Result<Value, String> {
    if s.access_token().await?.is_none() {
        return Ok(Value::Null);
    }
    s.db.through("trakt /users/settings", HOUR, true, s.request(Method::GET, "/users/settings", None)).await
}

/// The last library copy on disk, without touching the network, so the first page can draw at once.
#[tauri::command]
pub fn library(s: tauri::State<'_, State>) -> Value {
    s.read_library()
}

/// Mirrors the user's Trakt library to disk, refetching only when Trakt reports new activity.
#[tauri::command]
pub async fn sync(s: tauri::State<'_, State>) -> Result<Value, String> {
    if s.access_token().await?.is_none() {
        return Ok(Value::Null);
    }
    let mut lib = s.read_library();
    let activities = s.request(Method::GET, "/sync/last_activities", None).await?;
    if lib["activities"]["all"] == activities["all"] {
        return Ok(lib);
    }
    s.db.clear_user();
    // Trakt pages sync lists (100 items by default) even where the docs call paging optional.
    const PAGE: usize = 100;
    for (key, path, stamps) in SECTIONS {
        if !section_changed(&lib, key, stamps, &activities) {
            continue;
        }
        let mut items = Vec::new();
        for page in 1.. {
            let batch = s.request(Method::GET, &format!("{path}?page={page}&limit={PAGE}"), None).await?;
            let batch = batch.as_array().cloned().unwrap_or_default();
            let last = batch.len() < PAGE;
            items.extend(batch);
            if last {
                break;
            }
        }
        lib[*key] = Value::Array(items);
    }
    lib["activities"] = activities;
    std::fs::write(&s.library_path, serde_json::to_vec(&lib).map_err(err)?).map_err(err)?;
    Ok(lib)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_response_parsing() {
        let t = tokens_from(&json!({
            "access_token": "a", "token_type": "bearer", "expires_in": 604800,
            "refresh_token": "r", "scope": "public", "created_at": 1_800_000_000
        }))
        .unwrap();
        assert_eq!((t.access.as_str(), t.refresh.as_str(), t.expires_at), ("a", "r", 1_800_604_800));
        assert!(tokens_from(&json!({ "access_token": "a" })).is_none());
    }

    #[test]
    fn only_changed_sections_refetch() {
        let stamps =
            |rated: &str| json!({ "all": rated, "movies": { "watched_at": "w", "rated_at": rated }, "episodes": { "paused_at": "p" } });
        let lib = json!({ "ratings_movies": [], "watched_movies": [], "playback": [], "activities": stamps("r1") });
        let new = stamps("r2");
        assert!(section_changed(&lib, "ratings_movies", &["/movies/rated_at"], &new));
        assert!(!section_changed(&lib, "watched_movies", &["/movies/watched_at"], &new));
        assert!(section_changed(&lib, "missing", &["/movies/watched_at"], &new), "no local copy yet");
        assert!(section_changed(&lib, "playback", &["/movies/paused_at"], &new), "unknown timestamp counts as changed");
        assert!(!section_changed(&lib, "playback", &["/episodes/paused_at"], &new));
    }

    #[test]
    fn cache_policy_separates_user_and_public_data() {
        assert_eq!(cache_policy("/users/me/lists"), (DAY, true));
        assert_eq!(cache_policy("/sync/progress/watched?hide_completed=true"), (DAY, true));
        assert_eq!(cache_policy("/shows/1/progress/watched"), (DAY, true));
        assert_eq!(cache_policy("/recommendations/movies?limit=30"), (6 * HOUR, true));
        assert_eq!(cache_policy("/movies/trending?limit=30"), (HOUR, false));
        assert_eq!(cache_policy("/search/tmdb/1?type=movie"), (DAY, false));
    }
}
