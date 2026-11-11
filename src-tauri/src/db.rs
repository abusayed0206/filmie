//! Local SQLite store: a response cache so repeat views skip the network, the "Recently played" list,
//! and a copy of the Trakt history and ratings that stats are worked out from.

use crate::trakt::State;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    path::Path,
    sync::{Mutex, MutexGuard},
    time::{SystemTime, UNIX_EPOCH},
};

const SCHEMA: &str = "
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS cache (
        key TEXT PRIMARY KEY,
        body TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        user_scoped INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS history (
        kind TEXT NOT NULL,
        id INTEGER NOT NULL,
        title TEXT NOT NULL,
        season INTEGER,
        episode INTEGER,
        position REAL NOT NULL,
        duration REAL NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (kind, id)
    );
    CREATE TABLE IF NOT EXISTS trakt_history (
        id INTEGER PRIMARY KEY,
        kind TEXT NOT NULL,
        watched_at INTEGER NOT NULL,
        trakt_id INTEGER NOT NULL,
        tmdb_id INTEGER,
        title TEXT NOT NULL,
        season INTEGER,
        episode INTEGER,
        runtime INTEGER NOT NULL DEFAULT 0,
        genres TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS trakt_history_watched_at ON trakt_history (watched_at);
    CREATE TABLE IF NOT EXISTS trakt_ratings (
        kind TEXT NOT NULL,
        trakt_id INTEGER NOT NULL,
        rating INTEGER NOT NULL,
        rated_at INTEGER NOT NULL,
        PRIMARY KEY (kind, trakt_id)
    );
    CREATE TABLE IF NOT EXISTS sync_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS downloads (
        id INTEGER PRIMARY KEY,
        kind TEXT NOT NULL,
        tmdb_id INTEGER NOT NULL,
        season INTEGER NOT NULL DEFAULT 0,
        episode INTEGER NOT NULL DEFAULT 0,
        title TEXT NOT NULL,
        episode_title TEXT,
        status TEXT NOT NULL,
        done_bytes INTEGER NOT NULL DEFAULT 0,
        total_bytes INTEGER NOT NULL DEFAULT 0,
        dir TEXT,
        file TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE (kind, tmdb_id, season, episode)
    );
";
// Expired rows stay a while as an offline fallback.
const KEEP_EXPIRED_SECS: i64 = 30 * 86_400;
const HISTORY_LIMIT: i64 = 100;

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64
}

#[derive(Debug, PartialEq, Serialize, Deserialize)]
pub struct Played {
    pub kind: String,
    pub id: i64,
    pub title: String,
    pub season: Option<i64>,
    pub episode: Option<i64>,
    pub position: f64,
    pub duration: f64,
    #[serde(default)]
    pub updated_at: i64,
}

/// One offline download. A movie has season and episode 0. `status` is queued, finding (the app is looking for the
/// video on the user's servers), downloading, done, failed or protected (encrypted, so it is never downloaded).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Download {
    #[serde(default)]
    pub id: i64,
    pub kind: String,
    pub tmdb_id: i64,
    #[serde(default)]
    pub season: i64,
    #[serde(default)]
    pub episode: i64,
    pub title: String,
    #[serde(default)]
    pub episode_title: Option<String>,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub done_bytes: i64,
    #[serde(default)]
    pub total_bytes: i64,
    #[serde(default)]
    pub dir: Option<String>,
    #[serde(default)]
    pub file: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub created_at: i64,
}

const DOWNLOAD_COLUMNS: &str =
    "id, kind, tmdb_id, season, episode, title, episode_title, status, done_bytes, total_bytes, dir, file, error, created_at";

fn download_row(r: &rusqlite::Row) -> rusqlite::Result<Download> {
    Ok(Download {
        id: r.get(0)?,
        kind: r.get(1)?,
        tmdb_id: r.get(2)?,
        season: r.get(3)?,
        episode: r.get(4)?,
        title: r.get(5)?,
        episode_title: r.get(6)?,
        status: r.get(7)?,
        done_bytes: r.get(8)?,
        total_bytes: r.get(9)?,
        dir: r.get(10)?,
        file: r.get(11)?,
        error: r.get(12)?,
        created_at: r.get(13)?,
    })
}

/// How much of the Trakt history is stored locally.
pub struct HistoryBounds {
    pub count: i64,
    pub newest: Option<i64>,
}

fn unix_time(conn: &Connection, text: &str) -> Option<i64> {
    conn.query_row("SELECT CAST(strftime('%s', ?1) AS INTEGER)", [text], |r| r.get(0)).ok().flatten()
}

