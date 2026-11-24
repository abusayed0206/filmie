//! Ratings for cards and title pages. Nanocrowd's audience rating always works. Every other source (IMDb, Rotten
//! Tomatoes, Metacritic, Letterboxd, Trakt, TMDB and MDBList's own score) comes from MDBList, once the person adds
//! their own free API key in Settings. The frontend sorts and filters on these locally.

use crate::nanocrowd::{self, NanocrowdState};
use crate::trakt::{State, log_request};
use futures_util::future::join_all;
use serde::Deserialize;
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;

const API: &str = "https://api.mdblist.com";
// The person's choice: long enough that browsing rarely asks twice in a day, short enough that new releases fill in.
const TTL: i64 = 8 * 3600;
const KEY_ENTRY: &str = "mdblist-key";
const MAX_ASK: usize = 200;

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

#[derive(Default)]
struct Quota {
    limit: Option<u64>,
    remaining: Option<u64>,
    reset: Option<u64>,
    // After a 429, no request is sent before this time.
    paused_until: u64,
    error: Option<String>,
    user: Option<Value>,
    user_at: u64,
}

/// The MDBList key, read from Windows Credential Manager once, and what the last responses said about the quota.
pub struct MdbState {
    key: Mutex<Option<Option<String>>>,
    quota: Mutex<Quota>,
    batch: AtomicUsize,
}

impl Default for MdbState {
    fn default() -> Self {
        // Batches of 100 count as one request. Should an account be held to fewer, a 400 drops this to 10 for the run.
        Self { key: Mutex::default(), quota: Mutex::default(), batch: AtomicUsize::new(100) }
    }
}

impl MdbState {
    async fn key(&self) -> Option<String> {
        let mut held = self.key.lock().await;
        held.get_or_insert_with(|| crate::trakt::entry(KEY_ENTRY).ok().and_then(|e| e.get_password().ok())).clone()
    }

    /// Sends a request with the key and notes the quota headers. The key goes in the query, which is never logged.
    async fn send(&self, key: &str, req: reqwest::RequestBuilder, method: &str, path: &str) -> Result<Value, String> {
        // reqwest names the URL in its errors, and this one carries the key.
        let resp = req.query(&[("apikey", key)]).send().await.map_err(|e| format!("MDBList request failed: {}", e.without_url()))?;
        let status = resp.status();
        log_request("mdblist", method, status.as_u16(), path);
        let header = |name: &str| resp.headers().get(name).and_then(|v| v.to_str().ok()?.trim().parse::<u64>().ok());
        let (limit, remaining, reset, retry) =
            (header("x-ratelimit-limit"), header("x-ratelimit-remaining"), header("x-ratelimit-reset"), header("retry-after"));
        let body: Value = resp.json().await.unwrap_or(Value::Null);
        let mut q = self.quota.lock().await;
        // A 429 also carries these, but for whichever limit it hit, so only a success updates the daily numbers.
        if status.is_success() {
            q.limit = limit.or(q.limit);
            q.remaining = remaining.or(q.remaining);
            q.reset = reset.or(q.reset);
            q.error = None;
            return Ok(body);
        }
        let message = body["error"].as_str().unwrap_or("request failed").to_string();
        if status.as_u16() == 429 {
            let daily = message.to_ascii_lowercase().contains("daily");
            if daily {
                q.remaining = Some(0);
                q.reset = reset.or(q.reset);
            }
            q.paused_until = if daily { reset.unwrap_or(now() + 3600) } else { now() + retry.unwrap_or(60) };
        }
        // A refused key fails every request the same way, so it waits an hour rather than trying each batch.
        if matches!(status.as_u16(), 401 | 403) {
            q.paused_until = now() + 3600;
        }
        q.error = Some(message.clone());
        Err(format!("{} MDBList: {message}", status.as_u16()))
    }

    async fn paused(&self) -> bool {
        self.quota.lock().await.paused_until > now()
    }

