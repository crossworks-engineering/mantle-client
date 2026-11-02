//! The app's shared state, and the two schemes it serves.
//!
//!   mantle-ui://localhost       the owner UI, to brain windows only (host.rs)
//!   mantle-connect://localhost  the connect page, to the connect window only
//!
//! Nothing intercepts http: a brain window's page talks to its brain
//! directly from WebKit, and the CSP served here is what keeps it there.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use keyring_core::CredentialStore;
use tauri::http::{self, header};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};

use crate::fence::{CONNECT_ORIGIN, UI_ORIGIN};
use crate::host::{FileSource, Host, HostAnswer, HostRequest};
use crate::net::AppearanceCache;
use crate::profiles::Profiles;
use crate::vault::Vault;

pub const CONNECT_LABEL: &str = "connect";

pub struct Shell {
    pub host: Host,
    pub profiles: Profiles,
    pub vault: Vault,
    pub appearance: AppearanceCache,
    pub data_dir: PathBuf,
    /// Brain window label -> the brain origin it was opened for. A window's
    /// brain is fixed for its life: the scheme reads it here, per request.
    windows: Mutex<HashMap<String, String>>,
    /// The brain whose window was in front last (the menu's check mark).
    front: Mutex<Option<String>>,
    /// Profile lists are read, changed and written whole: one at a time.
    pub edits: Mutex<()>,
    trace: bool,
}

impl Shell {
    pub fn new(
        files: Box<dyn FileSource>,
        identifier: &str,
        config_dir: &Path,
        data_dir: &Path,
        store: Option<Arc<CredentialStore>>,
        on_keychain_unavailable: Box<dyn Fn() + Send + Sync>,
    ) -> Result<Shell, String> {
        // Off unless asked for: a line per scheme request and per vault
        // call on stderr, for checking a build. Never a token.
        let trace = std::env::var_os("MANTLE_DESKTOP_TRACE").is_some();
        Ok(Shell {
            host: Host::new(files)?,
            profiles: Profiles::new(config_dir),
            vault: Vault::new(identifier, data_dir, store, on_keychain_unavailable, trace),
            appearance: AppearanceCache::new(),
            data_dir: data_dir.to_path_buf(),
            windows: Mutex::new(HashMap::new()),
            front: Mutex::new(None),
            edits: Mutex::new(()),
            trace,
        })
    }

    pub fn trace(&self, line: impl FnOnce() -> String) {
        if self.trace {
            eprintln!("[mantle-desktop] {}", line());
        }
    }

    pub fn register_window(&self, label: &str, brain_origin: &str) {
        self.windows
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(label.to_string(), brain_origin.to_string());
    }

    pub fn unregister_window(&self, label: &str) {
        self.windows
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(label);
        let mut front = self.front.lock().unwrap_or_else(|e| e.into_inner());
        if front.as_deref().map(crate::profiles::label_for).as_deref() == Some(label) {
            *front = None;
        }
    }

    /// The brain origin of an open brain window.
    pub fn brain_of_window(&self, label: &str) -> Option<String> {
        self.windows
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(label)
            .cloned()
    }

    pub fn front(&self) -> Option<String> {
        self.front.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub fn set_front(&self, id: Option<String>) {
        *self.front.lock().unwrap_or_else(|e| e.into_inner()) = id;
    }

    /// Ids whose data store could not be removed yet (still in use): retried
    /// at the next start, before any window opens.
    fn removals_path(&self) -> PathBuf {
        self.data_dir.join("pending-removals.json")
    }

    pub fn pending_removals(&self) -> Vec<String> {
        std::fs::read_to_string(self.removals_path())
            .ok()
            .and_then(|t| serde_json::from_str::<Vec<String>>(&t).ok())
            .unwrap_or_default()
            .into_iter()
            .filter(|id| crate::profiles::valid_id(id))
            .collect()
    }

    pub fn set_pending_removals(&self, ids: &[String]) {
        if ids.is_empty() {
            let _ = std::fs::remove_file(self.removals_path());
            return;
        }
        let _ = std::fs::create_dir_all(&self.data_dir);
        if let Ok(text) = serde_json::to_string(ids) {
            let _ = std::fs::write(self.removals_path(), text);
        }
    }
}

/// Header values as the host reads them. A value that is not text is kept
/// as one that names no origin, so a check on it fails rather than passes.
fn header_of(req: &http::Request<Vec<u8>>, name: header::HeaderName) -> Option<&str> {
    req.headers()
        .get(name)
        .map(|v| v.to_str().unwrap_or("\u{0}"))
}

fn to_response(answer: HostAnswer) -> http::Response<Vec<u8>> {
    let mut builder = http::Response::builder().status(answer.status);
    for (name, value) in &answer.headers {
        builder = builder.header(*name, value);
    }
    builder.body(answer.body).unwrap_or_else(|_| {
        let mut res = http::Response::new(Vec::new());
        *res.status_mut() = http::StatusCode::INTERNAL_SERVER_ERROR;
        res
    })
}

fn forbidden() -> HostAnswer {
    HostAnswer {
        status: 403,
        headers: vec![("x-content-type-options", "nosniff".into())],
        body: b"Forbidden".to_vec(),
    }
}

/// `mantle-ui://`: the UI, for the brain of the window that asks, and the
/// page's vault (vault_endpoint.rs). The window is known from the request's
/// webview label, never from anything in the request. Answered off the main
/// thread: env.js may wait on the brain, and the vault on the keychain.
pub fn serve_ui<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    req: http::Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    let label = ctx.webview_label().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        if req.uri().path() == crate::vault_endpoint::VAULT_PATH {
            responder.respond(crate::vault_endpoint::serve(&app, &label, &req));
            return;
        }
        let shell = app.state::<Shell>();
        let answer = match shell.brain_of_window(&label) {
            None => forbidden(),
            Some(brain) => shell.host.serve(
                &HostRequest {
                    method: req.method().as_str(),
                    path: req.uri().path(),
                    origin: header_of(&req, header::ORIGIN),
                    referer: header_of(&req, header::REFERER),
                },
                &brain,
                &|| shell.appearance.get(&brain),
            ),
        };
        shell.trace(|| {
            let mut line = format!(
                "ui {label} {} {} -> {}",
                req.method(),
                req.uri().path(),
                answer.status
            );
            if let Some(csp) = answer.header("content-security-policy") {
                line.push_str(&format!("\n  csp: {csp}"));
            }
            if req.uri().path() == "/env.js" {
                line.push_str(&format!(
                    "\n  env.js: {}",
                    String::from_utf8_lossy(&answer.body)
                ));
            }
            line
        });
        responder.respond(to_response(answer));
    });
}

