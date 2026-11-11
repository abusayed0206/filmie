//! Offline downloads. The app finds a video's address on the user's own servers (see `INJECT_PLAYER` and the
//! WebView2 network hook in main.rs), and this module saves it to the chosen folder: a direct file as it is, an HLS
//! stream as its segments plus a local playlist, or, when ffmpeg is installed, remuxed into one .mp4.
//! Encrypted or DRM-protected streams are never downloaded: they are marked `protected` instead.

use crate::{db::Download, trakt::State};
use reqwest::{Client, header};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicI64, AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, Url};

const FOLDER_KEY: &str = "download_folder";
const SEGMENTS_AT_ONCE: usize = 4;

pub struct Downloads {
    http: Client,
    cancelled: Mutex<HashSet<i64>>,
}

impl Default for Downloads {
    fn default() -> Self {
        Self {
            // No total timeout, since a film takes a while; a stalled connection still ends.
            http: Client::builder()
                .connect_timeout(Duration::from_secs(15))
                .read_timeout(Duration::from_secs(60))
                .build()
                .unwrap_or_default(),
            cancelled: Mutex::default(),
        }
    }
}

#[derive(Debug)]
enum Stop {
    Protected(String),
    Failed(String),
    Cancelled,
}

impl<E: std::fmt::Display> From<E> for Stop {
    fn from(e: E) -> Self {
        Stop::Failed(e.to_string())
    }
}

const PROTECTED: &str = "This video is encrypted, so it can't be downloaded.";

/// Downloads go on any drive but the one Windows runs from, so a big download can't fill the system drive.
/// `system_drive` is %SystemDrive%, like "C:". Network shares are allowed.
pub fn check_folder(path: &str, system_drive: &str) -> Result<(), String> {
    let p = path.strip_prefix(r"\\?\").or_else(|| path.strip_prefix(r"\\.\")).unwrap_or(path);
    if p.starts_with(r"UNC\") || p.starts_with(r"\\") {
        return Ok(());
    }
    let mut chars = p.chars();
    let (Some(letter), Some(':')) = (chars.next(), chars.next()) else {
        return Err("Choose a folder on a drive, like D:\\Movies.".into());
    };
    if !letter.is_ascii_alphabetic() {
        return Err("Choose a folder on a drive, like D:\\Movies.".into());
    }
    let system = system_drive.trim().chars().next().filter(char::is_ascii_alphabetic).unwrap_or('C');
    if letter.eq_ignore_ascii_case(&system) {
        return Err(format!(
            "Downloads can't go on the Windows drive ({}:). Choose a folder on another drive.",
            system.to_ascii_uppercase()
        ));
    }
    Ok(())
}

fn system_drive() -> String {
    std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into())
}