    async fn status(&self) -> Value {
        let q = self.quota.lock().await;
        let user = q.user.as_ref();
        // Response headers are newest; /user fills in before any rating request has been sent this run.
        let limit = q.limit.or_else(|| user?.get("api_requests")?.as_u64());
        let remaining = q.remaining.or_else(|| Some(limit?.saturating_sub(user?.get("api_requests_count")?.as_u64()?)));
        json!({
            "connected": true,
            "username": user.and_then(|u| u["username"].as_str()),
            "supporter": user.and_then(|u| u["is_supporter"].as_bool()),
            "plan": user.and_then(|u| u["plan"].as_str()),
            "limit": limit,
            "remaining": remaining,
            "reset": q.reset.or_else(|| user?.get("rate_limit_reset")?.as_u64()),
            "paused_until": (q.paused_until > now()).then_some(q.paused_until),
            "error": q.error,
        })
    }

    /// Asks MDBList who the key belongs to and how much quota is left. At most once a minute.
    async fn refresh_user(&self, s: &State, key: &str, force: bool) -> Result<(), String> {
        if !force && self.quota.lock().await.user_at + 60 > now() {
            return Ok(());
        }
        let user = self.send(key, s.http.get(format!("{API}/user")), "GET", "/user").await?;
        let mut q = self.quota.lock().await;
        q.user = Some(user);
        q.user_at = now();
        Ok(())
    }
}

/// Whether a key is saved, and the quota. `refresh` asks MDBList; without it this answers from memory.
#[tauri::command]
pub async fn mdblist_status(s: tauri::State<'_, State>, md: tauri::State<'_, MdbState>, refresh: bool) -> Result<Value, String> {
    let Some(key) = md.key().await else { return Ok(json!({ "connected": false })) };
    if refresh && let Err(e) = md.refresh_user(&s, &key, false).await {
        eprintln!("{e}");
    }
    Ok(md.status().await)
}

/// Checks a key with MDBList, then keeps it in Windows Credential Manager.
#[tauri::command]
pub async fn mdblist_set_key(s: tauri::State<'_, State>, md: tauri::State<'_, MdbState>, key: String) -> Result<Value, String> {
    let key = key.trim().to_string();
    if key.len() < 8 || key.len() > 128 || !key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
        return Err("That doesn't look like an MDBList API key. Copy it from your MDBList preferences.".into());
    }
    *md.quota.lock().await = Quota::default();
    md.refresh_user(&s, &key, true)
        .await
        .map_err(|e| if e.starts_with("401") || e.starts_with("403") { "MDBList didn't accept that key.".to_string() } else { e })?;
    crate::trakt::entry(KEY_ENTRY)?.set_password(&key).map_err(|e| e.to_string())?;
    *md.key.lock().await = Some(Some(key));
    Ok(md.status().await)
}

#[tauri::command]
pub async fn mdblist_forget_key(md: tauri::State<'_, MdbState>) -> Result<(), String> {
    if let Ok(e) = crate::trakt::entry(KEY_ENTRY) {
        let _ = e.delete_credential();
    }
    *md.key.lock().await = Some(None);
    *md.quota.lock().await = Quota::default();
    Ok(())
}

/// A title to rate. `imdb`, `title` and `year` help find it in Nanocrowd; MDBList only needs the TMDB id.
#[derive(Deserialize)]
pub struct Ask {
    kind: String,
    id: u64,
    imdb: Option<String>,
    title: Option<String>,
    year: Option<u32>,
}

