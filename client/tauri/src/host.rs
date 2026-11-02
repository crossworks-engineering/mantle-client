//! The host of the static owner UI for one brain window: a Rust port of the
//! host contract (docs/static-ui-host.md, client/host/src/static-host.ts).
//! Pure: it answers a request from a set of files, so it is tested against a
//! fixture tree, and the cases both hosts must agree on live in one shared
//! table (client/host/test-fixtures/host-contract/cases.json).
//!
//! Everything this serves is public: the static export, the CSP, and env.js
//! (the brain's address and its public appearance). A brain's own frames can
//! load any of it with a `<script src>` whatever the headers say, so no
//! secret may ever be served from here.

use std::borrow::Cow;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::fence::UI_ORIGIN;

/// The files of the export, by path relative to its root (`index.html`,
/// `_next/static/…`). Only files: a directory is not an answer.
pub trait FileSource: Send + Sync {
    fn read(&self, rel: &str) -> Option<Cow<'_, [u8]>>;
}

/// A folder on disk. Tests serve the shared fixture tree from it.
pub struct DirSource(pub PathBuf);

impl FileSource for DirSource {
    fn read(&self, rel: &str) -> Option<Cow<'_, [u8]>> {
        if rel.is_empty() {
            return None;
        }
        let path = self.0.join(rel);
        path.is_file()
            .then(|| std::fs::read(path).ok().map(Cow::Owned))
            .flatten()
    }
}

/// routes.json: what the build hands every host.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub placeholder: String,
    pub routes: Vec<String>,
    pub no_referrer: Vec<String>,
}

/// What env.js hands the page (packages/web-ui runtime-env.ts). Field order
/// is the order the TS host writes them in.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostEnv<'a> {
    pub api_base: &'a str,
    pub server_origin: &'a str,
    pub turn_streaming: &'a str,
    pub tour: &'a str,
    pub appearance: &'a Option<serde_json::Value>,
}

pub fn env_script(env: &HostEnv) -> String {
    let json = serde_json::to_string(env).unwrap_or_else(|_| "null".into());
    format!("window.__MANTLE_ENV__ = {json};")
}

/// `{brain}` / `{brain_ws}` in the build's CSP template, for this brain.
/// Literal replacement: nothing in the origin is read as a pattern.
pub fn fill_csp(template: &str, brain_origin: &str) -> String {
    let ws = if let Some(rest) = brain_origin.strip_prefix("https:") {
        format!("wss:{rest}")
    } else if let Some(rest) = brain_origin.strip_prefix("http:") {
        format!("ws:{rest}")
    } else {
        brain_origin.to_string()
    };
    template
        .trim()
        .replace("{brain_ws}", &ws)
        .replace("{brain}", brain_origin)
}