/// Picks the folder, resolves links and junctions so they can't point back at the system drive, and checks it can be written.
fn accept_folder(picked: &Path) -> Result<PathBuf, String> {
    let real = std::fs::canonicalize(picked).map_err(|e| format!("That folder can't be used: {e}"))?;
    check_folder(&real.to_string_lossy(), &system_drive())?;
    let probe = real.join(".filmie-write-test");
    std::fs::write(&probe, b"").map_err(|e| format!("Filmie can't write to that folder: {e}"))?;
    let _ = std::fs::remove_file(probe);
    // Shown and stored without the \\?\ prefix canonicalize adds.
    let text = real.to_string_lossy();
    Ok(PathBuf::from(
        text.strip_prefix(r"\\?\UNC\").map(|p| format!(r"\\{p}")).unwrap_or_else(|| text.trim_start_matches(r"\\?\").to_string()),
    ))
}

fn folder(s: &State) -> Result<PathBuf, String> {
    let folder = s.db.setting(FOLDER_KEY).ok_or("Choose a download folder in Settings first.")?;
    check_folder(&folder, &system_drive())?;
    Ok(PathBuf::from(folder))
}

/// A file or folder name from a title, without the characters Windows refuses.
fn safe_name(title: &str) -> String {
    let cleaned: String = title.chars().map(|c| if c.is_control() || r#"<>:"/\|?*"#.contains(c) { ' ' } else { c }).collect();
    let short: String = cleaned.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(80).collect();
    let trimmed = short.trim_end_matches(['.', ' ']);
    if trimmed.is_empty() { "Untitled".into() } else { trimmed.into() }
}

fn item_dir(root: &Path, d: &Download) -> PathBuf {
    let title = root.join(format!("{} ({})", safe_name(&d.title), d.tmdb_id));
    if d.kind == "tv" { title.join(format!("S{:02}E{:02}", d.season, d.episode)) } else { title.join("Movie") }
}

/// The asset protocol only serves what is allowed here, so the webview can play downloads and nothing else on disk.
fn allow_playback(app: &AppHandle, dir: &Path) {
    if let Err(e) = app.asset_protocol_scope().allow_directory(dir, true) {
        eprintln!("could not allow playback from {}: {e}", dir.display());
    }
}

/// Lets the webview play every finished download, at start-up.
pub fn allow_finished(app: &AppHandle) {
    let s = app.state::<State>();
    for d in s.db.download_list().unwrap_or_default() {
        if let (Some(dir), "done") = (&d.dir, d.status.as_str()) {
            allow_playback(app, Path::new(dir));
        }
    }
}

fn emit(app: &AppHandle, id: i64) {
    let row = app.state::<State>().db.download_get(id).ok().flatten();
    let _ = app.emit("download", row.unwrap_or(Download { id, status: "removed".into(), ..empty() }));
}

fn empty() -> Download {
    Download {
        id: 0,
        kind: String::new(),
        tmdb_id: 0,
        season: 0,
        episode: 0,
        title: String::new(),
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

// ---------- HLS

/// Parses `KEY=VALUE,KEY="quoted, value"` attribute lists.
fn attrs(s: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let mut rest = s;
    while let Some(eq) = rest.find('=') {
        let key = rest[..eq].trim().trim_start_matches(',').trim().to_string();
        rest = &rest[eq + 1..];
        let value;
        if let Some(q) = rest.strip_prefix('"') {
            let end = q.find('"').unwrap_or(q.len());
            value = q[..end].to_string();
            rest = q.get(end + 1..).unwrap_or("");
        } else {
            let end = rest.find(',').unwrap_or(rest.len());
            value = rest[..end].trim().to_string();
            rest = &rest[end..];
        }
        out.insert(key, value);
        rest = rest.trim_start_matches(',');
    }
    out
}

fn tag_attrs<'a>(line: &'a str, tag: &str) -> Option<&'a str> {
    line.strip_prefix(tag)?.strip_prefix(':')
}

/// Refuses encrypted playlists: any key other than METHOD=NONE, at playlist or session level.
fn check_clear(text: &str) -> Result<(), Stop> {
    for line in text.lines().map(str::trim) {
        if let Some(a) = tag_attrs(line, "#EXT-X-KEY").or_else(|| tag_attrs(line, "#EXT-X-SESSION-KEY"))
            && attrs(a).get("METHOD").is_none_or(|m| m != "NONE")
        {
            return Err(Stop::Protected(PROTECTED.into()));
        }
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq)]
struct Variant {
    url: Url,
    height: u32,
    bandwidth: u64,
    audio: Option<String>,
    attrs: String,
}

fn parse_master(text: &str, base: &Url) -> Vec<Variant> {
    let mut out = Vec::new();
    let mut lines = text.lines().map(str::trim);
    while let Some(line) = lines.next() {
        let Some(a) = tag_attrs(line, "#EXT-X-STREAM-INF") else { continue };
        let Some(uri) = lines.by_ref().find(|l| !l.is_empty() && !l.starts_with('#')) else { break };
        let Ok(url) = base.join(uri) else { continue };
        let map = attrs(a);
        let height = map.get("RESOLUTION").and_then(|r| r.split('x').nth(1)).and_then(|h| h.parse().ok()).unwrap_or(0);
        let bandwidth = map.get("BANDWIDTH").and_then(|b| b.parse().ok()).unwrap_or(0);
        out.push(Variant { url, height, bandwidth, audio: map.get("AUDIO").cloned(), attrs: a.to_string() });
    }
    out
}

/// The tallest stream no taller than the preferred quality, or the shortest if every one is taller.
fn pick_variant(variants: &[Variant], max_height: u32) -> Option<&Variant> {
    let key = |v: &&Variant| (v.height, v.bandwidth);
    variants.iter().filter(|v| v.height <= max_height).max_by_key(key).or_else(|| variants.iter().min_by_key(key))
}

// shortcut: subtitle renditions aren't saved; add them like audio if people ask.
/// The audio rendition a variant plays with, when its audio is a separate playlist: the default one, else the first.
fn audio_for(text: &str, group: &str, base: &Url) -> Option<(Url, String)> {
    let renditions: Vec<(HashMap<String, String>, &str)> = text
        .lines()
        .map(str::trim)
        .filter_map(|l| tag_attrs(l, "#EXT-X-MEDIA").map(|a| (attrs(a), a)))
        .filter(|(m, _)| m.get("TYPE").map(String::as_str) == Some("AUDIO") && m.get("GROUP-ID").map(String::as_str) == Some(group))
        .filter(|(m, _)| m.contains_key("URI"))
        .collect();
    let pick = renditions.iter().find(|(m, _)| m.get("DEFAULT").map(String::as_str) == Some("YES")).or(renditions.first())?;
    Some((base.join(&pick.0["URI"]).ok()?, pick.1.to_string()))
}

const KNOWN_EXTENSIONS: &[&str] = &["ts", "m4s", "mp4", "m4v", "m4a", "aac", "mp3", "ac3", "ec3", "cmfv", "cmfa", "vtt", "webvtt"];

/// Rewrites a media playlist to point at local files, adding each distinct remote file to `jobs` once.
/// Byte ranges keep working, since they refer to the same local file. Low-latency tags only matter live, so they go.
fn localize(text: &str, base: &Url, prefix: &str, jobs: &mut Vec<(Url, String)>) -> Result<String, Stop> {
    if !text.lines().any(|l| l.trim() == "#EXT-X-ENDLIST") {
        return Err(Stop::Failed("This is a live stream, which can't be downloaded.".into()));
    }
    let mut names: HashMap<String, String> = HashMap::new();
    let mut local = |uri: &str, jobs: &mut Vec<(Url, String)>| -> Result<String, Stop> {
        let url = base.join(uri)?;
        if let Some(name) = names.get(url.as_str()) {
            return Ok(name.clone());
        }
        let ext = url
            .path_segments()
            .and_then(|mut s| s.next_back())
            .and_then(|f| f.rsplit_once('.'))
            .map(|(_, e)| e.to_ascii_lowercase())
            .filter(|e| KNOWN_EXTENSIONS.contains(&e.as_str()))
            .unwrap_or_else(|| "ts".into());
        let name = format!("{prefix}{:05}.{ext}", names.len());
        names.insert(url.to_string(), name.clone());
        jobs.push((url, name.clone()));
        Ok(name)
    };
    let mut out = String::new();
    for line in text.lines().map(str::trim) {
        if line.is_empty() {
            continue;
        }
        if ["#EXT-X-PART", "#EXT-X-PRELOAD-HINT", "#EXT-X-RENDITION-REPORT", "#EXT-X-SERVER-CONTROL", "#EXT-X-SKIP"]
            .iter()
            .any(|t| line.starts_with(t))
        {
            continue;
        }
        if let Some(a) = tag_attrs(line, "#EXT-X-MAP") {
            let uri = attrs(a).remove("URI").ok_or_else(|| Stop::Failed("A playlist's init segment has no address.".into()))?;
            let name = local(&uri, jobs)?;
            out.push_str(&line.replace(&format!("URI=\"{uri}\""), &format!("URI=\"{name}\"")));
        } else if line.starts_with('#') {
            out.push_str(line);
        } else {
            out.push_str(&local(line, jobs)?);
        }
        out.push('\n');
    }
    Ok(out)
}

/// Replaces a quoted URI attribute.
fn with_uri(attrs_text: &str, uri: &str) -> String {
    let old = attrs(attrs_text).remove("URI").unwrap_or_default();
    attrs_text.replace(&format!("URI=\"{old}\""), &format!("URI=\"{uri}\""))
}

// ---------- the engine

/// The headers a server expects from its own player page.
#[derive(Clone)]
struct Source {
    referer: String,
    origin: String,
    agent: String,
}

struct Progress {
    app: AppHandle,
    id: i64,
    done: AtomicI64,
    total: AtomicI64,
    last: Mutex<Instant>,
}

impl Progress {
    fn add(&self, bytes: i64) {
        self.done.fetch_add(bytes, Ordering::Relaxed);
        self.report(false);
    }

    fn report(&self, force: bool) {
        let mut last = self.last.lock().unwrap_or_else(|e| e.into_inner());
        if !force && last.elapsed() < Duration::from_millis(250) {
            return;
        }
        *last = Instant::now();
        drop(last);
        let s = self.app.state::<State>();
        let _ = s.db.download_progress(self.id, self.done.load(Ordering::Relaxed), self.total.load(Ordering::Relaxed));
        emit(&self.app, self.id);
    }

    fn check(&self) -> Result<(), Stop> {
        let d = self.app.state::<Downloads>();
        if d.cancelled.lock().unwrap_or_else(|e| e.into_inner()).contains(&self.id) { Err(Stop::Cancelled) } else { Ok(()) }
    }
}

// shortcut: the webview's cookies aren't sent, so a server that needs them for its video can't be downloaded; copy them through ICoreWebView2CookieManager if that turns up.
fn request(http: &Client, url: &Url, src: &Source) -> reqwest::RequestBuilder {
    http.get(url.as_str()).header(header::REFERER, &src.referer).header(header::ORIGIN, &src.origin).header(header::USER_AGENT, &src.agent)
}

async fn text_of(http: &Client, url: &Url, src: &Source) -> Result<String, Stop> {
    let res = request(http, url, src).send().await?.error_for_status()?;
    Ok(res.text().await?)
}

/// Streams one response to `dest` through a .part file, resuming a partial one. Returns its size.
async fn save(http: &Client, url: &Url, src: &Source, dest: &Path, p: &Progress, sized: bool) -> Result<i64, Stop> {
    use std::io::Write;
    if let Ok(meta) = std::fs::metadata(dest) {
        p.add(meta.len() as i64);
        return Ok(meta.len() as i64);
    }
    let part = dest.with_extension(format!("{}.part", dest.extension().and_then(|e| e.to_str()).unwrap_or("")));
    let have = std::fs::metadata(&part).map_or(0, |m| m.len());
    let mut req = request(http, url, src);
    if have > 0 {
        req = req.header(header::RANGE, format!("bytes={have}-"));
    }
    let mut res = req.send().await?.error_for_status()?;
    let resumed = have > 0 && res.status() == reqwest::StatusCode::PARTIAL_CONTENT;
    let mut file = std::fs::OpenOptions::new().create(true).append(resumed).write(true).truncate(!resumed).open(&part)?;
    let mut size = if resumed { have as i64 } else { 0 };
    if sized {
        p.total.store(size + res.content_length().unwrap_or(0) as i64, Ordering::Relaxed);
        p.done.store(size, Ordering::Relaxed);
    }
    while let Some(chunk) = res.chunk().await? {
        p.check()?;
        file.write_all(&chunk)?;
        size += chunk.len() as i64;
        p.add(chunk.len() as i64);
    }
    file.flush()?;
    drop(file);
    std::fs::rename(&part, dest)?;
    Ok(size)
}

/// Runs ffmpeg without a console window. Returns whether it succeeded.
async fn ffmpeg(args: &[&str], p: &Progress) -> Result<bool, Stop> {
    let mut cmd = std::process::Command::new("ffmpeg");
    cmd.args(["-hide_banner", "-loglevel", "error", "-y"]).args(args).stdin(std::process::Stdio::null());
    #[cfg(windows)]
    std::os::windows::process::CommandExt::creation_flags(&mut cmd, 0x0800_0000); // CREATE_NO_WINDOW
    let Ok(mut child) = cmd.spawn() else { return Ok(false) };
    loop {
        if let Some(status) = child.try_wait()? {
            return Ok(status.success());
        }
        if p.check().is_err() {
            let _ = child.kill();
            let _ = child.wait();
            return Err(Stop::Cancelled);
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

pub fn ffmpeg_installed() -> bool {
    let mut cmd = std::process::Command::new("ffmpeg");
    cmd.arg("-version").stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    #[cfg(windows)]
    std::os::windows::process::CommandExt::creation_flags(&mut cmd, 0x0800_0000);
    cmd.status().is_ok_and(|s| s.success())
}

async fn download_hls(
    http: &Client,
    url: &Url,
    text: String,
    src: &Source,
    max_height: u32,
    dir: &Path,
    p: &Arc<Progress>,
) -> Result<PathBuf, Stop> {
    check_clear(&text)?;
    let mut jobs = Vec::new();
    let mut playlists: Vec<(String, String)> = Vec::new();
    if text.contains("#EXT-X-STREAM-INF") {
        let variants = parse_master(&text, url);
        let v = pick_variant(&variants, max_height).ok_or_else(|| Stop::Failed("The stream lists no videos.".into()))?;
        let video = text_of(http, &v.url, src).await?;
        check_clear(&video)?;
        playlists.push(("video.m3u8".into(), localize(&video, &v.url, "v", &mut jobs)?));
        let audio = match &v.audio {
            Some(group) => audio_for(&text, group, url),
            None => None,
        };
        let mut master = String::from("#EXTM3U\n#EXT-X-VERSION:7\n");
        if let Some((audio_url, media)) = audio {
            let list = text_of(http, &audio_url, src).await?;
            check_clear(&list)?;
            playlists.push(("audio.m3u8".into(), localize(&list, &audio_url, "a", &mut jobs)?));
            master.push_str(&format!("#EXT-X-MEDIA:{}\n", with_uri(&media, "audio.m3u8")));
        }
        master.push_str(&format!("#EXT-X-STREAM-INF:{}\nvideo.m3u8\n", v.attrs));
        playlists.push(("index.m3u8".into(), master));
    } else {
        playlists.push(("index.m3u8".into(), localize(&text, url, "v", &mut jobs)?));
    }
    if jobs.is_empty() {
        return Err(Stop::Failed("The stream has no segments.".into()));
    }

    // A few segments at a time. Each is saved through a .part file, so a restart skips the finished ones.
    let jobs = Arc::new(jobs);
    let next = Arc::new(AtomicUsize::new(0));
    let finished = Arc::new(AtomicUsize::new(0));
    let mut workers = Vec::new();
    for _ in 0..SEGMENTS_AT_ONCE {
        let (http, src, jobs, next, finished, p, dir) =
            (http.clone(), src.clone(), jobs.clone(), next.clone(), finished.clone(), p.clone(), dir.to_path_buf());
        workers.push(tauri::async_runtime::spawn(async move {
            loop {
                let i = next.fetch_add(1, Ordering::Relaxed);
                let Some((url, name)) = jobs.get(i) else { return Ok::<(), Stop>(()) };
                let mut tries = 0;
                loop {
                    p.check()?;
                    match save(&http, url, &src, &dir.join(name), &p, false).await {
                        Ok(_) => break,
                        Err(Stop::Failed(e)) if tries < 3 => {
                            tries += 1;
                            eprintln!("segment {name} failed, retrying: {e}");
                            tokio::time::sleep(Duration::from_secs(tries)).await;
                        }
                        Err(e) => return Err(e),
                    }
                }
                // Segments are about the same size, so the total is estimated from those done so far.
                let n = finished.fetch_add(1, Ordering::Relaxed) as i64 + 1;
                p.total.store(p.done.load(Ordering::Relaxed) * jobs.len() as i64 / n, Ordering::Relaxed);
            }
        }));
    }
    let mut result = Ok(());
    for w in workers {
        let r = w.await.map_err(|e| Stop::Failed(e.to_string())).and_then(|r| r);
        if result.is_ok() {
            result = r;
        }
    }
    result?;
    for (name, body) in &playlists {
        std::fs::write(dir.join(name), body)?;
    }
    p.report(true);

    // One .mp4 plays anywhere and seeks better. Without ffmpeg the segments stay and play through hls.js.
    let mp4 = dir.join("video.mp4");
    let index = dir.join("index.m3u8");
    if ffmpeg_installed()
        && ffmpeg(
            &[
                "-allowed_extensions",
                "ALL",
                "-i",
                &index.to_string_lossy(),
                "-c",
                "copy",
                "-movflags",
                "+faststart",
                &mp4.to_string_lossy(),
            ],
            p,
        )
        .await?
    {
        for entry in std::fs::read_dir(dir)?.flatten() {
            if entry.path() != mp4 {
                let _ = std::fs::remove_file(entry.path());
            }
        }
        return Ok(mp4);
    }
    let _ = std::fs::remove_file(&mp4);
    Ok(index)
}

async fn run(app: &AppHandle, id: i64, url: Url, src: Source, max_height: u32, dir: &Path) -> Result<PathBuf, Stop> {
    let http = app.state::<Downloads>().http.clone();
    std::fs::create_dir_all(dir)?;
    let p =
        Arc::new(Progress { app: app.clone(), id, done: AtomicI64::new(0), total: AtomicI64::new(0), last: Mutex::new(Instant::now()) });
    // A playlist can come with any content type, so the first bytes decide what this is.
    let mut res = request(&http, &url, &src).send().await?.error_for_status()?;
    let kind = res.headers().get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").to_ascii_lowercase();
    let first = res.chunk().await?.unwrap_or_default();
    let head = String::from_utf8_lossy(&first[..first.len().min(512)]).trim_start_matches('\u{feff}').trim_start().to_string();
    if head.starts_with("#EXTM3U") {
        let mut body = first.to_vec();
        while let Some(chunk) = res.chunk().await? {
            body.extend_from_slice(&chunk);
        }
        return download_hls(&http, &url, String::from_utf8_lossy(&body).into_owned(), &src, max_height, dir, &p).await;
    }
    if head.starts_with("<?xml") || head.contains("<MPD") || kind.contains("dash+xml") {
        let mut body = first.to_vec();
        while let Some(chunk) = res.chunk().await? {
            body.extend_from_slice(&chunk);
        }
        if String::from_utf8_lossy(&body).contains("ContentProtection") {
            return Err(Stop::Protected(PROTECTED.into()));
        }
        if !ffmpeg_installed() {
            return Err(Stop::Failed("This server streams DASH, which needs ffmpeg installed to download.".into()));
        }
        let mp4 = dir.join("video.mp4");
        let headers = format!("Referer: {}\r\nOrigin: {}\r\n", src.referer, src.origin);
        let args = [
            "-headers",
            &headers,
            "-user_agent",
            &src.agent,
            "-i",
            url.as_str(),
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            &mp4.to_string_lossy(),
        ];
        return if ffmpeg(&args, &p).await? { Ok(mp4) } else { Err(Stop::Failed("ffmpeg couldn't save this stream.".into())) };
    }
    if kind.starts_with("text/") || kind.contains("json") {
        return Err(Stop::Failed("The server sent a page, not a video.".into()));
    }
    drop(res);
    let ext = url
        .path()
        .rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .filter(|e| ["mp4", "m4v", "webm", "mkv", "mov"].contains(&e.as_str()))
        .unwrap_or_else(|| if kind.contains("webm") { "webm".into() } else { "mp4".into() });
    let dest = dir.join(format!("video.{ext}"));
    save(&http, &url, &src, &dest, &p, true).await?;
    Ok(dest)
}

fn quality_height(q: &str) -> u32 {
    q.trim_end_matches('p').parse().unwrap_or(u32::MAX)
}

/// Deletes the folder this module made for one item, and its title folder once that is empty.
fn remove_item_dir(dir: &Path) {
    let _ = std::fs::remove_dir_all(dir);
    if let Some(parent) = dir.parent() {
        let _ = std::fs::remove_dir(parent);
    }
}

fn dir_size(path: &Path) -> i64 {
    std::fs::read_dir(path).map_or(0, |d| d.flatten().filter_map(|e| e.metadata().ok()).map(|m| m.len() as i64).sum())
}

// ---------- commands

#[derive(Serialize)]
pub struct FolderInfo {
    folder: Option<String>,
    ffmpeg: bool,
}

#[tauri::command]
pub fn download_folder(s: tauri::State<'_, State>) -> FolderInfo {
    FolderInfo { folder: s.db.setting(FOLDER_KEY), ffmpeg: ffmpeg_installed() }
}

/// Opens the folder picker. Async, because the picker blocks and must not run on the main thread.
#[tauri::command]
pub async fn download_folder_pick(app: AppHandle, window: tauri::Window, s: tauri::State<'_, State>) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app.dialog().file().set_parent(&window).set_title("Choose a download folder").blocking_pick_folder();
    let Some(picked) = picked else { return Ok(None) };
    let path = accept_folder(&picked.into_path().map_err(|e| e.to_string())?)?;
    let text = path.to_string_lossy().to_string();
    s.db.set_setting(FOLDER_KEY, &text).map_err(|e| e.to_string())?;
    Ok(Some(text))
}

#[tauri::command]
pub fn download_list(s: tauri::State<'_, State>) -> Result<Vec<Download>, String> {
    s.db.download_list().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn download_add(s: tauri::State<'_, State>, items: Vec<Download>) -> Result<Vec<Download>, String> {
    folder(&s)?;
    if items
        .iter()
        .any(|d| !["movie", "tv"].contains(&d.kind.as_str()) || d.tmdb_id <= 0 || (d.kind == "tv" && (d.season < 0 || d.episode < 1)))
    {
        return Err("bad download".into());
    }
    s.db.download_add(&items).map_err(|e| e.to_string())?;
    s.db.download_list().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn download_next(app: AppHandle, s: tauri::State<'_, State>) -> Result<Option<Download>, String> {
    let next = s.db.download_next().map_err(|e| e.to_string())?;
    if let Some(d) = &next {
        emit(&app, d.id);
    }
    Ok(next)
}

/// Starts saving a download from the address the app found. `page` is the player page the video belongs to.
#[tauri::command]
pub fn download_start(
    app: AppHandle,
    s: tauri::State<'_, State>,
    id: i64,
    url: String,
    page: String,
    agent: String,
    quality: String,
) -> Result<(), String> {
    let d = s.db.download_get(id).map_err(|e| e.to_string())?.ok_or("no such download")?;
    let url = Url::parse(&url).map_err(|e| e.to_string())?;
    let page = Url::parse(&page).map_err(|e| e.to_string())?;
    if !["http", "https"].contains(&url.scheme()) || !["http", "https"].contains(&page.scheme()) {
        return Err("bad video address".into());
    }
    let dir = item_dir(&folder(&s)?, &d);
    s.db.download_started(id, &dir.to_string_lossy()).map_err(|e| e.to_string())?;
    emit(&app, id);
    let src = Source { referer: page.to_string(), origin: page.origin().ascii_serialization(), agent };
    let max_height = quality_height(&quality);
    tauri::async_runtime::spawn(async move {
        let result = run(&app, id, url, src, max_height, &dir).await;
        let s = app.state::<State>();
        let saved = match result {
            Ok(file) => {
                allow_playback(&app, &dir);
                s.db.download_done(id, &file.to_string_lossy(), dir_size(&dir))
            }
            Err(Stop::Protected(m)) => {
                // Nothing of a protected video is kept. A failed one keeps its parts, so a retry resumes.
                remove_item_dir(&dir);
                s.db.download_status(id, "protected", Some(&m))
            }
            Err(Stop::Failed(m)) => s.db.download_status(id, "failed", Some(&m)),
            Err(Stop::Cancelled) => Ok(()),
        };
        if let Err(e) = saved {
            eprintln!("could not record download {id}: {e}");
        }
        app.state::<Downloads>().cancelled.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
        emit(&app, id);
    });
    Ok(())
}

/// The app couldn't find a video for this download, or found only a protected one.
#[tauri::command]
pub fn download_fail(app: AppHandle, s: tauri::State<'_, State>, id: i64, protected: bool, error: String) -> Result<(), String> {
    s.db.download_status(id, if protected { "protected" } else { "failed" }, Some(&error)).map_err(|e| e.to_string())?;
    emit(&app, id);
    Ok(())
}

/// Stops a download if it is running and deletes it with its files.
#[tauri::command]
pub fn download_remove(app: AppHandle, s: tauri::State<'_, State>, d: tauri::State<'_, Downloads>, id: i64) -> Result<(), String> {
    let Some(row) = s.db.download_get(id).map_err(|e| e.to_string())? else { return Ok(()) };
    if row.status == "downloading" {
        d.cancelled.lock().unwrap_or_else(|e| e.into_inner()).insert(id);
    }
    if let Some(dir) = row.dir.as_deref() {
        remove_item_dir(Path::new(dir));
    }
    s.db.download_delete(id).map_err(|e| e.to_string())?;
    emit(&app, id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_drive_is_refused() {
        for p in [r"C:\Users\me\Videos", r"c:\", "C:", r"\\?\C:\Movies", r"\\.\C:\Movies"] {
            assert!(check_folder(p, "C:").is_err(), "{p}");
        }
        assert!(check_folder(r"D:\Movies", "C:").is_ok());
        assert!(check_folder(r"\\?\E:\Films", "C:").is_ok());
        assert!(check_folder(r"\\nas\share\Films", "C:").is_ok());
        assert!(check_folder(r"\\?\UNC\nas\share", "C:").is_ok());
        // Windows on another drive.
        assert!(check_folder(r"D:\Movies", "d:").is_err());
        assert!(check_folder(r"C:\Movies", "D:").is_ok());
        // Missing or odd %SystemDrive% still protects C:.
        assert!(check_folder(r"C:\Movies", "").is_err());
        assert!(check_folder(r"Movies", "C:").is_err());
        assert!(check_folder(r"\\?\Volume{1234}\x", "C:").is_err());
    }

    #[test]
    fn titles_make_safe_folder_names() {
        assert_eq!(safe_name("Mission: Impossible / Fallout?"), "Mission Impossible Fallout");
        assert_eq!(safe_name("..."), "Untitled");
        assert_eq!(safe_name("Dots..."), "Dots");
        let d = Download { kind: "tv".into(), tmdb_id: 1396, season: 5, episode: 14, title: "Breaking Bad".into(), ..empty() };
        assert_eq!(item_dir(Path::new(r"D:\F"), &d), Path::new(r"D:\F\Breaking Bad (1396)\S05E14"));
    }

    const MASTER: &str = "#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"aac\",NAME=\"English\",DEFAULT=YES,URI=\"audio/en.m3u8\"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"aac\",NAME=\"French\",URI=\"audio/fr.m3u8\"
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=854x480,CODECS=\"avc1.4d401f,mp4a.40.2\",AUDIO=\"aac\"
480/index.m3u8
#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=90000,URI=\"iframes.m3u8\"
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS=\"avc1.640028,mp4a.40.2\",AUDIO=\"aac\"
https://cdn.example.com/1080/index.m3u8?token=a,b
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,AUDIO=\"aac\"
720/index.m3u8
";

    #[test]
    fn hls_picks_the_preferred_quality() {
        let base = Url::parse("https://s.example.com/v/master.m3u8").unwrap();
        let vs = parse_master(MASTER, &base);
        assert_eq!(vs.len(), 3, "I-frame playlists are not videos");
        assert_eq!(vs[1].url.as_str(), "https://cdn.example.com/1080/index.m3u8?token=a,b");
        assert_eq!(vs[0].url.as_str(), "https://s.example.com/v/480/index.m3u8");
        assert_eq!(pick_variant(&vs, 1080).unwrap().height, 1080);
        assert_eq!(pick_variant(&vs, 720).unwrap().height, 720);
        assert_eq!(pick_variant(&vs, u32::MAX).unwrap().height, 1080);
        assert_eq!(pick_variant(&vs, 360).unwrap().height, 480, "the smallest when all are taller");
        assert_eq!(pick_variant(&[], 720), None);
        let (audio, media) = audio_for(MASTER, "aac", &base).unwrap();
        assert_eq!(audio.as_str(), "https://s.example.com/v/audio/en.m3u8");
        assert_eq!(with_uri(&media, "audio.m3u8"), "TYPE=AUDIO,GROUP-ID=\"aac\",NAME=\"English\",DEFAULT=YES,URI=\"audio.m3u8\"");
    }

    #[test]
    fn encrypted_streams_are_refused() {
        let clear = "#EXTM3U\n#EXT-X-KEY:METHOD=NONE\n#EXTINF:4,\na.ts\n#EXT-X-ENDLIST\n";
        assert!(check_clear(clear).is_ok());
        for locked in [
            "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"k\"\n",
            "#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI=\"skd://x\",KEYFORMAT=\"com.apple.streamingkeydelivery\"\n",
            "#EXTM3U\n#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES-CTR,URI=\"data:x\"\n",
            "#EXTM3U\n#EXT-X-KEY:URI=\"k\"\n",
        ] {
            assert!(matches!(check_clear(locked), Err(Stop::Protected(_))), "{locked}");
        }
    }

    #[test]
    fn playlists_point_at_local_files() {
        let base = Url::parse("https://s.example.com/v/720/index.m3u8").unwrap();
        let text = "#EXTM3U
#EXT-X-TARGETDURATION:6
#EXT-X-MAP:URI=\"init.mp4\"
#EXT-X-PART-INF:PART-TARGET=1
#EXTINF:6,
seg1.m4s?x=1
#EXT-X-BYTERANGE:1000@0
#EXTINF:6,
https://other.example.com/all.jpg
#EXT-X-BYTERANGE:1000@1000
#EXTINF:6,
https://other.example.com/all.jpg
#EXT-X-ENDLIST
";
        let mut jobs = Vec::new();
        let local = localize(text, &base, "v", &mut jobs).unwrap();
        assert_eq!(
            local,
            "#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MAP:URI=\"v00000.mp4\"\n#EXTINF:6,\nv00001.m4s\n#EXT-X-BYTERANGE:1000@0\n#EXTINF:6,\nv00002.ts\n#EXT-X-BYTERANGE:1000@1000\n#EXTINF:6,\nv00002.ts\n#EXT-X-ENDLIST\n"
        );
        let urls: Vec<_> = jobs.iter().map(|(u, n)| (u.as_str(), n.as_str())).collect();
        assert_eq!(
            urls,
            [
                ("https://s.example.com/v/720/init.mp4", "v00000.mp4"),
                ("https://s.example.com/v/720/seg1.m4s?x=1", "v00001.m4s"),
                ("https://other.example.com/all.jpg", "v00002.ts"),
            ],
            "disguised segments get a real extension, and a shared file downloads once"
        );
        assert!(matches!(localize("#EXTM3U\n#EXTINF:6,\na.ts\n", &base, "v", &mut Vec::new()), Err(Stop::Failed(_))), "live");
    }

    #[test]
    fn attribute_lists_parse() {
        let a = attrs("BANDWIDTH=5,CODECS=\"avc1,mp4a\",RESOLUTION=1x2,NAME=\"a=b\"");
        assert_eq!(
            (a["BANDWIDTH"].as_str(), a["CODECS"].as_str(), a["RESOLUTION"].as_str(), a["NAME"].as_str()),
            ("5", "avc1,mp4a", "1x2", "a=b")
        );
        assert_eq!(quality_height("720p"), 720);
        assert_eq!(quality_height("auto"), u32::MAX);
    }
}
