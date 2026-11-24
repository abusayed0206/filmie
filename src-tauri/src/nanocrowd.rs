//! Nanocrowd API (bananastreampie.com) integration for Filmie.
//! A guest token, a title's keywords, similar films and audience rating, and films by genre.
//! The API is undocumented: see docs/NANOCROWD.md.

use crate::trakt::{State, log_request};
use futures_util::future::join_all;
use reqwest::StatusCode;
use reqwest::header::AUTHORIZATION;
use serde_json::{Map, Value, json};
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, Semaphore};

const BASE_URL: &str = "https://bananastreampie.com";
const DAY: i64 = 86_400;
const TOKEN_KEY: &str = "nanocrowd token";
// Nanocrowd gives no expiry, and the same guest token comes back for days, so it is kept until a request is refused.
const TOKEN_TTL: i64 = 3650 * DAY;

/// The 25 genres from `/api/fundamentals`, the only words `/api/tiers/<genre>` answers for. ui/pages-browse.js has the same list.
pub const GENRES: [&str; 25] = [
    "action",
    "adventure",
    "animation",
    "biography",
    "comedy",
    "cops",
    "documentary",
    "drama",
    "fantasy",
    "historical",
    "horror",
    "kids",
    "musical",
    "mystery",
    "quest",
    "relationships",
    "romance",
    "romantic-comedy",
    "sci-fi",
    "sports",
    "spy",
    "superhero",
    "thriller",
    "war",
    "western",
];

/// IMDb id (lowercase) -> (crowdRating, crowdSize), from every genre's film list.
pub type RatingIndex = HashMap<String, (f64, f64)>;

/// The guest token, held in memory and saved in the cache table so it survives restarts.
pub struct NanocrowdState {
    token: Mutex<Option<String>>,
    // shortcut: loaded once per run from the 30-day cache, so a run lasting longer keeps an older catalog; fine for a desktop app.
    catalog: tokio::sync::OnceCell<Catalog>,
    // shortcut: the same holds for the rating index and its 7-day cache.
    ratings: tokio::sync::OnceCell<RatingIndex>,
    index_failed: Mutex<Option<Instant>>,
    // Cards look titles up one by one when the index misses them, so this keeps it to a few requests at a time.
    lookups: Semaphore,
}

