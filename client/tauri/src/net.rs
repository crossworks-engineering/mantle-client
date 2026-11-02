//! The two requests the shell itself sends to a brain: its public appearance
//! for env.js, and the version probe before a brain is saved. Both go out as
//! a native client's request: no cookie (ureq keeps none without its
//! `cookies` feature), no redirect followed, a short timeout, a capped body,
//! and TLS checked against the OS trust store. The page's own requests never pass through here; WebKit sends them.

use std::collections::HashMap;
use std::io::Read;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use ureq::{Agent, ResponseExt};

/// Bigger than any real appearance (a few hundred bytes), small enough that a
/// brain cannot swell every page's env.js.
pub const APPEARANCE_MAX_BYTES: u64 = 64 * 1024;
pub const APPEARANCE_TIMEOUT: Duration = Duration::from_secs(2);
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(10);

fn agent(timeout: Duration) -> Agent {
    Agent::config_builder()
        // The OS's own trust store (rustls-platform-verifier), as WebKit
        // uses it: a brain on a private CA the computer trusts works for the
        // shell's two requests exactly as it does for the page's.
        .tls_config(
            ureq::tls::TlsConfig::builder()
                .root_certs(ureq::tls::RootCerts::PlatformVerifier)
                .build(),
        )
        .timeout_global(Some(timeout))
        // 0: a 3xx is the answer, and it fails the status check below.
        .max_redirects(0)
        .http_status_as_error(false)
        .build()
        .into()
}

/// GET `<brain><path>`; the body as text, if the brain itself answered 2xx
/// with at most `max` bytes.
fn get_text(brain_origin: &str, path: &str, timeout: Duration, max: u64) -> Result<String, String> {
    let url = format!("{brain_origin}{path}");
    let mut res = agent(timeout).get(&url).call().map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    if !(200..300).contains(&status) {
        return Err(format!("HTTP {status}"));
    }
    // No redirect is followed, so this holds; checked anyway, as the TS host
    // does, because the body is handed to every page of this brain.
    let answered = url::Url::parse(&res.get_uri().to_string())
        .map(|u| u.origin().ascii_serialization())
        .unwrap_or_default();
    if answered != brain_origin {
        return Err("off-origin answer".into());
    }
    let mut body = Vec::new();
    res.body_mut()
        .as_reader()
        .take(max + 1)
        .read_to_end(&mut body)
        .map_err(|e| e.to_string())?;
    if body.len() as u64 > max {
        return Err("answer too large".into());
    }
    String::from_utf8(body).map_err(|e| e.to_string())
}

/// One read of `<brain>/api/appearance`: only a JSON object passes.
pub fn fetch_appearance(brain_origin: &str) -> Result<serde_json::Value, String> {
    let text = get_text(
        brain_origin,
        "/api/appearance",
        APPEARANCE_TIMEOUT,
        APPEARANCE_MAX_BYTES,
    )?;
    let value: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    if value.is_object() {
        Ok(value)
    } else {
        Err("appearance is not an object".into())
    }
}

/// Probe-before-save: `GET /api/version` must answer a string `version`.
pub fn probe_version(brain_origin: &str) -> Result<String, String> {
    let text = get_text(brain_origin, "/api/version", PROBE_TIMEOUT, 64 * 1024)?;
    let value: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    value
        .get("version")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .ok_or_else(|| "not a MantleOS server".into())
}

type Fetch = dyn Fn(&str) -> Result<serde_json::Value, String> + Send + Sync;

struct Cached {
    at: Instant,
    ok: bool,
    value: Option<serde_json::Value>,
}

/// The brain's public appearance for env.js, cached per brain the way the TS
/// host does (appearanceCache): 30 s after a success, 5 s after a failure
/// (keeping the last good value). A page never waits longer than the fetch's
/// own timeout, and never fails over it: the answer is then None (null).
pub struct AppearanceCache {
    fetch: Box<Fetch>,
    now: Box<dyn Fn() -> Instant + Send + Sync>,
    entries: Mutex<HashMap<String, Cached>>,
}

impl AppearanceCache {
    pub fn new() -> Self {
        Self::with(Box::new(fetch_appearance), Box::new(Instant::now))
    }

    pub fn with(fetch: Box<Fetch>, now: Box<dyn Fn() -> Instant + Send + Sync>) -> Self {
        Self {
            fetch,
            now,
            entries: Mutex::new(HashMap::new()),
        }
    }

    pub fn get(&self, brain_origin: &str) -> Option<serde_json::Value> {
        let last = {
            let entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(hit) = entries.get(brain_origin) {
                let ttl = Duration::from_secs(if hit.ok { 30 } else { 5 });
                if (self.now)().duration_since(hit.at) < ttl {
                    return hit.value.clone();
                }
                hit.value.clone()
            } else {
                None
            }
        };
        // The lock is not held across the fetch: one slow brain never holds
        // up another brain's page.
        let (ok, value) = match (self.fetch)(brain_origin) {
            Ok(value) => (true, Some(value)),
            Err(_) => (false, last),
        };
        self.entries
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(
                brain_origin.to_string(),
                Cached {
                    at: (self.now)(),
                    ok,
                    value: value.clone(),
                },
            );
        value
    }
}