/// Ratings for up to 200 titles, in the order asked: `{ imdb, nanocrowd: { rating, size }, mdblist: { score, average,
/// ratings: { source: { value, votes } } } }`, each part null when unknown. `mdblist: false` skips MDBList, so cards
/// showing only Nanocrowd's rating don't use the quota.
#[tauri::command]
pub async fn ratings(
    s: tauri::State<'_, State>,
    nc: tauri::State<'_, NanocrowdState>,
    md: tauri::State<'_, MdbState>,
    items: Vec<Ask>,
    mdblist: bool,
) -> Result<Vec<Value>, String> {
    if items.len() > MAX_ASK {
        return Err(format!("at most {MAX_ASK} titles at once"));
    }
    if items.iter().any(|it| it.kind != "movie" && it.kind != "tv") {
        return Err("bad kind".into());
    }
    let from_mdb = if mdblist { mdblist_many(&s, &md, &items).await } else { HashMap::new() };
    let index = nc.rating_index(&s).await.map_err(|e| eprintln!("{e}")).ok();
    // Lookups that reach Nanocrowd wait their turn inside find_for_card; the rest answer from memory or the cache.
    // shortcut: the answer waits for the slowest lookup, so a first visit to a page of old titles the genre lists
    // miss paints its ratings late. Answering in two passes would fix it if people notice.
    let crowd = join_all(items.iter().map(|it| crowd_rating(&s, &nc, index, it))).await;
    Ok(items
        .iter()
        .zip(crowd)
        .map(|(it, (imdb, crowd))| json!({ "imdb": imdb, "nanocrowd": crowd, "mdblist": from_mdb.get(&(it.kind.clone(), it.id)) }))
        .collect())
}

async fn imdb_of(s: &State, it: &Ask) -> Option<String> {
    if let Some(i) = it.imdb.as_deref().filter(|i| i.starts_with("tt") && i.len() <= 12) {
        return Some(i.to_ascii_lowercase());
    }
    let ids = crate::tmdb_ids(s, &it.kind, it.id).await.ok()?;
    ids["imdb_id"].as_str().filter(|i| i.starts_with("tt")).map(str::to_ascii_lowercase)
}

/// From the genre lists when they have it, else from the catalog, as on a title page.
async fn crowd_rating(s: &State, nc: &NanocrowdState, index: Option<&nanocrowd::RatingIndex>, it: &Ask) -> (Option<String>, Value) {
    let Some(imdb) = imdb_of(s, it).await else { return (None, Value::Null) };
    if let Some((rating, size)) = index.and_then(|ix| ix.get(&imdb)) {
        return (Some(imdb), json!({ "rating": rating, "size": size }));
    }
    let crowd = match (it.title.as_deref(), it.year) {
        (Some(title), Some(year)) if !title.trim().is_empty() => match nanocrowd::find_for_card(s, nc, title, year, &imdb).await {
            Ok(d) => d["crowdRating"].as_f64().map_or(Value::Null, |r| json!({ "rating": r, "size": d["crowdSize"].as_f64() })),
            Err(e) => {
                eprintln!("{e}");
                Value::Null
            }
        },
        _ => Value::Null,
    };
    (Some(imdb), crowd)
}

fn cache_key(kind: &str, id: u64) -> String {
    format!("mdblist {kind} {id}")
}

