//! Nanocrowd API (bananastreampie.com) integration for Filmie.
//! A guest token, a movie's keywords and similar films, and films by genre. The API is undocumented: see docs/NANOCROWD_API.md.

use crate::trakt::{State, log_request};
use reqwest::StatusCode;
use reqwest::header::AUTHORIZATION;
use serde_json::{Value, json};
use tokio::sync::Mutex;

const BASE_URL: &str = "https://bananastreampie.com";
const DAY: i64 = 86_400;
const TOKEN_KEY: &str = "nanocrowd token";
// Nanocrowd gives no expiry, and the same guest token comes back for days, so it is kept until a request is refused.
const TOKEN_TTL: i64 = 3650 * DAY;

/// The guest token, held in memory and saved in the cache table so it survives restarts.
#[derive(Default)]
pub struct NanocrowdState {
    token: Mutex<Option<String>>,
    // shortcut: loaded once per run from the 30-day cache, so a run lasting longer keeps an older catalog; fine for a desktop app.
    catalog: tokio::sync::OnceCell<Catalog>,
}

impl NanocrowdState {
    pub fn new() -> Self {
        Self::default()
    }

    /// From memory, else the database, else a new one from Nanocrowd. The lock is held while it is fetched,
    /// so requests that arrive together share one new token instead of each asking for their own.
    pub async fn token(&self, s: &State) -> Result<String, String> {
        let mut held = self.token.lock().await;
        if let Some(t) = &*held {
            return Ok(t.clone());
        }
        let body = s.db.through(TOKEN_KEY, TOKEN_TTL, false, mint(&s.http)).await?;
        let t = body["token"].as_str().ok_or("nanocrowd sent no token")?.to_string();
        *held = Some(t.clone());
        Ok(t)
    }

    /// Drops a refused token, unless a request that was refused at the same time has already replaced it.
    async fn refused(&self, s: &State, stale: &str) {
        let mut held = self.token.lock().await;
        if held.as_deref() == Some(stale) {
            *held = None;
            s.db.forget(TOKEN_KEY);
        }
    }
}

async fn mint(http: &reqwest::Client) -> Result<Value, String> {
    let resp = http.get(format!("{BASE_URL}/api/init/token")).send().await.map_err(|e| format!("nanocrowd token request failed: {e}"))?;
    log_request("nanocrowd", "GET", resp.status().as_u16(), "/api/init/token");
    if !resp.status().is_success() {
        return Err(format!("nanocrowd token request returned status {}", resp.status()));
    }
    let body: Value = resp.json().await.map_err(|e| format!("nanocrowd token json invalid: {e}"))?;
    // Checked before through() saves it, so a bad answer is never kept.
    match body["token"].as_str() {
        Some(t) if !t.is_empty() => Ok(body),
        _ => Err("nanocrowd sent no token".into()),
    }
}

/// The catalog as (lowercased "title (year)", id), so each title page searches memory instead of parsing 1.7 MB.
type Catalog = Vec<(String, u64)>;

fn index_catalog(body: &Value) -> Catalog {
    body.as_array()
        .map(|items| items.iter().filter_map(|it| Some((it["title"].as_str()?.to_lowercase(), it["ncTitleId"].as_u64()?))).collect())
        .unwrap_or_default()
}

/// The ids whose catalog entry reads exactly "Title (Year)", trying the neighbouring years too,
/// since Nanocrowd and TMDB sometimes disagree on the release year by one.
fn catalog_ids(catalog: &Catalog, title: &str, year: u32) -> Vec<u64> {
    let mut out = Vec::new();
    for y in [year, year.saturating_sub(1), year.saturating_add(1)] {
        let want = format!("{title} ({y})").to_lowercase();
        for (t, id) in catalog {
            if *t == want && !out.contains(id) {
                out.push(*id);
            }
        }
    }
    out
}

async fn fetch_with_auth(s: &State, nc: &NanocrowdState, path: &str) -> Result<Value, String> {
    let url = format!("{BASE_URL}{path}");
    let send = async |token: &str| {
        let resp = s
            .http
            .get(&url)
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|e| format!("nanocrowd request {path} failed: {e}"))?;
        log_request("nanocrowd", "GET", resp.status().as_u16(), path);
        Ok::<_, String>(resp)
    };
    let token = nc.token(s).await?;
    let mut resp = send(&token).await?;
    if matches!(resp.status(), StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN) {
        // The saved token has stopped working: replace it and try once more.
        nc.refused(s, &token).await;
        resp = send(&nc.token(s).await?).await?;
    }
    if !resp.status().is_success() {
        return Err(format!("nanocrowd {path} returned status {}", resp.status()));
    }
    let body: Value = resp.json().await.map_err(|e| format!("invalid json from {path}: {e}"))?;
    // An unknown path answers 200 with this, which must not be cached as a result.
    if body["response"] == "nope" {
        return Err(format!("nanocrowd {path} is not an endpoint"));
    }
    Ok(body)
}