const CONNECT_HTML: &[u8] = include_bytes!("../connect/index.html");
const CONNECT_JS: &[u8] = include_bytes!("../connect/connect.js");
const CONNECT_CSS: &[u8] = include_bytes!("../connect/connect.css");

/// The connect page names nothing but itself and Tauri's IPC (its profile
/// commands).
pub const CONNECT_CSP: &str = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src ipc: http://ipc.localhost; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/// What the connect scheme answers, for the connect window only. Pure.
pub fn connect_answer(
    is_connect_window: bool,
    method: &str,
    path: &str,
    origin: Option<&str>,
    referer: Option<&str>,
) -> HostAnswer {
    let nosniff = ("x-content-type-options", "nosniff".to_string());
    if !method.eq_ignore_ascii_case("GET") && !method.eq_ignore_ascii_case("HEAD") {
        return HostAnswer {
            status: 405,
            headers: vec![nosniff, ("allow", "GET, HEAD".into())],
            body: b"Method not allowed".to_vec(),
        };
    }
    let referer_ok =
        referer.is_none_or(|r| url::Url::parse(r).is_ok_and(|u| crate::fence::is_connect_url(&u)));
    if !is_connect_window || origin.is_some_and(|o| o != CONNECT_ORIGIN) || !referer_ok {
        return forbidden();
    }
    let (kind, body) = match path {
        "/" | "/index.html" => ("text/html; charset=utf-8", CONNECT_HTML),
        "/connect.js" => ("text/javascript; charset=utf-8", CONNECT_JS),
        "/connect.css" => ("text/css; charset=utf-8", CONNECT_CSS),
        _ => {
            return HostAnswer {
                status: 404,
                headers: vec![nosniff],
                body: b"Not found".to_vec(),
            }
        }
    };
    let mut headers = vec![
        ("content-type", kind.to_string()),
        nosniff,
        ("cache-control", "no-cache".into()),
    ];
    if kind.starts_with("text/html") {
        headers.push(("content-security-policy", CONNECT_CSP.into()));
        headers.push(("referrer-policy", "no-referrer".into()));
    }
    let body = if method.eq_ignore_ascii_case("HEAD") {
        Vec::new()
    } else {
        body.to_vec()
    };
    HostAnswer {
        status: 200,
        headers,
        body,
    }
}

pub fn serve_connect<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    req: http::Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let answer = connect_answer(
        ctx.webview_label() == CONNECT_LABEL,
        req.method().as_str(),
        req.uri().path(),
        header_of(&req, header::ORIGIN),
        header_of(&req, header::REFERER),
    );
    if let Some(shell) = ctx.app_handle().try_state::<Shell>() {
        shell.trace(|| {
            format!(
                "connect {} {} {} -> {}",
                ctx.webview_label(),
                req.method(),
                req.uri().path(),
                answer.status
            )
        });
    }
    responder.respond(to_response(answer));
}

/// The UI's origin, for code that builds the first URL of a brain window.
pub fn ui_root() -> url::Url {
    url::Url::parse(&format!("{UI_ORIGIN}/")).expect("the UI origin parses")
}

pub fn connect_root() -> url::Url {
    url::Url::parse(&format!("{CONNECT_ORIGIN}/")).expect("the connect origin parses")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_connect_page_is_for_the_connect_window_only() {
        let page = connect_answer(true, "GET", "/", None, None);
        assert_eq!(page.status, 200);
        assert_eq!(page.header("content-security-policy"), Some(CONNECT_CSP));
        assert_eq!(page.header("x-content-type-options"), Some("nosniff"));
        assert_eq!(
            connect_answer(true, "GET", "/connect.js", Some(CONNECT_ORIGIN), None).status,
            200
        );
        assert_eq!(connect_answer(false, "GET", "/", None, None).status, 403);
        assert_eq!(
            connect_answer(true, "GET", "/", Some(UI_ORIGIN), None).status,
            403
        );
        assert_eq!(
            connect_answer(
                true,
                "GET",
                "/connect.js",
                None,
                Some("mantle-ui://localhost/")
            )
            .status,
            403
        );
        assert_eq!(connect_answer(true, "POST", "/", None, None).status, 405);
        assert_eq!(connect_answer(true, "GET", "/../x", None, None).status, 404);
        assert!(connect_answer(true, "HEAD", "/", None, None)
            .body
            .is_empty());
    }
}