impl NanocrowdState {
    pub fn new() -> Self {
        Self {
            token: Mutex::default(),
            catalog: tokio::sync::OnceCell::new(),
            ratings: tokio::sync::OnceCell::new(),
            index_failed: Mutex::default(),
            lookups: Semaphore::new(3),
        }
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

/// The catalog as (normalized title, year, id), so each title page searches memory instead of parsing 1.7 MB.
type Catalog = Vec<(String, u32, u64)>;

/// Lowercase letters and digits only, single-spaced, without a leading article: "The Godfather: Part II" and
/// "The Godfather Part II" both become "godfather part ii", and "Your Name." becomes "your name".
fn normalize(title: &str) -> String {
    let words: Vec<String> = title.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(str::to_lowercase).collect();
    let skip = usize::from(words.len() > 1 && matches!(words[0].as_str(), "the" | "a" | "an"));
    words[skip..].join(" ")
}

/// The part before a subtitle: "A Silent Voice: The Movie" gives "A Silent Voice".
fn head(title: &str) -> Option<&str> {
    title.split_once([':', '\u{2013}']).or_else(|| title.split_once(" - ")).map(|(h, _)| h)
}

fn index_catalog(body: &Value) -> Catalog {
    let mut out = Vec::new();
    for it in body.as_array().into_iter().flatten() {
        // Every entry reads "Title (Year)". A subtitled one is also found by its head, as TMDB may leave the
        // subtitle out ("Gabriel's Inferno: Part 1").
        let Some((title, rest)) = it["title"].as_str().and_then(|t| t.trim_end().rsplit_once(" (")) else { continue };
        let (Some(year), Some(id)) = (rest.strip_suffix(')').and_then(|y| y.parse().ok()), it["ncTitleId"].as_u64()) else { continue };
        out.push((normalize(title), year, id));
        if let Some(h) = head(title) {
            out.push((normalize(h), year, id));
        }
    }
    out
}

/// Candidates for a TMDB title, nearest year first. Nanocrowd's year is often a later country's release, as much as
/// two or three years after TMDB's (Seven Samurai: 1956 against 1954), and its titles can drop a subtitle
/// ("A Silent Voice: The Movie"), so the part before a colon or dash is tried too. The IMDb id then decides, so
/// the looser search can't attach the wrong film.
fn catalog_ids(catalog: &Catalog, title: &str, year: u32, max: usize) -> Vec<u64> {
    let mut keys = vec![normalize(title)];
    keys.extend(head(title).map(normalize));
    let mut found: Vec<(u32, usize, u64)> = catalog
        .iter()
        .filter_map(|(t, y, id)| Some((y.abs_diff(year), keys.iter().position(|k| k == t)?, *id)))
        .filter(|(gap, ..)| *gap <= 3)
        .collect();
    found.sort_unstable();
    let mut out = Vec::new();
    for (.., id) in found {
        if !out.contains(&id) {
            out.push(id);
        }
    }
    out.truncate(max); // each candidate costs one request
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

/// A title's Nanocrowd entry, with its `keywords`, `mostLikeTitles` and `crowdRating`, or `{}` when Nanocrowd doesn't
/// have it. `max` caps how many same-named candidates are fetched to find it.
pub async fn find(s: &State, nc: &NanocrowdState, title: &str, year: u32, imdb_id: &str, max: usize) -> Result<Value, String> {
    // Nanocrowd has no search by name: its web app downloads the whole catalog (about 2 MB) and searches it locally.
    let catalog = nc
        .catalog
        .get_or_try_init(async || {
            let body = s.db.through("nanocrowd catalog", TITLE_TTL, false, fetch_with_auth(s, nc, "/api/titlesearch/")).await?;
            Ok::<_, String>(index_catalog(&body))
        })
        .await?;
    // Titles repeat, so the IMDb id decides which one it is.
    for id in catalog_ids(catalog, title.trim(), year, max) {
        let details = title_details(s, nc, id).await?;
        if details["imdbId"].as_str().is_some_and(|i| i.eq_ignore_ascii_case(imdb_id)) {
            return Ok(details);
        }
    }
    Ok(json!({}))
}

/// The same for a card, which the rating index missed: a few at a time, and only the two nearest candidates.
pub async fn find_for_card(s: &State, nc: &NanocrowdState, title: &str, year: u32, imdb_id: &str) -> Result<Value, String> {
    let _turn = nc.lookups.acquire().await.map_err(|e| e.to_string())?;
    find(s, nc, title, year, imdb_id, 2).await
}

/// A title page's Nanocrowd entry. Movies and shows both work: the catalog holds both.
#[tauri::command]
pub async fn nanocrowd_title_info(
    s: tauri::State<'_, State>,
    nc_s: tauri::State<'_, NanocrowdState>,
    title: String,
    year: u32,
    imdb_id: String,
) -> Result<Value, String> {
    find(&s, &nc_s, &title, year, &imdb_id, 6).await
}

const INDEX_TTL: i64 = 7 * DAY;
const INDEX_RETRY: Duration = Duration::from_secs(600);

impl NanocrowdState {
    /// Every rating the genre lists carry, about 15,000 movies and shows. Saved compactly in the cache table for a week,
    /// so building it costs 25 requests about once a week. A failed build waits 10 minutes before trying again.
    pub async fn rating_index(&self, s: &State) -> Result<&RatingIndex, String> {
        self.ratings
            .get_or_try_init(async || {
                if self.index_failed.lock().await.is_some_and(|at| at.elapsed() < INDEX_RETRY) {
                    return Err("nanocrowd rating index failed recently".to_string());
                }
                let body = s.db.through("nanocrowd ratings", INDEX_TTL, false, self.build_index(s)).await;
                if body.is_err() {
                    *self.index_failed.lock().await = Some(Instant::now());
                }
                Ok(read_index(&body?))
            })
            .await
    }

    async fn build_index(&self, s: &State) -> Result<Value, String> {
        // A genre the Vibes page fetched this week is already in the cache, in the same shape it keeps.
        let tier = async |g: &str| match s.db.peek(&format!("nanocrowd tier {g}")) {
            Some((body, true)) => Ok(body),
            _ => Ok::<_, String>(fetch_with_auth(s, self, &format!("/api/tiers/{g}")).await?.get(0).cloned().unwrap_or(json!({}))),
        };
        let mut tiers = Vec::new();
        for chunk in GENRES.chunks(5) {
            tiers.extend(join_all(chunk.iter().map(|g| tier(g))).await);
        }
        let ok: Vec<&Value> = tiers.iter().filter_map(|t| t.as_ref().ok()).collect();
        // A list or two missing only leaves those titles to the slower lookup, but most missing means Nanocrowd is down.
        if ok.len() < GENRES.len() - 3 {
            return Err(format!("nanocrowd answered {} of {} genre lists", ok.len(), GENRES.len()));
        }
        Ok(index_tiers(ok.into_iter()))
    }
}

/// `{ "tt0903747": [4.95, 4.7], ... }`: the rating and crowd size, rounded, of every film or show in the lists.
fn index_tiers<'a>(tiers: impl Iterator<Item = &'a Value>) -> Value {
    let round = |x: f64| (x * 100.0).round() / 100.0;
    let mut out = Map::new();
    for tier in tiers {
        for x in tier["titleList"].as_array().into_iter().flatten() {
            if let (Some(id), Some(r)) =
                (x["imdbId"].as_str().filter(|i| i.get(..2).is_some_and(|p| p.eq_ignore_ascii_case("tt"))), x["crowdRating"].as_f64())
            {
                out.insert(id.to_ascii_lowercase(), json!([round(r), round(x["crowdSize"].as_f64().unwrap_or(0.0))]));
            }
        }
    }
    Value::Object(out)
}

fn read_index(body: &Value) -> RatingIndex {
    let pair = |v: &Value| Some((v[0].as_f64()?, v[1].as_f64().unwrap_or(0.0)));
    body.as_object().into_iter().flatten().filter_map(|(k, v)| Some((k.clone(), pair(v)?))).collect()
}

/// One of the genres from `/api/fundamentals`: its mood words in `subtierList` and up to 1000 films in `titleList`.
#[tauri::command]
pub async fn nanocrowd_tier(s: tauri::State<'_, State>, nc_s: tauri::State<'_, NanocrowdState>, genre: String) -> Result<Value, String> {
    if !GENRES.contains(&genre.as_str()) {
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
            { "title": "The Godfather: Part II (1974)", "ncTitleId": 2439 },
            { "title": "Seven Samurai (1956)", "ncTitleId": 8033 },
            { "title": "Your Name (2016)", "ncTitleId": 30098 },
            { "title": "A Silent Voice (2017)", "ncTitleId": 30946 },
            { "title": "Up (2009)", "ncTitleId": 9 },
            { "title": "Gabriel's Inferno: Part 1 (2020)", "ncTitleId": 40 },
        ]));
        assert_eq!(catalog_ids(&catalog, "Gabriel's Inferno", 2020, 6), vec![40]);
        assert_eq!(catalog_ids(&catalog, "Lucy", 2014, 6), vec![27320, 7]);
        assert_eq!(catalog_ids(&catalog, "Lucy", 2004, 6), vec![100]);
        assert!(catalog_ids(&catalog, "Lucy", 1990, 6).is_empty());
        assert_eq!(catalog_ids(&catalog, "The Godfather Part II", 1974, 6), vec![2439]);
        assert_eq!(catalog_ids(&catalog, "Seven Samurai", 1954, 6), vec![8033]);
        assert_eq!(catalog_ids(&catalog, "Your Name.", 2016, 6), vec![30098]);
        assert_eq!(catalog_ids(&catalog, "A Silent Voice: The Movie", 2016, 6), vec![30946]);
        assert_eq!(catalog_ids(&catalog, "Up", 2009, 6), vec![9]); // a one-word title isn't emptied
        assert_eq!(normalize("The"), "the");
    }

    #[test]
    fn rating_index_keeps_titled_entries_by_lowercase_imdb_id() {
        let tiers = [
            json!({ "titleList": [
                { "imdbId": "tt0903747", "crowdRating": 4.94734, "crowdSize": 4.6991 },
                { "imdbId": "tt1", "crowdRating": 2.5 },
                { "imdbId": "", "crowdRating": 3.0 },
                { "imdbId": "tt2" },
            ] }),
            json!({ "titleList": [{ "imdbId": "TT3", "crowdRating": 1.0, "crowdSize": 2.0 }] }),
            json!({}),
        ];
        let body = index_tiers(tiers.iter());
        assert_eq!(body, json!({ "tt0903747": [4.95, 4.7], "tt1": [2.5, 0.0], "tt3": [1.0, 2.0] }));
        let index = read_index(&body);
        assert_eq!(index.get("tt0903747"), Some(&(4.95, 4.7)));
        assert_eq!(index.len(), 3);
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