/// Fresh entries from the cache; the rest in batches. When MDBList fails or the quota is spent, an expired copy is used.
async fn mdblist_many(s: &State, md: &MdbState, items: &[Ask]) -> HashMap<(String, u64), Value> {
    let mut out = HashMap::new();
    let Some(key) = md.key().await else { return out };
    let mut stale = HashMap::new();
    let mut missing: BTreeMap<&str, Vec<u64>> = BTreeMap::new();
    for it in items {
        let slot = (it.kind.clone(), it.id);
        if out.contains_key(&slot) || stale.contains_key(&slot) {
            continue;
        }
        match s.db.peek(&cache_key(&it.kind, it.id)) {
            Some((body, true)) => {
                out.insert(slot, body);
            }
            hit => {
                if let Some((body, _)) = hit {
                    stale.insert(slot, body);
                }
                missing.entry(&it.kind).or_default().push(it.id);
            }
        }
    }
    'kinds: for (kind, ids) in missing {
        let path = format!("/tmdb/{}/", if kind == "tv" { "show" } else { "movie" });
        let mut rest = ids.as_slice();
        while !rest.is_empty() {
            if md.paused().await {
                break 'kinds;
            }
            let size = md.batch.load(Ordering::Relaxed).min(rest.len());
            let (chunk, after) = rest.split_at(size);
            // The logged path says how many titles one request rated, since that is what the daily quota counts.
            let logged = format!("{path} [{} ids]", chunk.len());
            let sent = md.send(&key, s.http.post(format!("{API}{path}")).json(&json!({ "ids": chunk })), "POST", &logged).await;
            match sent {
                Ok(body) => {
                    let mut got: HashMap<u64, Value> =
                        body.as_array().into_iter().flatten().filter_map(|x| Some((tmdb_id(x)?, compact(x)))).collect();
                    for &id in chunk {
                        // A title MDBList doesn't know is remembered too, so it isn't asked for again within 8 hours.
                        let entry = got.remove(&id).unwrap_or_else(|| json!({}));
                        s.db.put(&cache_key(kind, id), &entry, TTL);
                        out.insert((kind.to_string(), id), entry);
                    }
                }
                Err(e) if e.starts_with("400") && size > 10 => {
                    eprintln!("{e}; trying batches of 10");
                    md.batch.store(10, Ordering::Relaxed);
                    continue;
                }
                Err(e) => {
                    eprintln!("{e}");
                    break 'kinds;
                }
            }
            rest = after;
        }
    }
    for (slot, body) in stale {
        out.entry(slot).or_insert(body);
    }
    out
}

/// Batch answers name the title in one of several fields.
fn tmdb_id(x: &Value) -> Option<u64> {
    let num = |v: &Value| v.as_u64().or_else(|| v.as_str()?.parse().ok());
    ["tmdbid", "tmdb_id"].iter().find_map(|f| num(&x[f])).or_else(|| num(&x["ids"]["tmdb"])).or_else(|| num(&x["id"]))
}

/// Only what Filmie shows, so a cached entry is a few hundred bytes.
fn compact(x: &Value) -> Value {
    let mut ratings = Map::new();
    for r in x["ratings"].as_array().into_iter().flatten() {
        let (Some(source), Some(value)) = (r["source"].as_str(), r["value"].as_f64()) else { continue };
        // MDBList sends 0 or null for a source with no data.
        if value > 0.0 {
            ratings.insert(source.to_string(), json!({ "value": value, "votes": r["votes"].as_u64() }));
        }
    }
    let positive = |v: &Value| v.as_f64().filter(|n| *n > 0.0);
    json!({ "score": positive(&x["score"]), "average": positive(&x["score_average"]), "ratings": ratings })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn batch_items_are_matched_and_kept_small() {
        assert_eq!(tmdb_id(&json!({ "ids": { "tmdb": 278, "imdb": "tt0111161" } })), Some(278));
        assert_eq!(tmdb_id(&json!({ "tmdbid": "550" })), Some(550));
        assert_eq!(tmdb_id(&json!({ "id": 13 })), Some(13));
        assert_eq!(tmdb_id(&json!({ "title": "x" })), None);
        let item = json!({
            "title": "The Shawshank Redemption", "score": 91, "score_average": 90, "description": "long text",
            "ratings": [
                { "source": "imdb", "value": 9.3, "score": 93, "votes": 2_900_000 },
                { "source": "tomatoes", "value": 89, "score": 89, "votes": 80 },
                { "source": "metacritic", "value": null, "score": null },
                { "source": "letterboxd", "value": 0, "score": 0 },
            ],
        });
        assert_eq!(
            compact(&item),
            json!({ "score": 91.0, "average": 90.0, "ratings": {
                "imdb": { "value": 9.3, "votes": 2_900_000 }, "tomatoes": { "value": 89.0, "votes": 80 },
            } })
        );
        assert_eq!(compact(&json!({ "score": 0 })), json!({ "score": null, "average": null, "ratings": {} }));
    }
}
