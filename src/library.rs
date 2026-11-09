//! The movie library: movies, collections and settings, saved as JSON in data\.
//! Same files and fields as the Python version, so either one can open the other's data.

use crate::paths;
use base64::Engine;
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

pub type Obj = Map<String, Value>;

pub const VIDEO_EXTS: &[&str] = &[
    "3gp", "avi", "flv", "m2ts", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "ogv", "ts", "vob", "webm", "wmv",
];

pub fn image_ext(mime: &str) -> Option<&'static str> {
    Some(match mime {
        "image/jpeg" => ".jpg",
        "image/png" => ".png",
        "image/webp" => ".webp",
        "image/gif" => ".gif",
        "image/bmp" => ".bmp",
        "image/avif" => ".avif",
        _ => return None,
    })
}

// --------------------------------------------------------------------------- folders

pub struct Dirs {
    pub root: String, // the portable folder (where Cover.exe is)
    pub data: PathBuf,
    pub posters: PathBuf,
    pub library: PathBuf,
    pub lists: PathBuf, // the collections (named lists.json since the first version)
    pub settings: PathBuf,
    pub playlist: PathBuf,
}

static DIRS: OnceLock<Dirs> = OnceLock::new();

pub fn init_dirs(root: &Path) {
    let data = root.join("data");
    let _ = DIRS.set(Dirs {
        root: root.to_string_lossy().into_owned(),
        posters: data.join("posters"),
        library: data.join("library.json"),
        lists: data.join("lists.json"),
        settings: data.join("settings.json"),
        playlist: data.join("play-all.m3u"),
        data,
    });
}

pub fn dirs() -> &'static Dirs {
    DIRS.get().expect("init_dirs first")
}

// --------------------------------------------------------------------------- small helpers

pub fn now() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}

fn now_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

fn this_year() -> i64 {
    1970 + (now() / 31_556_952.0) as i64 // average Gregorian year; only used as an upper bound
}

/// n random hex characters (ids; like uuid4().hex[:n]).
pub fn rand_hex(n: usize) -> String {
    use std::hash::{BuildHasher, Hasher};
    let mut out = String::new();
    while out.len() < n {
        // RandomState is seeded randomly per instance by the OS.
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u128(SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
        out.push_str(&format!("{:016x}", h.finish()));
    }
    out.truncate(n);
    out
}

/// Python truthiness of a JSON value.
pub fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0),
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Array(a)) => !a.is_empty(),
        Some(Value::Object(o)) => !o.is_empty(),
    }
}

pub fn str_field<'a>(o: &'a Obj, k: &str) -> &'a str {
    o.get(k).and_then(Value::as_str).unwrap_or("")
}

/// The first n characters (Python's s[:n]).
pub fn cut(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

pub fn unlink_quietly(path: &Path) {
    let _ = fs::remove_file(path);
}

/// Reads a JSON file. A broken file is kept aside (name.broken-<time>.json) and the default used.
/// The bool says whether the file could be used (a missing file counts as fine).
pub fn load_json(path: &Path, default: Value) -> (Value, bool) {
    if !path.exists() {
        return (default, true);
    }
    match fs::read_to_string(path).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()) {
        Some(v) if std::mem::discriminant(&v) == std::mem::discriminant(&default) => (v, true),
        _ => {
            let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
            let broken = path.with_file_name(format!("{stem}.broken-{}.json", now() as u64));
            let _ = fs::copy(path, broken);
            (default, false)
        }
    }
}

/// Writes JSON through a temp file, so a crash never leaves half a file behind.
pub fn write_json(path: &Path, data: &Value) {
    let tmp = path.with_extension("tmp");
    if let Ok(text) = serde_json::to_string_pretty(data) {
        if fs::write(&tmp, text).is_ok() {
            let _ = fs::rename(&tmp, path);
        }
    }
}