/// Stores one /sync/history item. Returns false, storing nothing, if it lacks what a play needs.
fn store_play(conn: &Connection, item: &Value) -> rusqlite::Result<bool> {
    let (kind, media) = match (item.get("movie").filter(|m| m.is_object()), item.get("show").filter(|s| s.is_object())) {
        (Some(movie), _) => ("movie", movie),
        (None, Some(show)) => ("episode", show),
        (None, None) => return Ok(false),
    };
    let watched_at = item["watched_at"].as_str().and_then(|t| unix_time(conn, t));
    let (Some(id), Some(watched_at), Some(trakt_id), Some(title)) =
        (item["id"].as_i64(), watched_at, media["ids"]["trakt"].as_i64(), media["title"].as_str())
    else {
        return Ok(false);
    };
    let episode = &item["episode"];
    let genres = media.get("genres").filter(|g| g.is_array()).map_or_else(|| "[]".to_string(), Value::to_string);
    conn.prepare_cached(
        "INSERT OR REPLACE INTO trakt_history (id, kind, watched_at, trakt_id, tmdb_id, title, season, episode, runtime, genres)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
    )?
    .execute(params![
        id,
        kind,
        watched_at,
        trakt_id,
        media["ids"]["tmdb"].as_i64(),
        title,
        episode["season"].as_i64(),
        episode["number"].as_i64(),
        episode["runtime"].as_i64().or(media["runtime"].as_i64()).unwrap_or(0),
        genres
    ])?;
    Ok(true)
}

/// Stores one rating. Returns false, storing nothing, if it isn't a rating from 1 to 10 of something identifiable.
fn store_rating(conn: &Connection, item: &Value) -> rusqlite::Result<bool> {
    let kind = item["type"].as_str().unwrap_or_default();
    let rated_at = item["rated_at"].as_str().and_then(|t| unix_time(conn, t));
    let (Some(trakt_id), Some(rating), Some(rated_at)) = (item[kind]["ids"]["trakt"].as_i64(), item["rating"].as_i64(), rated_at) else {
        return Ok(false);
    };
    if !(1..=10).contains(&rating) {
        return Ok(false);
    }
    conn.prepare_cached("INSERT OR REPLACE INTO trakt_ratings (kind, trakt_id, rating, rated_at) VALUES (?1, ?2, ?3, ?4)")?
        .execute(params![kind, trakt_id, rating, rated_at])?;
    Ok(true)
}

pub struct Db(Mutex<Connection>);

impl Db {
    /// Opens the store. If the file can't be used the app still runs, with a store that lasts until it closes.
    pub fn open(path: impl AsRef<Path>) -> Self {
        let open = |c: Connection| c.execute_batch(SCHEMA).map(|_| c);
        let conn = Connection::open(path).and_then(open).unwrap_or_else(|e| {
            eprintln!("local database unavailable: {e}");
            Connection::open_in_memory().and_then(open).expect("SQLite can always open in memory")
        });
        let _ = conn.execute("DELETE FROM cache WHERE expires_at < ?1", [now() - KEEP_EXPIRED_SECS]);
        // Work that was cut off by closing the app starts again from the queue, where downloads resume.
        let _ = conn.execute("UPDATE downloads SET status = 'queued' WHERE status IN ('finding', 'downloading')", []);
        Self(Mutex::new(conn))
    }

