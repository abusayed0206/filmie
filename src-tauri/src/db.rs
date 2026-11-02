//! Local SQLite store: a response cache so repeat views skip the network, and the "Recently played" list.

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
        Self(Mutex::new(conn))
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