const TITLE_TTL: i64 = 30 * DAY;

async fn title_details(s: &State, nc: &NanocrowdState, id: u64) -> Result<Value, String> {
    let fetch = async { Ok(fetch_with_auth(s, nc, &format!("/api/titles/{id}")).await?.get(0).cloned().unwrap_or(json!({}))) };
    s.db.through(&format!("nanocrowd title {id}"), TITLE_TTL, false, fetch).await
}

/// A movie's Nanocrowd entry, with its `keywords` and `mostLikeTitles`, or `{}` when Nanocrowd doesn't have it.
#[tauri::command]
pub async fn nanocrowd_title_info(
    s: tauri::State<'_, State>,
    nc_s: tauri::State<'_, NanocrowdState>,
    title: String,
    year: u32,
    imdb_id: String,
) -> Result<Value, String> {
    // Nanocrowd has no search by name: its web app downloads the whole catalog (about 2 MB) and searches it locally.
    let catalog = nc_s
        .catalog
        .get_or_try_init(async || {
            let body = s.db.through("nanocrowd catalog", TITLE_TTL, false, fetch_with_auth(&s, &nc_s, "/api/titlesearch/")).await?;
            Ok::<_, String>(index_catalog(&body))
        })
        .await?;
    let ids = catalog_ids(catalog, title.trim(), year);
    // Titles repeat, so the IMDb id decides which one it is.
    for id in ids {
        let details = title_details(&s, &nc_s, id).await?;
        if details["imdbId"].as_str().is_some_and(|i| i.eq_ignore_ascii_case(&imdb_id)) {
            return Ok(details);
        }
    }
    Ok(json!({}))
}

/// One of the genres from `/api/fundamentals`: its mood words in `subtierList` and up to 1000 films in `titleList`.
#[tauri::command]
pub async fn nanocrowd_tier(s: tauri::State<'_, State>, nc_s: tauri::State<'_, NanocrowdState>, genre: String) -> Result<Value, String> {
    if genre.is_empty() || !genre.bytes().all(|b| b.is_ascii_lowercase() || b == b'-') {
        return Err("not a Nanocrowd genre".into());
    }
    let path = format!("/api/tiers/{genre}");
    let fetch = async { Ok(fetch_with_auth(&s, &nc_s, &path).await?.get(0).cloned().unwrap_or(json!({}))) };
    s.db.through(&format!("nanocrowd tier {genre}"), 7 * DAY, false, fetch).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_ids_match_title_and_nearby_year() {
        let catalog = index_catalog(&json!([
            { "title": "Lucy (2014)", "ncTitleId": 27320 },
            { "title": "Lucy (2003)", "ncTitleId": 100 },
            { "title": "Lucy Gets Lost (2014)", "ncTitleId": 5 },
            { "title": "lucy (2015)", "ncTitleId": 7 },
            { "title": "No id (2014)" },
        ]));
        assert_eq!(catalog_ids(&catalog, "Lucy", 2014), vec![27320, 7]);
        assert_eq!(catalog_ids(&catalog, "Lucy", 2004), vec![100]);
        assert!(catalog_ids(&catalog, "Lucy", 1990).is_empty());
    }

    #[test]
    fn saved_token_is_reused_and_only_the_refused_one_is_dropped() {
        tauri::async_runtime::block_on(async {
            let s = State::new(std::env::temp_dir().join("filmie-nanocrowd-test.json"), crate::db::Db::open(":memory:"));
            s.db.through(TOKEN_KEY, TOKEN_TTL, false, async { Ok(json!({ "token": "saved" })) }).await.unwrap();
            let nc = NanocrowdState::new();
            // From the database, with no request: a request would fail without a network in tests.
            assert_eq!(nc.token(&s).await.unwrap(), "saved");
            // A request refused with an older token leaves the current one alone.
            nc.refused(&s, "older").await;
            assert_eq!(nc.token.lock().await.as_deref(), Some("saved"));
            nc.refused(&s, "saved").await;
            assert_eq!(*nc.token.lock().await, None);
            assert!(s.db.through(TOKEN_KEY, TOKEN_TTL, false, async { Err("gone".to_string()) }).await.is_err());
        });
    }
}
