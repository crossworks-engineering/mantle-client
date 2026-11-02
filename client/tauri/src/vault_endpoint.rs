//! The page's way to the vault: `POST mantle-ui://localhost/_mantle/vault`,
//! sent as a SYNCHRONOUS XMLHttpRequest by the page API (windows.rs,
//! page_api_script), so `window.mantleDesktop.tokenVault` has Electron's
//! synchronous shape. The body is JSON, `{op, ...args}`; the answer is JSON,
//! `{"value": <string or null>}`.
//!
//! Answered only when ALL of these hold, and otherwise 403 with an empty
//! body, with nothing done:
//!
//!   - the method is POST, with `X-Mantle-Vault: 1`;
//!   - `Origin` is exactly `mantle-ui://localhost` (WebKit sets it per
//!     requesting document: a brain frame sends the brain's origin, a
//!     sandboxed frame `null`, and neither can send a custom header across
//!     origins without a preflight, which is refused here too);
//!   - the requesting webview's label is a brain window the shell opened,
//!     for a brain it still lists;
//!   - that window's current URL is on the UI origin.
//!
//! The brain is the window's, from its label: never from the body. Called
//! off the main thread (shell.rs, serve_ui); the vault serializes the work.
//!
//! On Linux, wry gives a webview only its main frame's URL, and WebKitGTK's
//! navigation and IPC hooks cannot tell a sub-frame from the main frame. The
//! `Origin` check is what tells them apart here: it is the requesting
//! document's own origin, which a frame cannot choose.

use tauri::http::{self, header};
use tauri::{AppHandle, Manager, Runtime};

use crate::fence::{is_ui_url, UI_ORIGIN};
use crate::profiles::id_from_label;
use crate::shell::Shell;
use crate::vault::Vault;

pub const VAULT_PATH: &str = "/_mantle/vault";
pub const VAULT_HEADER: &str = "x-mantle-vault";

/// keepOnly carries bearers; a few of them, never a megabyte.
const MAX_BODY_BYTES: usize = 256 * 1024;

/// The request's own checks: POST, the marker header once with value `1`,
/// and exactly one `Origin`, the UI's.
pub fn request_ok(method: &str, marker: &[&[u8]], origin: &[&[u8]]) -> bool {
    method == "POST" && marker == [b"1".as_slice()] && origin == [UI_ORIGIN.as_bytes()]
}

/// The profile a vault request is for: the requesting window's own, when it
/// is an open brain window of a listed brain, showing the UI.
pub fn caller<R: Runtime>(app: &AppHandle<R>, label: &str) -> Option<String> {
    let id = id_from_label(label)?;
    let shell = app.state::<Shell>();
    shell.brain_of_window(label)?;
    shell.profiles.find(id)?;
    // The webview's current URL: its main frame's. Read from this worker
    // thread, it waits on the main thread, which never waits on the vault.
    let url = app.get_webview_window(label)?.url().ok()?;
    is_ui_url(&url).then(|| id.to_string())
}

fn str_arg<'a>(body: &'a serde_json::Value, key: &str) -> &'a str {
    body.get(key).and_then(|v| v.as_str()).unwrap_or("")
}

/// Strings only: anything else in either list is ignored, as Electron does.
fn strings(value: Option<&serde_json::Value>) -> Option<Vec<String>> {
    value.and_then(|v| v.as_array()).map(|items| {
        items
            .iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect()
    })
}

/// The op, for the trace line: a name from the list, never a value.
pub fn op_name(body: &[u8]) -> &'static str {
    let op = serde_json::from_slice::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("op").and_then(|o| o.as_str()).map(str::to_string));
    match op.as_deref() {
        Some("get") => "get",
        Some("set") => "set",
        Some("clear") => "clear",
        Some("getFor") => "getFor",
        Some("setFor") => "setFor",
        Some("clearFor") => "clearFor",
        Some("adopt") => "adopt",
        Some("keepOnly") => "keepOnly",
        _ => "unknown",
    }
}