impl Default for AppearanceCache {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::io::Write;
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::Arc;

    /// A one-route HTTP stub on loopback: every request gets `answer`.
    /// Returns its origin and a flag set when it was reached.
    pub fn stub(answer: String, delay: Duration) -> (String, Arc<AtomicBool>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let reached = Arc::new(AtomicBool::new(false));
        let flag = reached.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                flag.store(true, Ordering::SeqCst);
                let mut buf = [0u8; 4096];
                let _ = stream.read(&mut buf);
                std::thread::sleep(delay);
                let _ = stream.write_all(answer.as_bytes());
            }
        });
        (origin, reached)
    }

    pub fn ok_json(body: &str) -> String {
        format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    #[test]
    fn reads_a_json_object() {
        let (brain, _) = stub(ok_json(r#"{"siteName":"Acme"}"#), Duration::ZERO);
        assert_eq!(fetch_appearance(&brain).unwrap()["siteName"], "Acme");
    }

    #[test]
    fn refuses_an_array_a_non_object_a_huge_body_and_an_error_status() {
        let huge = format!(r#"{{"x":"{}"}}"#, "x".repeat(70 * 1024));
        for answer in [
            ok_json("[1,2]"),
            ok_json(r#""text""#),
            ok_json("null"),
            ok_json(&huge),
            "HTTP/1.1 500 Oops\r\ncontent-length: 2\r\nconnection: close\r\n\r\n{}".to_string(),
        ] {
            let (brain, _) = stub(answer, Duration::ZERO);
            assert!(fetch_appearance(&brain).is_err());
        }
    }

    #[test]
    fn never_follows_a_redirect_off_the_brain() {
        let (target, reached) = stub(ok_json(r#"{"siteName":"lan"}"#), Duration::ZERO);
        let (brain, _) = stub(
            format!("HTTP/1.1 302 Found\r\nlocation: {target}/x.json\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"),
            Duration::ZERO,
        );
        assert!(fetch_appearance(&brain).is_err());
        assert!(probe_version(&brain).is_err());
        assert!(!reached.load(Ordering::SeqCst));
    }

    #[test]
    fn gives_up_at_the_timeout() {
        let (brain, _) = stub(ok_json("{}"), Duration::from_secs(4));
        let started = Instant::now();
        assert!(fetch_appearance(&brain).is_err());
        assert!(started.elapsed() < Duration::from_millis(3500));
    }

    #[test]
    fn probe_needs_a_string_version() {
        let (brain, _) = stub(ok_json(r#"{"version":"0.400.73"}"#), Duration::ZERO);
        assert_eq!(probe_version(&brain).unwrap(), "0.400.73");
        for body in [r#"{"version":7}"#, "{}", "<html>"] {
            let (brain, _) = stub(ok_json(body), Duration::ZERO);
            assert!(probe_version(&brain).is_err(), "{body}");
        }
    }

    #[test]
    fn caches_a_success_for_30s_and_a_failure_for_5s_keeping_the_last_good_value() {
        let base = Instant::now();
        let t = Arc::new(Mutex::new(Duration::ZERO));
        let calls = Arc::new(AtomicUsize::new(0));
        let fail = Arc::new(AtomicBool::new(false));
        let (c, f, tt) = (calls.clone(), fail.clone(), t.clone());
        let cache = AppearanceCache::with(
            Box::new(move |_| {
                let n = c.fetch_add(1, Ordering::SeqCst) + 1;
                if f.load(Ordering::SeqCst) {
                    Err("down".into())
                } else {
                    Ok(serde_json::json!({ "siteName": format!("v{n}") }))
                }
            }),
            Box::new(move || base + *tt.lock().unwrap()),
        );
        let at = |secs: u64| *t.lock().unwrap() = Duration::from_secs(secs);
        let brain = "https://b.example";
        assert_eq!(cache.get(brain).unwrap()["siteName"], "v1");
        at(29);
        assert_eq!(cache.get(brain).unwrap()["siteName"], "v1");
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        at(31);
        fail.store(true, Ordering::SeqCst);
        assert_eq!(cache.get(brain).unwrap()["siteName"], "v1");
        at(34);
        cache.get(brain);
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        at(37);
        fail.store(false, Ordering::SeqCst);
        assert_eq!(cache.get(brain).unwrap()["siteName"], "v3");
    }

    #[test]
    fn keeps_each_brain_apart_and_answers_none_when_never_reached() {
        let cache = AppearanceCache::with(
            Box::new(|brain| {
                if brain.contains("down") {
                    Err("down".into())
                } else {
                    Ok(serde_json::json!({ "from": brain }))
                }
            }),
            Box::new(Instant::now),
        );
        assert_eq!(
            cache.get("https://a.example").unwrap()["from"],
            "https://a.example"
        );
        assert_eq!(
            cache.get("https://b.example").unwrap()["from"],
            "https://b.example"
        );
        assert_eq!(cache.get("https://down.example"), None);
    }
}