/// Strict percent-decoding of one path segment: a `%` must be followed by
/// two hex digits, and the result must be UTF-8 (decodeURIComponent).
fn percent_decode(raw: &str) -> Option<String> {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = bytes.get(i + 1..i + 3)?;
            let text = std::str::from_utf8(hex).ok()?;
            out.push(u8::from_str_radix(text, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// The URL path's segments, decoded, or None when a segment could step out
/// of the UI tree (`.`, `..`, an encoded slash or backslash, a NUL) or does
/// not decode.
pub fn safe_segments(path: &str) -> Option<Vec<String>> {
    let mut out = Vec::new();
    for raw in path.split('/') {
        if raw.is_empty() {
            continue;
        }
        let seg = percent_decode(raw)?;
        if seg == "." || seg == ".." || seg.contains(['/', '\\', '\0']) {
            return None;
        }
        out.push(seg);
    }
    Some(out)
}

/// The path, relative to the UI tree, that a request maps to through the
/// placeholder fallback, or None when no route matches. Next's data files
/// ride along: `/notes/x.txt` and `/notes/x/__next.….txt` map like
/// `/notes/x`. The longest matching route wins.
pub fn placeholder_path(segments: &[String], manifest: &Manifest) -> Option<String> {
    let mut segs: Vec<String> = segments.to_vec();
    let mut suffix = String::new();
    let last = segs.last().cloned().unwrap_or_default();
    if last.starts_with("__next.") {
        suffix = format!("/{last}");
        segs.pop();
    } else if let Some(stem) = last.strip_suffix(".txt") {
        suffix = ".txt".into();
        segs.pop();
        segs.push(stem.to_string());
    }
    let mut best: Option<(usize, String)> = None;
    for route in &manifest.routes {
        // A route names a dynamic FOLDER; its pages may sit below it
        // (`/nodes/[id]/history`), so the rest of the path rides along. A
        // catch-all takes the rest as its one placeholder.
        let pat: Vec<&str> = route.split('/').filter(|p| !p.is_empty()).collect();
        if segs.len() < pat.len() {
            continue;
        }
        let catch_all = pat.last().is_some_and(|p| p.starts_with("[..."));
        let mut mapped: Vec<&str> = Vec::new();
        let mut ok = true;
        for (i, part) in pat.iter().enumerate() {
            if part.starts_with('[') {
                mapped.push(&manifest.placeholder);
            } else if *part == segs[i] {
                mapped.push(part);
            } else {
                ok = false;
                break;
            }
        }
        if !ok {
            continue;
        }
        if !catch_all {
            mapped.extend(segs[pat.len()..].iter().map(String::as_str));
        }
        if best.as_ref().is_none_or(|(len, _)| pat.len() > *len) {
            best = Some((pat.len(), format!("/{}{suffix}", mapped.join("/"))));
        }
    }
    best.map(|(_, path)| path)
}

/// The extension of a file name the way Node's `extname` gives it: from the
/// last dot, unless that dot starts the name.
fn extname(name: &str) -> &str {
    match name.rfind('.') {
        Some(0) | None => "",
        Some(i) => &name[i..],
    }
}

/// The type a file is served as, from its lower-cased extension.
fn content_type(file: &str) -> &'static str {
    let base = file.rsplit('/').next().unwrap_or(file);
    match extname(base).to_ascii_lowercase().as_str() {
        ".html" => "text/html; charset=utf-8",
        ".js" => "text/javascript; charset=utf-8",
        ".css" => "text/css; charset=utf-8",
        ".txt" => "text/x-component; charset=utf-8",
        ".json" => "application/json; charset=utf-8",
        ".svg" => "image/svg+xml",
        ".png" => "image/png",
        ".ico" => "image/x-icon",
        ".jpg" => "image/jpeg",
        ".webp" => "image/webp",
        ".woff2" => "font/woff2",
        ".woff" => "font/woff",
        ".ttf" => "font/ttf",
        ".wasm" => "application/wasm",
        ".map" => "application/json; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn under(path: &str, prefix: &str) -> bool {
    path == prefix
        || path
            .strip_prefix(prefix)
            .is_some_and(|rest| rest.starts_with('/'))
}

/// One request, as much of it as the host reads.
pub struct HostRequest<'a> {
    pub method: &'a str,
    /// The URL path, still percent-encoded, without the query.
    pub path: &'a str,
    pub origin: Option<&'a str>,
    pub referer: Option<&'a str>,
}

/// One answer: status, headers, body.
#[derive(Debug)]
pub struct HostAnswer {
    pub status: u16,
    pub headers: Vec<(&'static str, String)>,
    pub body: Vec<u8>,
}

impl HostAnswer {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
}

const NOSNIFF: (&str, &str) = ("x-content-type-options", "nosniff");

fn bare(status: u16, body: &str) -> HostAnswer {
    HostAnswer {
        status,
        headers: vec![(NOSNIFF.0, NOSNIFF.1.into())],
        body: body.as_bytes().to_vec(),
    }
}

/// Whether a request comes from the UI's own pages. A header that is absent
/// says nothing (a navigation, a classic script); one that is present must
/// name the UI origin. A Referer may be a `blob:` URL the UI made
/// (`blob:mantle-ui://localhost/<uuid>`), whose origin is the UI's. This
/// keeps a brain's frames from loading the app's files by the obvious route;
/// it is not a secret-keeping boundary (a frame can drop its Referer), which
/// is why nothing here is secret.
fn from_ui(value: Option<&str>, whole_url: bool) -> bool {
    let Some(value) = value else {
        return true;
    };
    if !whole_url {
        return value == UI_ORIGIN;
    }
    let Ok(url) = url::Url::parse(value) else {
        return false;
    };
    if url.scheme() == "blob" {
        return url::Url::parse(url.path()).is_ok_and(|inner| crate::fence::is_ui_url(&inner));
    }
    crate::fence::is_ui_url(&url)
}

/// The UI host of one window.
pub struct Host {
    files: Box<dyn FileSource>,
    manifest: Manifest,
    csp_template: String,
}

impl Host {
    /// Reads the build's routes.json and csp.txt out of the files.
    pub fn new(files: Box<dyn FileSource>) -> Result<Host, String> {
        let routes = files
            .read("_mantle/routes.json")
            .ok_or("the UI export has no _mantle/routes.json")?;
        let manifest: Manifest =
            serde_json::from_slice(&routes).map_err(|e| format!("routes.json: {e}"))?;
        let csp = files
            .read("_mantle/csp.txt")
            .ok_or("the UI export has no _mantle/csp.txt")?;
        let csp_template = String::from_utf8(csp.into_owned()).map_err(|e| e.to_string())?;
        Ok(Host {
            files,
            manifest,
            csp_template,
        })
    }

    /// The CSP every HTML answer for this brain carries: the TS host's,
    /// exactly. A brain window uses no IPC (its vault is this scheme's own
    /// `/_mantle/vault`, reached through connect-src 'self'), so Tauri's IPC
    /// is not named.
    pub fn csp_for(&self, brain_origin: &str) -> String {
        fill_csp(&self.csp_template, brain_origin)
    }

    fn try_path(&self, rel: &str) -> Option<(String, Cow<'_, [u8]>)> {
        let index = if rel.is_empty() {
            "index.html".to_string()
        } else {
            format!("{rel}/index.html")
        };
        for candidate in [rel.to_string(), format!("{rel}.html"), index] {
            if let Some(bytes) = self.files.read(&candidate) {
                return Some((candidate, bytes));
            }
        }
        None
    }

    fn find(&self, segments: &[String]) -> Option<(String, Cow<'_, [u8]>, u16)> {
        if let Some((file, bytes)) = self.try_path(&segments.join("/")) {
            return Some((file, bytes, 200));
        }
        if let Some(mapped) = placeholder_path(segments, &self.manifest) {
            if let Some((file, bytes)) = self.try_path(mapped.trim_start_matches('/')) {
                return Some((file, bytes, 200));
            }
        }
        // A page that does not exist gets the 404 page; a missing asset, nothing.
        let last = segments.last().map(String::as_str).unwrap_or("");
        if extname(last).is_empty() {
            if let Some((file, bytes)) = self.try_path("404") {
                return Some((file, bytes, 404));
            }
        }
        None
    }

    /// Answers one request for this brain's window. `appearance` is asked
    /// only for env.js.
    pub fn serve(
        &self,
        req: &HostRequest,
        brain_origin: &str,
        appearance: &dyn Fn() -> Option<serde_json::Value>,
    ) -> HostAnswer {
        let head = req.method.eq_ignore_ascii_case("HEAD");
        if !head && !req.method.eq_ignore_ascii_case("GET") {
            let mut answer = bare(405, "Method not allowed");
            answer.headers.push(("allow", "GET, HEAD".into()));
            return answer;
        }
        if !from_ui(req.origin, false) || !from_ui(req.referer, true) {
            return bare(403, "Forbidden");
        }
        let mut answer = self.answer(req, brain_origin, appearance);
        if head {
            answer.body.clear();
        }
        answer
    }

    fn answer(
        &self,
        req: &HostRequest,
        brain_origin: &str,
        appearance: &dyn Fn() -> Option<serde_json::Value>,
    ) -> HostAnswer {
        if req.path == "/env.js" {
            let appearance = appearance();
            let env = HostEnv {
                api_base: brain_origin,
                server_origin: brain_origin,
                turn_streaming: "",
                tour: "",
                appearance: &appearance,
            };
            return HostAnswer {
                status: 200,
                headers: vec![
                    ("content-type", "text/javascript; charset=utf-8".into()),
                    ("cache-control", "no-store".into()),
                    (NOSNIFF.0, NOSNIFF.1.into()),
                ],
                body: env_script(&env).into_bytes(),
            };
        }

        let Some(segments) = safe_segments(req.path) else {
            return bare(404, "Not found");
        };
        let Some((file, bytes, status)) = self.find(&segments) else {
            return bare(404, "Not found");
        };

        let kind = content_type(&file);
        let mut headers = vec![
            ("content-type", kind.to_string()),
            (NOSNIFF.0, NOSNIFF.1.into()),
        ];
        if kind.starts_with("text/html") {
            headers.push(("content-security-policy", self.csp_for(brain_origin)));
            headers.push(("cache-control", "no-cache".into()));
            // Matched on the path the file was found by (decoded, any case,
            // with or without .html), so `/%69nvite` or `/INVITE` is no way
            // around it.
            let joined = format!("/{}", segments.join("/")).to_lowercase();
            let asked = joined.strip_suffix(".html").unwrap_or(&joined);
            if self.manifest.no_referrer.iter().any(|p| under(asked, p)) {
                headers.push(("referrer-policy", "no-referrer".into()));
            }
        } else if req.path.starts_with("/_next/static/") {
            headers.push((
                "cache-control",
                "public, max-age=31536000, immutable".into(),
            ));
        } else {
            headers.push(("cache-control", "no-cache".into()));
        }
        HostAnswer {
            status,
            headers,
            body: bytes.into_owned(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn manifest() -> Manifest {
        Manifest {
            placeholder: "_".into(),
            routes: vec![
                "/docs/[collection]".into(),
                "/docs/[collection]/[...slug]".into(),
                "/nodes/[id]".into(),
                "/notes/[id]".into(),
            ],
            no_referrer: vec!["/client-signin".into(), "/invite".into()],
        }
    }

    fn map(path: &str) -> Option<String> {
        placeholder_path(&safe_segments(path).unwrap(), &manifest())
    }

    #[test]
    fn placeholder_path_follows_the_ts_host() {
        assert_eq!(map("/notes/abc123").as_deref(), Some("/notes/_"));
        assert_eq!(
            map("/nodes/abc/history").as_deref(),
            Some("/nodes/_/history")
        );
        assert_eq!(
            map("/docs/handbook/guide/intro").as_deref(),
            Some("/docs/_/_")
        );
        assert_eq!(map("/notes/abc.txt").as_deref(), Some("/notes/_.txt"));
        assert_eq!(
            map("/notes/abc/__next._tree.txt").as_deref(),
            Some("/notes/_/__next._tree.txt")
        );
        assert_eq!(
            map("/nodes/abc/history.txt").as_deref(),
            Some("/nodes/_/history.txt")
        );
        assert_eq!(map("/tasks/abc"), None);
        assert_eq!(map("/notes"), None);
    }

    #[test]
    fn fill_csp_names_the_brain_and_its_websocket_twin() {
        assert_eq!(
            fill_csp(
                "connect-src 'self' {brain} {brain_ws}\n",
                "https://b.example"
            ),
            "connect-src 'self' https://b.example wss://b.example"
        );
        assert_eq!(
            fill_csp("{brain_ws}", "http://127.0.0.1:9"),
            "ws://127.0.0.1:9"
        );
        // Literal: a `$` in the template is not a replacement pattern.
        assert_eq!(fill_csp("a $1 {brain}", "https://b"), "a $1 https://b");
    }

    #[test]
    fn safe_segments_refuses_what_could_climb_out() {
        for bad in [
            "/..",
            "/a/%2e%2e/b",
            "/%2E",
            "/a%2Fb",
            "/a%5Cb",
            "/a%00b",
            "/%zz",
            "/%e2%82",
            "/a/../b",
        ] {
            assert_eq!(safe_segments(bad), None, "{bad}");
        }
        assert_eq!(
            safe_segments("//a/%69nvite/").unwrap(),
            vec!["a".to_string(), "invite".to_string()]
        );
    }

    #[test]
    fn extname_is_nodes() {
        assert_eq!(extname("a.js"), ".js");
        assert_eq!(extname(".hidden"), "");
        assert_eq!(extname("noext"), "");
        assert_eq!(extname("a.b.TXT"), ".TXT");
        assert_eq!(content_type("fonts/A.WOFF2"), "font/woff2");
    }

    fn fixture_root() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../host/test-fixtures/host-contract")
    }

    fn fixture_host() -> Host {
        Host::new(Box::new(DirSource(fixture_root().join("ui")))).unwrap()
    }

    const BRAIN: &str = "https://b.example";

    fn get(host: &Host, path: &str) -> HostAnswer {
        host.serve(
            &HostRequest {
                method: "GET",
                path,
                origin: None,
                referer: None,
            },
            BRAIN,
            &|| Some(serde_json::json!({ "siteName": "Acme" })),
        )
    }

    /// The drift guard: every case in the shared table, the same table the TS
    /// host's test runs (client/host/src/host-contract.test.ts).
    #[test]
    fn the_shared_host_cases() {
        let raw = std::fs::read_to_string(fixture_root().join("cases.json")).unwrap();
        let table: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(table["brain"], BRAIN);
        let host = fixture_host();
        let csp_template =
            std::fs::read_to_string(fixture_root().join("ui/_mantle/csp.txt")).unwrap();
        let cases = table["cases"].as_array().unwrap();
        assert!(cases.len() >= 10);
        for case in cases {
            let path = case["path"].as_str().unwrap();
            // A query is not part of the path the host reads.
            let path_only = path.split('?').next().unwrap();
            let res = get(&host, path_only);
            assert_eq!(
                res.status as u64,
                case["status"].as_u64().unwrap(),
                "{path}"
            );
            assert_eq!(
                res.header("x-content-type-options"),
                Some("nosniff"),
                "{path}"
            );
            match case["file"].as_str() {
                Some(file) => {
                    let want = std::fs::read(fixture_root().join("ui").join(file)).unwrap();
                    assert_eq!(res.body, want, "{path}");
                }
                None if case["env"].as_bool() == Some(true) => {
                    let body = String::from_utf8(res.body.clone()).unwrap();
                    let json = body
                        .strip_prefix("window.__MANTLE_ENV__ = ")
                        .and_then(|b| b.strip_suffix(';'))
                        .unwrap();
                    let env: serde_json::Value = serde_json::from_str(json).unwrap();
                    assert_eq!(env["apiBase"], BRAIN);
                    assert_eq!(env["serverOrigin"], BRAIN);
                    assert_eq!(env["appearance"]["siteName"], "Acme");
                }
                None => assert_eq!(res.body, b"Not found", "{path}"),
            }
            if let Some(kind) = case["type"].as_str() {
                assert_eq!(res.header("content-type"), Some(kind), "{path}");
            }
            if let Some(cache) = case["cache"].as_str() {
                assert_eq!(res.header("cache-control"), Some(cache), "{path}");
            }
            let csp = res.header("content-security-policy");
            if case["csp"].as_bool() == Some(true) {
                // This host's CSP is the TS host's, exactly.
                assert_eq!(csp, Some(fill_csp(&csp_template, BRAIN).as_str()), "{path}");
            } else {
                assert_eq!(csp, None, "{path}");
            }
            let no_ref = res.header("referrer-policy");
            if case["noReferrer"].as_bool() == Some(true) {
                assert_eq!(no_ref, Some("no-referrer"), "{path}");
            } else {
                assert_eq!(no_ref, None, "{path}");
            }
        }
    }

    #[test]
    fn only_get_and_head() {
        let host = fixture_host();
        for method in ["POST", "PUT", "DELETE", "OPTIONS", "PATCH"] {
            let res = host.serve(
                &HostRequest {
                    method,
                    path: "/",
                    origin: None,
                    referer: None,
                },
                BRAIN,
                &|| None,
            );
            assert_eq!(res.status, 405, "{method}");
            assert_eq!(res.header("x-content-type-options"), Some("nosniff"));
        }
        let head = host.serve(
            &HostRequest {
                method: "HEAD",
                path: "/login",
                origin: None,
                referer: None,
            },
            BRAIN,
            &|| None,
        );
        assert_eq!(head.status, 200);
        assert!(head.body.is_empty());
        assert!(head.header("content-security-policy").is_some());
    }

    #[test]
    fn refuses_a_request_from_another_origin() {
        let host = fixture_host();
        let ask = |origin: Option<&str>, referer: Option<&str>| {
            host.serve(
                &HostRequest {
                    method: "GET",
                    path: "/env.js",
                    origin,
                    referer,
                },
                BRAIN,
                &|| None,
            )
            .status
        };
        assert_eq!(ask(None, None), 200);
        assert_eq!(ask(Some("mantle-ui://localhost"), None), 200);
        assert_eq!(ask(None, Some("mantle-ui://localhost/notes/x")), 200);
        assert_eq!(ask(Some("https://b.example"), None), 403);
        assert_eq!(ask(Some("null"), None), 403);
        assert_eq!(ask(Some("mantle-ui://localhost/"), None), 403);
        assert_eq!(ask(None, Some("https://b.example/api/apps/a/frame")), 403);
        assert_eq!(ask(None, Some("mantle-ui://localhost:1/")), 403);
        assert_eq!(ask(None, Some("not a url")), 403);
        // A blob the UI made is the UI's; one a brain frame made is not.
        assert_eq!(ask(None, Some("blob:mantle-ui://localhost/1234")), 200);
        assert_eq!(ask(None, Some("blob:https://b.example/1234")), 403);
        assert_eq!(ask(None, Some("blob:mantle-ui://localhost:1/1234")), 403);
        assert_eq!(ask(None, Some("blob:null/1234")), 403);
    }

    #[test]
    fn env_js_sends_null_when_the_appearance_fails() {
        let host = fixture_host();
        let res = host.serve(
            &HostRequest {
                method: "GET",
                path: "/env.js",
                origin: None,
                referer: None,
            },
            BRAIN,
            &|| None,
        );
        let body = String::from_utf8(res.body).unwrap();
        assert!(body.contains("\"appearance\":null"), "{body}");
        assert!(body.starts_with(
            "window.__MANTLE_ENV__ = {\"apiBase\":\"https://b.example\",\"serverOrigin\":\"https://b.example\",\"turnStreaming\":\"\",\"tour\":\"\""
        ));
    }

    /// The real export: its CSP lets the page reach its brain and its vault
    /// (`'self'`), and names no IPC.
    #[test]
    fn the_real_csp_reaches_the_brain_and_the_vault_and_no_ipc() {
        let out = Path::new(env!("CARGO_MANIFEST_DIR")).join("../web/out");
        let host = Host::new(Box::new(DirSource(out))).unwrap();
        let csp = host.csp_for("http://127.0.0.1:3000");
        let connect = csp
            .split(';')
            .map(str::trim)
            .find(|d| d.starts_with("connect-src "))
            .unwrap();
        let sources: Vec<&str> = connect.split_whitespace().skip(1).collect();
        for want in ["'self'", "http://127.0.0.1:3000", "ws://127.0.0.1:3000"] {
            assert!(sources.contains(&want), "{want} missing from {connect}");
        }
        assert!(
            !csp.contains("ipc:") && !csp.contains("ipc.localhost"),
            "{csp}"
        );
        assert!(!csp.contains("{brain"));
    }
}