/// One vault call for `profile`. None: not a call this endpoint knows.
pub fn answer(vault: &Vault, profile: &str, body: &[u8], now: u64) -> Option<Option<String>> {
    if body.len() > MAX_BODY_BYTES {
        return None;
    }
    let body: serde_json::Value = serde_json::from_slice(body).ok()?;
    let op = body.get("op")?.as_str()?;
    let session = str_arg(&body, "sessionId");
    let token = str_arg(&body, "token");
    Some(match op {
        "get" => vault.get(profile),
        "set" => {
            vault.set(profile, token);
            None
        }
        "clear" => {
            vault.clear(profile);
            None
        }
        "getFor" => vault.get_for(profile, session),
        "setFor" => {
            vault.set_for(profile, session, token, now);
            None
        }
        "clearFor" => {
            vault.clear_for(profile, session);
            None
        }
        "adopt" => vault.adopt(profile, session, now),
        "keepOnly" => {
            let ids = strings(body.get("sessionIds"));
            let strays = strings(body.get("strayBearers"));
            if let (Some(ids), Some(strays)) = (ids, strays) {
                vault.keep_only(profile, &ids, &strays, now);
            }
            None
        }
        _ => return None,
    })
}

fn empty(status: u16) -> http::Response<Vec<u8>> {
    http::Response::builder()
        .status(status)
        .header("x-content-type-options", "nosniff")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Vec::new())
        .unwrap_or_default()
}

fn values<'a>(req: &'a http::Request<Vec<u8>>, name: &str) -> Vec<&'a [u8]> {
    req.headers()
        .get_all(name)
        .iter()
        .map(|v| v.as_bytes())
        .collect()
}

/// Answers a request to VAULT_PATH from the webview `label`.
pub fn serve<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    req: &http::Request<Vec<u8>>,
) -> http::Response<Vec<u8>> {
    let shell = app.state::<Shell>();
    let checked = request_ok(
        req.method().as_str(),
        &values(req, VAULT_HEADER),
        &values(req, header::ORIGIN.as_str()),
    );
    let profile = if checked { caller(app, label) } else { None };
    let Some(profile) = profile else {
        shell.trace(|| format!("vault from {label} -> 403"));
        return empty(403);
    };
    let op = op_name(req.body());
    let Some(value) = answer(
        &shell.vault,
        &profile,
        req.body(),
        crate::profiles::now_ms(),
    ) else {
        shell.trace(|| format!("vault {op} from {label} -> 400"));
        return empty(400);
    };
    shell.trace(|| format!("vault {op} from {label} -> 200"));
    let body = serde_json::json!({ "value": value })
        .to_string()
        .into_bytes();
    http::Response::builder()
        .status(200)
        .header(header::CONTENT_TYPE, "application/json; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .header("x-content-type-options", "nosniff")
        .body(body)
        .unwrap_or_else(|_| empty(500))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_request_itself_must_be_a_post_from_the_ui_with_the_marker() {
        let ui = UI_ORIGIN.as_bytes();
        let one = b"1".as_slice();
        assert!(request_ok("POST", &[one], &[ui]));
        // No Origin, `null`, the brain, a look-alike, two of them.
        assert!(!request_ok("POST", &[one], &[]));
        assert!(!request_ok("POST", &[one], &[b"null"]));
        assert!(!request_ok("POST", &[one], &[b"https://brain.example"]));
        assert!(!request_ok(
            "POST",
            &[one],
            &[b"mantle-ui://localhost.evil"]
        ));
        assert!(!request_ok("POST", &[one], &[b"mantle-ui://localhost/"]));
        assert!(!request_ok("POST", &[one], &[b"MANTLE-UI://LOCALHOST"]));
        assert!(!request_ok("POST", &[one], &[ui, ui]));
        // The marker: missing, another value, twice.
        assert!(!request_ok("POST", &[], &[ui]));
        assert!(!request_ok("POST", &[b"0"], &[ui]));
        assert!(!request_ok("POST", &[b"1 "], &[ui]));
        assert!(!request_ok("POST", &[one, one], &[ui]));
        // Any other method.
        for method in ["GET", "HEAD", "OPTIONS", "PUT", "post"] {
            assert!(!request_ok(method, &[one], &[ui]), "{method}");
        }
    }

    #[test]
    fn op_names_never_carry_a_value() {
        assert_eq!(op_name(br#"{"op":"setFor","token":"secret"}"#), "setFor");
        assert_eq!(op_name(br#"{"op":"secret"}"#), "unknown");
        assert_eq!(op_name(b"not json"), "unknown");
    }
}