/// Saves a base64 data URL into folder and returns the new file name.
pub fn write_image(data_url: &str, folder: &Path, stem: &str) -> Result<String, String> {
    let bad = || "Unsupported image".to_string();
    let rest = data_url.strip_prefix("data:").ok_or_else(bad)?;
    let (mime, b64) = rest.split_once(";base64,").ok_or_else(bad)?;
    let mime_ok = !mime.is_empty() && mime.chars().all(|c| c.is_alphanumeric() || "_/+.-".contains(c));
    let ext = image_ext(mime).filter(|_| mime_ok).ok_or_else(bad)?;
    let clean: String = b64.chars().filter(|c| c.is_ascii_alphanumeric() || "+/".contains(*c)).collect();
    let engine = base64::engine::GeneralPurpose::new(
        &base64::alphabet::STANDARD,
        base64::engine::GeneralPurposeConfig::new()
            .with_decode_padding_mode(base64::engine::DecodePaddingMode::Indifferent)
            .with_decode_allow_trailing_bits(true),
    );
    let bytes = engine.decode(clean).map_err(|_| bad())?;
    let name = format!("{stem}-{}{ext}", now_ms());
    fs::write(folder.join(&name), bytes).map_err(|e| e.to_string())?;
    Ok(name)
}

pub fn path_of(item: &Obj) -> &str {
    str_field(item, "path")
}

fn objects(v: Value) -> Vec<Obj> {
    match v {
        Value::Array(a) => a
            .into_iter()
            .filter_map(|x| if let Value::Object(o) = x { Some(o) } else { None })
            .collect(),
        _ => Vec::new(),
    }
}

fn object(v: Value) -> Obj {
    if let Value::Object(o) = v { o } else { Obj::new() }
}

/// The ids in a collection's "films" list.
pub fn film_ids(lst: &Obj) -> Vec<String> {
    lst.get("films")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
        .unwrap_or_default()
}

/// A collection's films in the order asked for. Ids that aren't in it are ignored, and films
/// the order leaves out keep their place after the others, so nothing can be lost.
pub fn reordered(films: &[String], wanted: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(films.len());
    for id in wanted {
        if films.contains(id) && !out.contains(id) {
            out.push(id.clone());
        }
    }
    for id in films {
        if !out.contains(id) {
            out.push(id.clone());
        }
    }
    out
}

fn without(lst: &mut Obj, gone: &HashSet<String>) {
    let kept: Vec<Value> = film_ids(lst).into_iter().filter(|v| !gone.contains(v)).map(Value::String).collect();
    lst.insert("films".into(), Value::Array(kept));
}

// --------------------------------------------------------------------------- movie names

fn re(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("valid regex"))
}

/// Title and release year from a file name: "The.Thing.1982.1080p.BluRay.x264" -> ("The Thing", 1982).
pub fn parse_name(stem: &str) -> (String, Option<i64>) {
    static DOTS: OnceLock<Regex> = OnceLock::new();
    static GROUP_TAG: OnceLock<Regex> = OnceLock::new();
    static YEAR: OnceLock<Regex> = OnceLock::new();
    static TAGS: OnceLock<Regex> = OnceLock::new();
    static SPACES: OnceLock<Regex> = OnceLock::new();

    // Dotted names: dots and underscores are spaces.
    let mut s = if stem.contains(' ') { stem.to_string() } else { re(&DOTS, r"[._]+").replace_all(stem, " ").into_owned() };
    s = re(&GROUP_TAG, r"\s*\[[^\]]*\]\s*$").replace(&s, "").into_owned(); // a trailing [group] tag

    // The last 19xx/20xx that stands on its own; a number that starts the name is part of
    // it ("1917", "2001 A Space Odyssey 1968").
    let mut last: Option<(usize, i64)> = None;
    for c in re(&YEAR, r"(?:^|[\s(\[])((?:19|20)\d{2})").captures_iter(&s) {
        let m = c.get(1).expect("group");
        let free_after = s[m.end()..].chars().next().is_none_or(|ch| ch.is_whitespace() || ch == ')' || ch == ']');
        if m.start() > 0 && free_after {
            last = Some((m.start(), m.as_str().parse().unwrap_or(0)));
        }
    }
    let mut year = None;
    if let Some((at, y)) = last {
        if (1888..=this_year() + 2).contains(&y) {
            year = Some(y);
            s.truncate(at);
        }
    }
    let tags = r"(?i)[\s(\[]*\b(?:2160p|1080p|720p|480p|4k|uhd|hdr|bluray|blu-ray|brrip|bdrip|web-?dl|webrip|hdrip|dvdrip|hdtv|x264|x265|h\.?264|h\.?265|hevc|avc|remux|aac|dts|ac3|proper|repack|extended|unrated|imax)\b.*$";
    s = re(&TAGS, tags).replace(&s, "").into_owned();
    s = re(&SPACES, r"\s+").replace_all(&s, " ").into_owned();
    let s = s.trim_matches(|c| " -([_".contains(c));
    (if s.is_empty() { stem.to_string() } else { s.to_string() }, year)
}