    pub fn setting(&self, key: &str) -> Option<String> {
        self.conn().query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0)).optional().ok().flatten()
    }

    pub fn set_setting(&self, key: &str, value: &str) -> rusqlite::Result<()> {
        self.conn().execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)", [key, value]).map(|_| ())
    }

    /// Queues downloads. One already queued or done stays as it is; one that failed is tried again.
    pub fn download_add(&self, items: &[Download]) -> rusqlite::Result<()> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        for d in items {
            tx.execute(
                "INSERT INTO downloads (kind, tmdb_id, season, episode, title, episode_title, status, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'queued', ?7)
                 ON CONFLICT (kind, tmdb_id, season, episode) DO UPDATE SET status = 'queued', error = NULL, done_bytes = 0, total_bytes = 0
                 WHERE status IN ('failed', 'protected')",
                params![d.kind, d.tmdb_id, d.season, d.episode, d.title, d.episode_title, now()],
            )?;
        }
        tx.commit()
    }

    pub fn download_list(&self) -> rusqlite::Result<Vec<Download>> {
        let conn = self.conn();
        let mut query = conn.prepare(&format!("SELECT {DOWNLOAD_COLUMNS} FROM downloads ORDER BY created_at, id"))?;
        query.query_map([], download_row)?.collect()
    }

    pub fn download_get(&self, id: i64) -> rusqlite::Result<Option<Download>> {
        self.conn().query_row(&format!("SELECT {DOWNLOAD_COLUMNS} FROM downloads WHERE id = ?1"), [id], download_row).optional()
    }

    /// The next queued download, now marked as finding, unless one is already being found or downloaded:
    /// video links often expire within minutes, so each is found just before it downloads.
    pub fn download_next(&self) -> rusqlite::Result<Option<Download>> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        let busy: i64 = tx.query_row("SELECT COUNT(*) FROM downloads WHERE status IN ('finding', 'downloading')", [], |r| r.get(0))?;
        let next = if busy > 0 {
            None
        } else {
            tx.query_row(
                &format!("SELECT {DOWNLOAD_COLUMNS} FROM downloads WHERE status = 'queued' ORDER BY created_at, id LIMIT 1"),
                [],
                download_row,
            )
            .optional()?
        };
        if let Some(d) = &next {
            tx.execute("UPDATE downloads SET status = 'finding' WHERE id = ?1", [d.id])?;
        }
        tx.commit()?;
        Ok(next.map(|d| Download { status: "finding".into(), ..d }))
    }

    pub fn download_status(&self, id: i64, status: &str, error: Option<&str>) -> rusqlite::Result<()> {
        self.conn().execute("UPDATE downloads SET status = ?2, error = ?3 WHERE id = ?1", params![id, status, error]).map(|_| ())
    }

    pub fn download_started(&self, id: i64, dir: &str) -> rusqlite::Result<()> {
        self.conn()
            .execute("UPDATE downloads SET status = 'downloading', dir = ?2, error = NULL WHERE id = ?1", params![id, dir])
            .map(|_| ())
    }

    pub fn download_progress(&self, id: i64, done: i64, total: i64) -> rusqlite::Result<()> {
        self.conn().execute("UPDATE downloads SET done_bytes = ?2, total_bytes = ?3 WHERE id = ?1", params![id, done, total]).map(|_| ())
    }

    pub fn download_done(&self, id: i64, file: &str, bytes: i64) -> rusqlite::Result<()> {
        self.conn()
            .execute(
                "UPDATE downloads SET status = 'done', file = ?2, done_bytes = ?3, total_bytes = ?3, error = NULL WHERE id = ?1",
                params![id, file, bytes],
            )
            .map(|_| ())
    }

    pub fn download_delete(&self, id: i64) -> rusqlite::Result<()> {
        self.conn().execute("DELETE FROM downloads WHERE id = ?1", [id]).map(|_| ())
    }

    fn conn(&self) -> MutexGuard<'_, Connection> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn lookup(&self, key: &str) -> Option<(Value, i64)> {
        let row: Option<(String, i64)> = self
            .conn()
            .query_row("SELECT body, expires_at FROM cache WHERE key = ?1", [key], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()
            .ok()?;
        let (body, expires_at) = row?;
        Some((serde_json::from_str(&body).ok()?, expires_at))
    }

    fn store(&self, key: &str, body: &Value, ttl: i64, user_scoped: bool) {
        let result = self.conn().execute(
            "INSERT OR REPLACE INTO cache (key, body, expires_at, user_scoped) VALUES (?1, ?2, ?3, ?4)",
            params![key, body.to_string(), now() + ttl, user_scoped],
        );
        if let Err(e) = result {
            eprintln!("could not cache a response: {e}");
        }
    }

    /// Returns a fresh cached response, or fetches and stores one. An expired copy is used when the fetch fails,
    /// which keeps the app working offline, except on 401 because the user has to sign in again.
    pub async fn through(
        &self,
        key: &str,
        ttl: i64,
        user_scoped: bool,
        fetch: impl Future<Output = Result<Value, String>>,
    ) -> Result<Value, String> {
        let hit = self.lookup(key);
        if let Some((body, expires_at)) = &hit
            && *expires_at > now()
        {
            return Ok(body.clone());
        }
        match fetch.await {
            Ok(body) => {
                // Trakt answers 204 with no body when there's nothing to report.
                if !body.is_null() {
                    self.store(key, &body, ttl, user_scoped);
                }
                Ok(body)
            }
            Err(e) if e.starts_with("401") => Err(e),
            Err(e) => hit.map(|(body, _)| body).ok_or(e),
        }
    }

    /// Forgets responses that depend on the signed-in user, after a write, new activity or sign-out.
    pub fn clear_user(&self) {
        let _ = self.conn().execute("DELETE FROM cache WHERE user_scoped = 1", []);
    }

    fn save_played(&self, p: &Played) -> rusqlite::Result<()> {
        let conn = self.conn();
        // Reopening the same episode reports position 0 until the video starts, which must not erase its progress.
        conn.execute(
            "INSERT INTO history (kind, id, title, season, episode, position, duration, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT (kind, id) DO UPDATE SET
                position = CASE WHEN season IS excluded.season AND episode IS excluded.episode AND excluded.position = 0
                                THEN position ELSE excluded.position END,
                duration = CASE WHEN season IS excluded.season AND episode IS excluded.episode AND excluded.position = 0
                                THEN duration ELSE excluded.duration END,
                title = excluded.title, season = excluded.season, episode = excluded.episode, updated_at = excluded.updated_at",
            params![p.kind, p.id, p.title, p.season, p.episode, p.position, p.duration, now()],
        )?;
        conn.execute(
            "DELETE FROM history WHERE rowid NOT IN (SELECT rowid FROM history ORDER BY updated_at DESC, rowid DESC LIMIT ?1)",
            [HISTORY_LIMIT],
        )?;
        Ok(())
    }

    fn list_played(&self, limit: i64) -> rusqlite::Result<Vec<Played>> {
        let conn = self.conn();
        let mut query = conn.prepare(
            "SELECT kind, id, title, season, episode, position, duration, updated_at
             FROM history ORDER BY updated_at DESC, rowid DESC LIMIT ?1",
        )?;
        query
            .query_map([limit], |r| {
                Ok(Played {
                    kind: r.get(0)?,
                    id: r.get(1)?,
                    title: r.get(2)?,
                    season: r.get(3)?,
                    episode: r.get(4)?,
                    position: r.get(5)?,
                    duration: r.get(6)?,
                    updated_at: r.get(7)?,
                })
            })?
            .collect()
    }

    fn cache_stats(&self) -> rusqlite::Result<(i64, i64)> {
        self.conn().query_row("SELECT COUNT(*), COALESCE(SUM(LENGTH(body)), 0) FROM cache", [], |r| Ok((r.get(0)?, r.get(1)?)))
    }

    /// Stores a page of history in one transaction, so closing the app can't leave half a page.
    pub fn store_history(&self, items: &[Value]) -> rusqlite::Result<()> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        for item in items {
            if !store_play(&tx, item)? {
                eprintln!("skipped a Trakt history item without an id, a date or a title");
            }
        }
        tx.commit()
    }

    pub fn replace_ratings(&self, items: &[Value]) -> rusqlite::Result<()> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM trakt_ratings", [])?;
        for item in items {
            if !store_rating(&tx, item)? {
                eprintln!("skipped a Trakt rating that wasn't 1 to 10 of a known title");
            }
        }
        tx.commit()
    }

    pub fn history_bounds(&self) -> rusqlite::Result<HistoryBounds> {
        self.conn().query_row("SELECT COUNT(*), MAX(watched_at) FROM trakt_history", [], |r| {
            Ok(HistoryBounds { count: r.get(0)?, newest: r.get(1)? })
        })
    }

    pub fn iso_time(&self, at: i64) -> rusqlite::Result<String> {
        self.conn().query_row("SELECT strftime('%Y-%m-%dT%H:%M:%S.000Z', ?1, 'unixepoch')", [at], |r| r.get(0))
    }

    pub fn sync_value(&self, key: &str) -> Option<String> {
        self.conn().query_row("SELECT value FROM sync_state WHERE key = ?1", [key], |r| r.get(0)).optional().ok().flatten()
    }

    pub fn set_sync_value(&self, key: &str, value: &str) -> rusqlite::Result<()> {
        self.conn().execute("INSERT OR REPLACE INTO sync_state (key, value) VALUES (?1, ?2)", [key, value]).map(|_| ())
    }

    /// Starts the history sync over, for when the local copy no longer matches Trakt.
    pub fn restart_history(&self) -> rusqlite::Result<()> {
        self.conn().execute_batch("DELETE FROM trakt_history; DELETE FROM sync_state;")
    }

    /// Deletes everything copied from a Trakt account. Recently played isn't Trakt's and stays.
    pub fn clear_trakt_data(&self) -> rusqlite::Result<()> {
        self.conn().execute_batch("DELETE FROM trakt_history; DELETE FROM trakt_ratings; DELETE FROM sync_state;")
    }

    pub fn history_progress(&self) -> rusqlite::Result<Value> {
        let synced = self.history_bounds()?.count;
        let total: i64 = self.sync_value("history_total").and_then(|t| t.parse().ok()).unwrap_or(0);
        Ok(json!({ "synced": synced, "total": total, "complete": self.sync_value("history_complete").as_deref() == Some("1") }))
    }

    /// Totals worked out from the local copy, so this needs no network. `kind` narrows them to `movie` or `episode`,
    /// where a rating of a show or season counts with episodes. `days` always covers everything, for the streak.
    fn stats(&self, kind: Option<&str>) -> rusqlite::Result<Value> {
        let mut result = self.history_progress()?;
        let conn = self.conn();
        let (movies, shows, episodes, minutes): (i64, i64, i64, i64) = conn.query_row(
            "SELECT COUNT(DISTINCT CASE WHEN kind = 'movie' THEN trakt_id END), COUNT(DISTINCT CASE WHEN kind = 'episode' THEN trakt_id END),
                    COUNT(CASE WHEN kind = 'episode' THEN 1 END), COALESCE(SUM(runtime), 0)
             FROM trakt_history WHERE ?1 IS NULL OR kind = ?1",
            [kind],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )?;
        let pairs = |sql: &str, field: &str, value: &str, param: Option<&str>| -> rusqlite::Result<Vec<Value>> {
            let mut query = conn.prepare(sql)?;
            query
                .query_map([param], |r| {
                    let name: rusqlite::types::Value = r.get(0)?;
                    let name = match name {
                        rusqlite::types::Value::Integer(n) => json!(n),
                        rusqlite::types::Value::Text(t) => json!(t),
                        _ => Value::Null,
                    };
                    Ok(json!({ field: name, value: r.get::<_, i64>(1)? }))
                })?
                .collect()
        };
        let top_genres = pairs(
            "SELECT g.value, COUNT(*) AS plays FROM trakt_history h, json_each(h.genres) g
             WHERE ?1 IS NULL OR h.kind = ?1 GROUP BY g.value ORDER BY plays DESC, g.value LIMIT 10",
            "genre",
            "plays",
            kind,
        )?;
        let ratings = pairs(
            "SELECT rating, COUNT(*) FROM trakt_ratings
             WHERE ?1 IS NULL OR (?1 = 'movie' AND kind = 'movie') OR (?1 = 'episode' AND kind <> 'movie') GROUP BY rating ORDER BY rating",
            "rating",
            "count",
            kind,
        )?;
        let by_month = pairs(
            "SELECT strftime('%Y-%m', watched_at, 'unixepoch', 'localtime') AS month, COUNT(*) FROM trakt_history
             WHERE ?1 IS NULL OR kind = ?1 GROUP BY month ORDER BY month",
            "month",
            "plays",
            kind,
        )?;
        let days: Vec<String> = conn
            .prepare("SELECT DISTINCT date(watched_at, 'unixepoch', 'localtime') AS day FROM trakt_history ORDER BY day DESC")?
            .query_map([], |r| r.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        let extra = json!({
            "movies": movies, "shows": shows, "episodes": episodes, "minutes": minutes,
            "top_genres": top_genres, "ratings": ratings, "by_month": by_month, "days": days,
        });
        for (k, v) in extra.as_object().into_iter().flatten() {
            result[k] = v.clone();
        }
        Ok(result)
    }
}

/// Reads only local data, so it works offline and when signed out.
#[tauri::command]
pub fn stats(s: tauri::State<'_, State>, kind: Option<String>) -> Result<Value, String> {
    s.db.stats(kind.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn history_save(s: tauri::State<'_, State>, entry: Played) -> Result<(), String> {
    if entry.kind != "movie" && entry.kind != "tv" {
        return Err("bad history entry".into());
    }
    s.db.save_played(&entry).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn history_list(s: tauri::State<'_, State>, limit: i64) -> Result<Vec<Played>, String> {
    s.db.list_played(limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn history_clear(s: tauri::State<'_, State>) -> Result<(), String> {
    s.db.conn().execute("DELETE FROM history", []).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cache_info(s: tauri::State<'_, State>) -> Result<Value, String> {
    let (count, bytes) = s.db.cache_stats().map_err(|e| e.to_string())?;
    Ok(json!({ "count": count, "bytes": bytes }))
}

#[tauri::command]
pub fn cache_clear(s: tauri::State<'_, State>) -> Result<(), String> {
    s.db.conn().execute("DELETE FROM cache", []).map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::Cell, time::Instant};
    use tauri::async_runtime::block_on;

    fn db() -> Db {
        Db::open(":memory:")
    }

    fn played(season: Option<i64>, episode: Option<i64>, position: f64, duration: f64) -> Played {
        Played { kind: "tv".into(), id: 1, title: "Show".into(), season, episode, position, duration, updated_at: 0 }
    }

    #[test]
    fn fresh_responses_skip_the_network() {
        let db = db();
        let calls = Cell::new(0);
        let fetch = || async {
            calls.set(calls.get() + 1);
            Ok(json!({ "n": 1 }))
        };
        assert_eq!(block_on(db.through("k", 60, false, fetch())).unwrap(), json!({ "n": 1 }));
        assert_eq!(block_on(db.through("k", 60, false, fetch())).unwrap(), json!({ "n": 1 }));
        assert_eq!(calls.get(), 1);
    }

    #[test]
    fn expired_responses_refetch_and_fall_back_when_offline() {
        let db = db();
        block_on(db.through("k", -10, false, async { Ok(json!("old")) })).unwrap();
        assert_eq!(block_on(db.through("k", 60, false, async { Err("offline".to_string()) })).unwrap(), json!("old"));
        assert!(block_on(db.through("k", 60, false, async { Err("401 sign in".to_string()) })).is_err());
        assert!(block_on(db.through("other", 60, false, async { Err("offline".to_string()) })).is_err());
        assert_eq!(block_on(db.through("k", 60, false, async { Ok(json!("new")) })).unwrap(), json!("new"));
    }

    #[test]
    fn empty_responses_are_not_cached() {
        let db = db();
        block_on(db.through("k", 60, false, async { Ok(Value::Null) })).unwrap();
        assert_eq!(db.cache_stats().unwrap().0, 0);
    }

    #[test]
    fn clear_user_keeps_public_responses() {
        let db = db();
        db.store("public", &json!(1), 60, false);
        db.store("mine", &json!(2), 60, true);
        db.clear_user();
        assert!(db.lookup("public").is_some());
        assert!(db.lookup("mine").is_none());
    }

    #[test]
    fn reopening_an_episode_keeps_its_progress() {
        let db = db();
        db.save_played(&played(Some(1), Some(2), 600.0, 2400.0)).unwrap();
        db.save_played(&played(Some(1), Some(2), 0.0, 0.0)).unwrap();
        let got = &db.list_played(10).unwrap()[0];
        assert_eq!((got.position, got.duration), (600.0, 2400.0));

        db.save_played(&played(Some(1), Some(2), 700.0, 2400.0)).unwrap();
        assert_eq!(db.list_played(10).unwrap()[0].position, 700.0);

        // A different episode replaces the show's entry and starts again.
        db.save_played(&played(Some(1), Some(3), 0.0, 0.0)).unwrap();
        let got = db.list_played(10).unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!((got[0].episode, got[0].position), (Some(3), 0.0));
    }

    #[test]
    fn history_is_newest_first_and_bounded() {
        let db = db();
        for id in 0..HISTORY_LIMIT + 20 {
            db.save_played(&Played { id, ..played(None, None, 1.0, 2.0) }).unwrap();
        }
        let got = db.list_played(1000).unwrap();
        assert_eq!(got.len(), HISTORY_LIMIT as usize);
        assert_eq!(got[0].id, HISTORY_LIMIT + 19);
    }

    fn movie_play(id: i64, at: &str, trakt: i64, runtime: i64, genres: &[&str]) -> Value {
        json!({ "id": id, "watched_at": at, "movie": { "title": "M", "runtime": runtime, "genres": genres, "ids": { "trakt": trakt, "tmdb": 1 } } })
    }

    fn episode_play(id: i64, at: &str, show: i64, genres: &[&str]) -> Value {
        json!({ "id": id, "watched_at": at, "episode": { "season": 1, "number": id, "runtime": 45 }, "show": { "title": "S", "runtime": 60, "genres": genres, "ids": { "trakt": show } } })
    }

    #[test]
    fn repeated_pages_are_idempotent_and_bad_items_are_skipped() {
        let db = db();
        let page = [
            movie_play(1, "2026-01-02T03:04:05.000Z", 10, 100, &["drama"]),
            json!({ "id": 2, "watched_at": "2026-01-01T00:00:00.000Z" }),
            json!({ "watched_at": "2026-01-01T00:00:00.000Z", "movie": { "title": "No id", "ids": { "trakt": 3 } } }),
            json!({ "id": 4, "movie": { "title": "No date", "ids": { "trakt": 4 } } }),
            json!({ "id": 5, "watched_at": "nonsense", "movie": { "title": "Bad date", "ids": { "trakt": 5 } } }),
            json!({ "id": 6, "watched_at": "2026-01-01T00:00:00.000Z", "movie": { "ids": { "trakt": 6 } } }),
        ];
        db.store_history(&page).unwrap();
        db.store_history(&page).unwrap();
        let bounds = db.history_bounds().unwrap();
        assert_eq!(bounds.count, 1);
        assert_eq!(bounds.newest, Some(1_767_323_045));
        assert_eq!(db.iso_time(1_767_323_045).unwrap(), "2026-01-02T03:04:05.000Z");
    }

    #[test]
    fn plays_sharing_a_second_are_all_kept() {
        let db = db();
        assert_eq!(db.history_bounds().unwrap().newest, None);
        let plays: Vec<Value> = (1..=250).map(|i| movie_play(i, "2026-01-01T00:00:00.000Z", i, 90, &[])).collect();
        db.store_history(&plays).unwrap();
        db.store_history(&[movie_play(251, "2026-06-01T00:00:00.000Z", 251, 90, &[])]).unwrap();
        let bounds = db.history_bounds().unwrap();
        assert_eq!(bounds.count, 251);
    }

    #[test]
    fn stats_add_up() {
        let db = db();
        db.store_history(&[
            movie_play(1, "2026-01-15T12:00:00.000Z", 10, 100, &["drama", "war"]),
            movie_play(2, "2026-02-15T12:00:00.000Z", 10, 100, &["drama", "war"]), // a rewatch
            episode_play(3, "2026-02-16T12:00:00.000Z", 20, &["drama"]),
            episode_play(4, "2026-02-16T13:00:00.000Z", 20, &["drama"]),
            episode_play(5, "2026-02-17T12:00:00.000Z", 21, &["comedy"]),
        ])
        .unwrap();
        db.replace_ratings(&[
            json!({ "type": "movie", "rating": 8, "rated_at": "2026-01-16T00:00:00.000Z", "movie": { "ids": { "trakt": 10 } } }),
            json!({ "type": "show", "rating": 8, "rated_at": "2026-01-16T00:00:00.000Z", "show": { "ids": { "trakt": 20 } } }),
            json!({ "type": "episode", "rating": 11, "rated_at": "2026-01-16T00:00:00.000Z", "episode": { "ids": { "trakt": 30 } } }),
            json!({ "type": "season", "rating": 0, "rated_at": "2026-01-16T00:00:00.000Z", "season": { "ids": { "trakt": 31 } } }),
        ])
        .unwrap();

        let all = db.stats(None).unwrap();
        assert_eq!((&all["movies"], &all["shows"], &all["episodes"], &all["minutes"]), (&json!(1), &json!(2), &json!(3), &json!(335)));
        assert_eq!(
            all["top_genres"],
            json!([{ "genre": "drama", "plays": 4 }, { "genre": "war", "plays": 2 }, { "genre": "comedy", "plays": 1 }])
        );
        assert_eq!(all["ratings"], json!([{ "rating": 8, "count": 2 }]), "ratings outside 1 to 10 are skipped");
        assert_eq!(all["by_month"].as_array().unwrap().len(), 2);
        assert_eq!(all["by_month"][1]["plays"], json!(4));
        assert_eq!(all["days"].as_array().unwrap().len(), 4);
        assert_eq!(all["days"][0], "2026-02-17", "newest first");

        let movies = db.stats(Some("movie")).unwrap();
        assert_eq!((&movies["movies"], &movies["shows"], &movies["minutes"]), (&json!(1), &json!(0), &json!(200)));
        assert_eq!(movies["ratings"], json!([{ "rating": 8, "count": 1 }]));
        assert_eq!(movies["days"].as_array().unwrap().len(), 4, "the streak ignores the mode");
        let shows = db.stats(Some("episode")).unwrap();
        assert_eq!(shows["top_genres"], json!([{ "genre": "drama", "plays": 2 }, { "genre": "comedy", "plays": 1 }]));
        assert_eq!(shows["ratings"], json!([{ "rating": 8, "count": 1 }]));
    }

    #[test]
    fn stats_are_zero_when_empty() {
        let stats = db().stats(None).unwrap();
        assert_eq!(
            stats,
            json!({ "movies": 0, "shows": 0, "episodes": 0, "minutes": 0, "top_genres": [], "ratings": [], "by_month": [], "days": [], "synced": 0, "total": 0, "complete": false })
        );
    }

    #[test]
    fn restarting_keeps_ratings_and_clearing_keeps_recently_played() {
        let db = db();
        let rating = json!({ "type": "movie", "rating": 8, "rated_at": "2026-01-16T00:00:00.000Z", "movie": { "ids": { "trakt": 10 } } });
        let fill = |db: &Db| {
            db.store_history(&[movie_play(1, "2026-01-15T12:00:00.000Z", 10, 100, &[])]).unwrap();
            db.replace_ratings(std::slice::from_ref(&rating)).unwrap();
            db.set_sync_value("history_complete", "1").unwrap();
        };
        fill(&db);
        db.save_played(&played(None, None, 1.0, 2.0)).unwrap();
        db.restart_history().unwrap();
        assert_eq!(db.history_bounds().unwrap().count, 0);
        assert_eq!(db.sync_value("history_complete"), None);
        assert_eq!(db.stats(None).unwrap()["ratings"].as_array().unwrap().len(), 1);

        fill(&db);
        db.clear_trakt_data().unwrap();
        let stats = db.stats(None).unwrap();
        assert_eq!((&stats["synced"], &stats["complete"], &stats["ratings"]), (&json!(0), &json!(false), &json!([])));
        assert_eq!(db.list_played(10).unwrap().len(), 1, "Recently played stays");
    }

    fn download(kind: &str, season: i64, episode: i64) -> Download {
        Download {
            id: 0,
            kind: kind.into(),
            tmdb_id: 7,
            season,
            episode,
            title: "T".into(),
            episode_title: None,
            status: String::new(),
            done_bytes: 0,
            total_bytes: 0,
            dir: None,
            file: None,
            error: None,
            created_at: 0,
        }
    }

    #[test]
    fn download_queue_runs_one_at_a_time_and_survives_a_restart() {
        let dir = std::env::temp_dir().join(format!("filmie-queue-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("q.sqlite3");
        let _ = std::fs::remove_file(&path);
        let db = Db::open(&path);
        db.download_add(&[download("tv", 1, 1), download("tv", 1, 2), download("tv", 1, 1)]).unwrap();
        assert_eq!(db.download_list().unwrap().len(), 2, "the same episode is queued once");

        let first = db.download_next().unwrap().unwrap();
        assert_eq!((first.episode, first.status.as_str()), (1, "finding"));
        assert_eq!(db.download_next().unwrap(), None, "nothing else starts while one is being found");
        db.download_started(first.id, "D:\\x").unwrap();
        assert_eq!(db.download_next().unwrap(), None, "or downloaded");

        // Closing the app mid-download puts it back in the queue.
        drop(db);
        let db = Db::open(&path);
        assert_eq!(db.download_get(first.id).unwrap().unwrap().status, "queued");
        let again = db.download_next().unwrap().unwrap();
        assert_eq!(again.id, first.id, "the oldest goes first");
        db.download_done(again.id, "D:\\x\\a.mp4", 10).unwrap();
        let second = db.download_next().unwrap().unwrap();
        db.download_status(second.id, "protected", Some("encrypted")).unwrap();
        assert_eq!(db.download_next().unwrap(), None);

        // Adding again retries a failure but leaves a finished one alone.
        db.download_add(&[download("tv", 1, 1), download("tv", 1, 2)]).unwrap();
        let list = db.download_list().unwrap();
        assert_eq!((list[0].status.as_str(), list[1].status.as_str()), ("done", "queued"));
        assert_eq!(list[1].error, None);
        db.download_delete(list[0].id).unwrap();
        assert_eq!(db.download_list().unwrap().len(), 1);
        drop(db);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn settings_outlive_sign_out() {
        let db = db();
        db.set_setting("download_folder", "D:\\Movies").unwrap();
        db.clear_trakt_data().unwrap();
        assert_eq!(db.setting("download_folder").as_deref(), Some("D:\\Movies"));
    }

    // A budget far above normal so slow CI machines pass, while a broken index or query still fails.
    #[test]
    fn cache_reads_stay_fast() {
        let db = db();
        let body = json!({ "text": "x".repeat(20_000) });
        for i in 0..1000 {
            db.store(&format!("k{i}"), &body, 60, false);
        }
        let start = Instant::now();
        for i in 0..1000 {
            assert!(db.lookup(&format!("k{i}")).is_some());
        }
        let elapsed = start.elapsed();
        println!("1000 lookups of 20 KB took {elapsed:?}");
        assert!(elapsed.as_secs() < 5, "cache reads took {elapsed:?}");
    }
}