/// Release folders often ship a short "sample" clip next to the movie.
pub fn is_sample(path: &str) -> bool {
    static SAMPLE: OnceLock<Regex> = OnceLock::new();
    re(&SAMPLE, r"(?i)(^|[\s._-])sample([\s._-]|$)").is_match(&paths::stem(path))
}

/// A list of genre names: trimmed, no blanks, no duplicates (case-insensitive), at most 12.
pub fn clean_genres(value: Option<&Value>) -> Vec<String> {
    static SPACES: OnceLock<Regex> = OnceLock::new();
    let raw: Vec<String> = match value {
        Some(Value::String(s)) => s.split(',').map(str::to_string).collect(),
        Some(Value::Array(a)) => a.iter().map(|v| v.as_str().map(str::to_string).unwrap_or_else(|| v.to_string())).collect(),
        _ => Vec::new(),
    };
    let (mut out, mut seen) = (Vec::new(), HashSet::new());
    for g in raw {
        let g = cut(re(&SPACES, r"\s+").replace_all(&g, " ").trim(), 40);
        if !g.is_empty() && seen.insert(g.to_lowercase()) {
            out.push(g);
        }
    }
    out.truncate(12);
    out
}

pub fn genres_of(item: &Obj) -> Vec<String> {
    clean_genres(item.get("genres"))
}

// --------------------------------------------------------------------------- library

pub struct Library {
    pub items: Vec<Obj>,
    pub lists: Vec<Obj>, // collections: [{"id", "name", "description", "films": [ids in order], "cover", ...}]
    pub settings: Obj,
    /// Every file read fine: only then is it safe to delete pictures nothing points to.
    loaded_ok: bool,
}

impl Library {
    pub fn load() -> Self {
        let d = dirs();
        let (items, ok1) = load_json(&d.library, json!([]));
        let (lists, ok2) = load_json(&d.lists, json!([]));
        let (settings, _) = load_json(&d.settings, json!({}));
        let mut items = objects(items);
        for i in &mut items {
            // In memory, paths are always absolute.
            let abs = paths::from_disk_path(path_of(i), &d.root);
            i.insert("path".into(), Value::String(abs));
        }
        Library { items, lists: objects(lists), settings: object(settings), loaded_ok: ok1 && ok2 }
    }

    /// Deletes posters nothing points to any more, and leftover temp files.
    pub fn prune_files(&self) {
        if !self.loaded_ok {
            return; // a broken library file: keep every picture until it is sorted out
        }
        let d = dirs();
        let used: HashSet<String> =
            self.items.iter().chain(self.lists.iter()).map(|i| str_field(i, "cover").to_string()).collect();
        for e in fs::read_dir(&d.posters).into_iter().flatten().flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if e.file_type().is_ok_and(|t| t.is_file()) && !used.contains(&name) {
                unlink_quietly(&e.path());
            }
        }
        for e in fs::read_dir(&d.data).into_iter().flatten().flatten() {
            if e.file_name().to_string_lossy().ends_with(".tmp") {
                unlink_quietly(&e.path());
            }
        }
    }

    /// Missing movies that turn up under another drive letter are pointed there. Returns how many.
    pub fn reconnect_drives(&mut self) -> usize {
        let mut moved = 0;
        for i in &mut self.items {
            let p = path_of(i).to_string();
            if !paths::is_file(&p) {
                if let Some(found) = paths::find_on_other_drive(&p) {
                    i.insert("path".into(), Value::String(found));
                    moved += 1;
                }
            }
        }
        if moved > 0 {
            self.save();
        }
        moved
    }

    pub fn save(&self) {
        let root = &dirs().root;
        let out: Vec<Value> = self
            .items
            .iter()
            .map(|i| {
                let mut o = i.clone();
                o.insert("path".into(), Value::String(paths::to_disk_path(path_of(i), root)));
                Value::Object(o)
            })
            .collect();
        write_json(&dirs().library, &Value::Array(out));
    }

    pub fn save_lists(&self) {
        let lists = self.lists.iter().cloned().map(Value::Object).collect();
        write_json(&dirs().lists, &Value::Array(lists));
    }

    pub fn save_settings(&self) {
        write_json(&dirs().settings, &Value::Object(self.settings.clone()));
    }

    pub fn idx(&self, id: &str) -> Option<usize> {
        self.items.iter().position(|i| str_field(i, "id") == id)
    }

    pub fn list_idx(&self, lid: &str) -> Option<usize> {
        self.lists.iter().position(|l| str_field(l, "id") == lid)
    }

    // ---- collections

    pub fn create_list(&mut self, name: &str, description: &str, ids: &[String]) -> String {
        let t = now();
        let id = rand_hex(10);
        self.lists.push(object(json!({
            "id": id, "name": name, "description": description, "films": [], "created": t, "updated": t,
        })));
        let li = self.lists.len() - 1;
        self.collect(li, ids); // also saves
        id
    }

    /// Appends movies to a collection, skipping ones already in it.
    pub fn collect(&mut self, li: usize, ids: &[String]) {
        let known: HashSet<&str> = self.items.iter().map(|i| str_field(i, "id")).collect();
        let mut films = film_ids(&self.lists[li]);
        for f in ids {
            if known.contains(f.as_str()) && !films.contains(f) {
                films.push(f.clone());
            }
        }
        let lst = &mut self.lists[li];
        lst.insert("films".into(), json!(films));
        lst.insert("updated".into(), json!(now()));
        self.save_lists();
    }

    /// Puts a collection's films in the order you arranged them in.
    pub fn reorder(&mut self, li: usize, ids: &[String]) {
        let films = reordered(&film_ids(&self.lists[li]), ids);
        let lst = &mut self.lists[li];
        lst.insert("films".into(), json!(films));
        lst.insert("updated".into(), json!(now()));
        self.save_lists();
    }

    /// The "Sort by" you last picked inside this collection, so it opens the same way.
    /// Not an edit of the collection: "updated" stays as it was.
    pub fn set_list_sort(&mut self, li: usize, sort: &str) {
        self.lists[li].insert("sort".into(), json!(sort));
        self.save_lists();
    }

    pub fn uncollect(&mut self, li: usize, ids: &[String]) {
        let gone: HashSet<String> = ids.iter().cloned().collect();
        let lst = &mut self.lists[li];
        without(lst, &gone);
        lst.insert("updated".into(), json!(now()));
        self.save_lists();
    }

    /// A collection's own cover: a data URL, or None to remove it.
    pub fn set_list_cover(&mut self, li: usize, data_url: Option<&str>) -> Result<(), String> {
        let new = match data_url {
            Some(url) => json!(write_image(url, &dirs().posters, &format!("col-{}", str_field(&self.lists[li], "id")))?),
            None => Value::Null,
        };
        let lst = &mut self.lists[li];
        Self::drop_cover_file(lst);
        lst.insert("cover".into(), new);
        lst.insert("updated".into(), json!(now()));
        self.save_lists();
        Ok(())
    }

    pub fn delete_list(&mut self, li: usize) {
        let lst = self.lists.remove(li);
        Self::drop_cover_file(&lst);
        self.save_lists();
    }

    // ---- movies

    /// Library ids of these files (new or already added), in the given order.
    pub fn ids_for(&self, picked: &[String]) -> Vec<String> {
        let by_path: HashMap<String, &str> =
            self.items.iter().map(|i| (paths::key(path_of(i)), str_field(i, "id"))).collect();
        picked.iter().filter_map(|p| by_path.get(&paths::key(p)).map(|s| s.to_string())).collect()
    }

    pub fn add_paths(&mut self, picked: &[String]) -> Vec<String> {
        let mut known: HashSet<String> = self.items.iter().map(|i| paths::key(path_of(i))).collect();
        let mut added = Vec::new();
        for p in picked {
            let p = paths::abspath(p);
            let k = paths::normcase(&p);
            if known.contains(&k) || !paths::is_file(&p) {
                continue;
            }
            known.insert(k);
            let id = rand_hex(12);
            let (title, year) = parse_name(&paths::stem(&p));
            self.items.push(object(json!({
                "id": id, "path": p, "title": title, "year": year, "director": null, "genres": [],
                "rating": null,       // 1..10 = half stars
                "watched": false,
                "cover": null,
                "coverAuto": false,   // true: a frame from the movie, not a real poster
                "autoTried": false,
                "duration": null, "added": now(), "lastPlayed": null,
            })));
            added.push(id);
        }
        if !added.is_empty() {
            self.save();
        }
        added
    }

    /// The movies as the window sees them (plus size, folder and type).
    pub fn public(&self) -> Vec<Value> {
        self.items
            .iter()
            .map(|i| {
                let p = path_of(i);
                let size = fs::metadata(p).ok().filter(|m| m.is_file()).map(|m| m.len()); // one disk query per movie
                let folder = Path::new(p).parent().and_then(|q| q.file_name()).map(|n| n.to_string_lossy().into_owned());
                let mut o = i.clone();
                o.insert("exists".into(), json!(size.is_some()));
                o.insert("size".into(), json!(size));
                o.insert("folder".into(), json!(folder.unwrap_or_default()));
                o.insert("ext".into(), json!(paths::ext_upper(p)));
                Value::Object(o)
            })
            .collect()
    }

    /// Everything the window shows; sent back after every change.
    pub fn state(&self) -> Obj {
        let mut o = Obj::new();
        o.insert("library".into(), Value::Array(self.public()));
        o.insert("settings".into(), Value::Object(self.settings.clone()));
        o.insert("lists".into(), Value::Array(self.lists.iter().cloned().map(Value::Object).collect()));
        o
    }

    fn drop_cover_file(o: &Obj) {
        let c = str_field(o, "cover");
        if !c.is_empty() {
            unlink_quietly(&dirs().posters.join(c));
        }
    }

    pub fn set_cover(&mut self, i: usize, data_url: &str, auto: bool) -> Result<(), String> {
        let stem = str_field(&self.items[i], "id").to_string();
        let name = write_image(data_url, &dirs().posters, &stem)?;
        let item = &mut self.items[i];
        Self::drop_cover_file(item);
        item.insert("cover".into(), json!(name));
        item.insert("coverAuto".into(), json!(auto));
        item.insert("autoTried".into(), json!(true));
        self.save();
        Ok(())
    }

    pub fn remove_covers(&mut self, idxs: &[usize]) {
        for &i in idxs {
            let item = &mut self.items[i];
            Self::drop_cover_file(item);
            item.insert("cover".into(), Value::Null);
            item.insert("coverAuto".into(), json!(false));
            item.insert("autoTried".into(), json!(false));
        }
        self.save();
    }

    pub fn delete(&mut self, idxs: &[usize]) {
        let mut idxs = idxs.to_vec();
        idxs.sort_unstable();
        idxs.dedup();
        let mut gone = HashSet::new();
        for &i in idxs.iter().rev() {
            let item = self.items.remove(i);
            Self::drop_cover_file(&item);
            gone.insert(str_field(&item, "id").to_string());
        }
        self.save();
        for lst in &mut self.lists {
            without(lst, &gone);
        }
        self.save_lists();
    }

    /// Points movies at a new file: (index, new path). Skips files that are already in
    /// the library. Returns how many were relinked.
    pub fn relink(&mut self, pairs: &[(usize, String)]) -> usize {
        let mut done = 0;
        for (i, new_path) in pairs {
            let new_path = paths::abspath(new_path);
            let k = paths::normcase(&new_path);
            let taken = self.items.iter().enumerate().any(|(j, it)| j != *i && paths::key(path_of(it)) == k);
            if !paths::is_file(&new_path) || taken {
                continue;
            }
            let item = &mut self.items[*i];
            item.insert("path".into(), json!(new_path));
            if !truthy(item.get("cover")) {
                item.insert("autoTried".into(), json!(false)); // grab a frame now that the file is back
            }
            done += 1;
        }
        if done > 0 {
            self.save();
        }
        done
    }

    /// Missing movies whose file name exists in folder (e.g. a moved folder).
    pub fn missing_in(&self, folder: &str) -> Vec<String> {
        self.items
            .iter()
            .filter(|i| {
                let p = path_of(i);
                !paths::is_file(p) && paths::is_file(&format!("{folder}\\{}", paths::file_name(p)))
            })
            .map(|i| str_field(i, "id").to_string())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reorder_keeps_every_film() {
        let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        let films = s(&["a", "b", "c", "d"]);
        assert_eq!(reordered(&films, &s(&["d", "a", "c", "b"])), s(&["d", "a", "c", "b"]));
        // unknown ids and repeats are ignored; films left out keep their place at the end
        assert_eq!(reordered(&films, &s(&["c", "x", "c", "a"])), s(&["c", "a", "b", "d"]));
        assert_eq!(reordered(&films, &[]), films);
    }

    #[test]
    fn names_like_python() {
        let cases: &[(&str, &str, Option<i64>)] = &[
            ("The.Thing.1982.1080p.BluRay.x264", "The Thing", Some(1982)),
            ("1917", "1917", None),
            ("2001 A Space Odyssey 1968", "2001 A Space Odyssey", Some(1968)),
            ("Star.Wars.Episode.1.The.Phantom.Menace.1999.1080p.BrRip.x264.BOKUTOX.YIFY", "Star Wars Episode 1 The Phantom Menace", Some(1999)),
            ("Blade Runner (1982) [1080p]", "Blade Runner", Some(1982)),
            ("Heat 1995 [YTS]", "Heat", Some(1995)),
            ("Some_Movie_720p", "Some Movie", None),
            ("Alien", "Alien", None),
        ];
        for (stem, title, year) in cases {
            assert_eq!(parse_name(stem), (title.to_string(), *year), "{stem}");
        }
    }

    #[test]
    fn samples() {
        assert!(is_sample(r"D:\m\Heat.1995.sample.mkv"));
        assert!(is_sample(r"D:\m\Sample.mkv"));
        assert!(is_sample(r"D:\m\heat-sample.mp4"));
        assert!(!is_sample(r"D:\m\Samples of Life.mkv"));
    }

    #[test]
    fn genres() {
        assert_eq!(clean_genres(Some(&json!(" Sci-Fi , drama,,  SCI-FI "))), vec!["Sci-Fi", "drama"]);
        assert_eq!(clean_genres(Some(&json!(["Action", "  Big   Fun ", "action"]))), vec!["Action", "Big Fun"]);
        assert!(clean_genres(None).is_empty());
    }
}
