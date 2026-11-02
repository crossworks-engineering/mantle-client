//! The pure parts of the fence around a brain window: which addresses the
//! shell accepts for a brain, where a window may go, and the in-app paths a
//! deep link may name. Ports of client/desktop/src/main/brain-fence.ts and
//! index.ts, with their test cases, so both shells answer the same.

use url::Url;

/// The scheme the owner UI is served on, and its one origin.
pub const UI_SCHEME: &str = "mantle-ui";
pub const UI_ORIGIN: &str = "mantle-ui://localhost";

/// The connect window's own scheme. Not the UI origin: the page that lists,
/// adds and removes brains shares no storage and no origin with any brain.
pub const CONNECT_SCHEME: &str = "mantle-connect";
pub const CONNECT_ORIGIN: &str = "mantle-connect://localhost";

/// Whether a parsed URL names a plain host: letters, digits, dots and dashes,
/// or a bracketed IPv6 address. A brain origin goes into the CSP as written,
/// so `https://*` would open connect-src to every https host.
pub fn plain_host(url: &Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    let plain = !host.is_empty()
        && host
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'-');
    let ipv6 = host.len() > 2
        && host.starts_with('[')
        && host.ends_with(']')
        && host[1..host.len() - 1]
            .bytes()
            .all(|b| (b.is_ascii_hexdigit() && !b.is_ascii_uppercase()) || b == b':' || b == b'.');
    plain || ipv6
}

/// `^[a-z][a-z0-9+.-]*://`, case-insensitive: whether the input names a scheme.
fn has_scheme(input: &str) -> bool {
    let bytes = input.as_bytes();
    if !bytes.first().is_some_and(u8::is_ascii_alphabetic) {
        return false;
    }
    for (i, &b) in bytes.iter().enumerate().skip(1) {
        if b == b':' {
            return input[i..].starts_with("://");
        }
        if !(b.is_ascii_alphanumeric() || b == b'+' || b == b'.' || b == b'-') {
            return false;
        }
    }
    false
}

/// URL to origin. A bare host gets https:// in front. The origin goes into
/// the window's CSP as written, so its host must be plain (no `*`, `;`, `,`).
pub fn normalize_origin(input: &str) -> Result<String, String> {
    let trimmed = input.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("empty URL".into());
    }
    let with_scheme = if has_scheme(trimmed) {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let url = Url::parse(&with_scheme).map_err(|e| e.to_string())?;
    if url.scheme() != "https" && url.scheme() != "http" {
        return Err(format!("unsupported protocol {}:", url.scheme()));
    }
    if !plain_host(&url) {
        return Err(format!("unsupported host {}", url.host_str().unwrap_or("")));
    }
    Ok(url.origin().ascii_serialization())
}

/// Whether an address read back from profiles.json is exactly one
/// normalize_origin would save today.
pub fn saved_origin_ok(origin: &str) -> bool {
    normalize_origin(origin).is_ok_and(|o| o == origin)
}

/// `{scheme}://localhost` with no port, user or password: the only form the
/// app's own pages are ever loaded from. Compared by parts because the url
/// crate gives a custom scheme an opaque origin.
fn is_own(url: &Url, scheme: &str) -> bool {
    url.scheme() == scheme
        && url.host_str() == Some("localhost")
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
}

pub fn is_ui_url(url: &Url) -> bool {
    is_own(url, UI_SCHEME)
}

pub fn is_connect_url(url: &Url) -> bool {
    is_own(url, CONNECT_SCHEME)
}

/// What a brain window does with a navigation.
#[derive(Debug, PartialEq, Eq)]
pub enum Navigation {
    Allow,
    /// Refused here, opened in the user's browser or mail app instead.
    OpenOutside,
    Refuse,
}

/// Whether a URL may be handed to the OS to open: http, https and mailto only.
pub fn may_open_outside(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "mailto")
}

/// A brain window's navigation fence (on_navigation).
///
/// The UI's own origin is allowed. So are the documents its frames load:
/// wry asks this handler for every navigation, the main frame's and each
/// sub-frame's alike, and gives no way to tell them apart (WKWebView's
/// navigation delegate and WebKitGTK's decide-policy both cover sub-frames).
/// Refusing the brain origin would take down the brain's app and canvas
/// frames, so it is allowed, and so are about:blank, about:srcdoc and blob:.
/// Which sub-frames may load at all is the CSP's frame-src (the brain, self
/// and blob:), and a main frame that ends up on the brain gets nothing from
/// the shell: the page API is defined only on the UI origin, and every vault
/// command checks the calling page is on it.
///
/// A plain link the user clicks in the main frame never gets here as a
/// brain-origin navigation: the page script turns it into a new-window
/// request first (windows.rs, page_api_script), which opens outside.
///
/// Anything else that is http, https or mailto opens outside; the rest is
/// refused. Tauri's own `tauri://localhost` is refused like any other scheme.
pub fn brain_navigation(url: &Url, brain_origin: &str) -> Navigation {
    if is_ui_url(url) {
        return Navigation::Allow;
    }
    if url.scheme() == "about" && matches!(url.path(), "blank" | "srcdoc") {
        return Navigation::Allow;
    }
    if url.scheme() == "blob" {
        // blob:<origin>/<uuid>, made by the UI or by the brain's own frame.
        let inner = Url::parse(url.path()).ok();
        let ok = inner.is_some_and(|inner| {
            is_ui_url(&inner) || inner.origin().ascii_serialization() == brain_origin
        });
        return if ok {
            Navigation::Allow
        } else {
            Navigation::Refuse
        };
    }
    if matches!(url.scheme(), "http" | "https")
        && url.origin().ascii_serialization() == brain_origin
    {
        return Navigation::Allow;
    }
    if may_open_outside(url) {
        Navigation::OpenOutside
    } else {
        Navigation::Refuse
    }
}

/// The connect window goes nowhere but its own page; a link opens outside.
pub fn connect_navigation(url: &Url) -> Navigation {
    if is_connect_url(url) {
        Navigation::Allow
    } else if may_open_outside(url) {
        Navigation::OpenOutside
    } else {
        Navigation::Refuse
    }
}

/// mantle://n/<id> (the permalink responders embed) to the in-app /n/<id>;
/// any mantle://<path> maps the same way. Deep links are wired in T2; this
/// is the pure part, ported now with Electron's rules.
pub fn deep_link_to_path(link: &str) -> Option<String> {
    let url = Url::parse(link).ok()?;
    if url.scheme() != "mantle" {
        return None;
    }
    let host = match (url.host_str(), url.port()) {
        (Some(h), Some(p)) => format!("{h}:{p}"),
        (Some(h), None) => h.to_string(),
        (None, _) => String::new(),
    };
    let search = match url.query() {
        Some(q) if !q.is_empty() => format!("?{q}"),
        _ => String::new(),
    };
    let joined = format!("/{host}{}{search}", url.path());
    let trimmed = joined.trim_end_matches('/');
    let path = if trimmed.is_empty() { "/" } else { trimmed };
    // A PATH, and only a path. `mantle:///evil.example` parses with an EMPTY
    // host, which makes this `//evil.example`: a scheme-relative URL that
    // resolves to another origin. WebKit reads `/\` as `//`, so both go.
    let second = path.as_bytes().get(1).copied();
    if path.starts_with('/') && second != Some(b'/') && second != Some(b'\\') {
        Some(path.to_string())
    } else {
        None
    }
}

/// The one place an in-app path becomes a URL for a window to load: whatever
/// the path looked like, the result must sit on the UI's own origin, or it is
/// not loaded at all.
pub fn in_app_url(path: &str, renderer_url: &str) -> Option<String> {
    let base = Url::parse(renderer_url).ok()?;
    let target = base.join(path).ok()?;
    let same = target.scheme() == base.scheme()
        && target.host_str() == base.host_str()
        && target.port_or_known_default() == base.port_or_known_default();
    same.then(|| target.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    // brain-fence.test.ts: plainHost (static-host.test.ts)
    #[test]
    fn plain_host_takes_names_ipv4_and_bracketed_ipv6() {
        for u in [
            "https://b.example",
            "http://127.0.0.1:3000",
            "http://[::1]:3000",
        ] {
            assert!(plain_host(&url(u)), "{u}");
        }
    }

    #[test]
    fn plain_host_refuses_a_wildcard_semicolon_or_comma() {
        for u in [
            "https://*",
            "https://*.x.com",
            "https://a;b.com",
            "https://a,b.com",
        ] {
            // The url crate may refuse some of these outright; either way
            // nothing with such a host gets through.
            if let Ok(parsed) = Url::parse(u) {
                assert!(!plain_host(&parsed), "{u}");
            }
        }
    }

    // brain-fence.test.ts: normalizeOrigin
    #[test]
    fn normalize_origin_turns_what_a_user_types_into_an_origin() {
        assert_eq!(
            normalize_origin("brain.example/").unwrap(),
            "https://brain.example"
        );
        assert_eq!(
            normalize_origin(" http://127.0.0.1:3000/x ").unwrap(),
            "http://127.0.0.1:3000"
        );
    }

    #[test]
    fn normalize_origin_refuses_another_scheme_and_a_host_that_is_not_plain() {
        for bad in [
            "ftp://b.example",
            "https://*",
            "https://*.x.com",
            "https://a;b.com",
            "",
        ] {
            assert!(normalize_origin(bad).is_err(), "{bad}");
        }
    }

    // brain-fence.test.ts: savedOriginOk
    #[test]
    fn saved_origin_ok_takes_an_address_exactly_as_saved() {
        assert!(saved_origin_ok("https://brain.example"));
        assert!(saved_origin_ok("http://127.0.0.1:3000"));
    }

    #[test]
    fn saved_origin_ok_refuses_what_an_older_build_or_a_hand_edit_could_leave() {
        for bad in [
            "https://*.attacker.example",
            "brain.example",
            "https://brain.example/",
            "HTTPS://BRAIN.EXAMPLE",
            "https://a;b.com",
        ] {
            assert!(!saved_origin_ok(bad), "{bad}");
        }
        // `undefined` and `42` in the TS test: profiles.rs reads the origin
        // as a string first, so a non-string never reaches this (see there).
    }

    #[test]
    fn brain_navigation_keeps_the_window_on_the_ui() {
        let brain = "https://brain.example";
        let allow = [
            "mantle-ui://localhost/",
            "mantle-ui://localhost/notes/x?y=1",
            "https://brain.example/api/apps/a1/frame?t=x",
            "about:blank",
            "about:srcdoc",
            "blob:mantle-ui://localhost/1234",
            "blob:https://brain.example/1234",
        ];
        for u in allow {
            assert_eq!(brain_navigation(&url(u), brain), Navigation::Allow, "{u}");
        }
        let outside = [
            "https://evil.example/",
            "http://brain.example/",
            "https://brain.example:8443/",
            "mailto:a@b.example",
        ];
        for u in outside {
            assert_eq!(
                brain_navigation(&url(u), brain),
                Navigation::OpenOutside,
                "{u}"
            );
        }
        let refuse = [
            "tauri://localhost/",
            "mantle-connect://localhost/",
            "mantle-ui://localhost:1/",
            "mantle-ui://evil/",
            "mantle-ui://user@localhost/",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,x",
            "blob:https://evil.example/1234",
            "about:config",
            "ftp://x.example/",
        ];
        for u in refuse {
            assert_eq!(brain_navigation(&url(u), brain), Navigation::Refuse, "{u}");
        }
    }

    #[test]
    fn connect_navigation_stays_on_its_own_page() {
        assert_eq!(
            connect_navigation(&url("mantle-connect://localhost/")),
            Navigation::Allow
        );
        assert_eq!(
            connect_navigation(&url("mantle-ui://localhost/")),
            Navigation::Refuse
        );
        assert_eq!(
            connect_navigation(&url("https://x.example/")),
            Navigation::OpenOutside
        );
    }

    #[test]
    fn deep_link_maps_a_permalink_to_its_path() {
        assert_eq!(
            deep_link_to_path("mantle://n/abc123").as_deref(),
            Some("/n/abc123")
        );
        assert_eq!(
            deep_link_to_path("mantle://notes/abc?x=1").as_deref(),
            Some("/notes/abc?x=1")
        );
        assert_eq!(
            deep_link_to_path("mantle://n/abc/").as_deref(),
            Some("/n/abc")
        );
        assert_eq!(deep_link_to_path("mantle://").as_deref(), Some("/"));
    }

    #[test]
    fn deep_link_never_names_another_origin() {
        // The empty-host form became `//evil.example`, scheme-relative.
        assert_eq!(deep_link_to_path("mantle:///evil.example"), None);
        assert_eq!(deep_link_to_path("mantle:///\\evil.example"), None);
        assert_eq!(deep_link_to_path("https://n/abc"), None);
        assert_eq!(deep_link_to_path("not a url"), None);
    }

    #[test]
    fn in_app_url_stays_on_the_renderer_origin() {
        let ui = "mantle-ui://localhost/";
        assert_eq!(
            in_app_url("/n/abc", ui).as_deref(),
            Some("mantle-ui://localhost/n/abc")
        );
        assert_eq!(in_app_url("//evil.example/x", ui), None);
        assert_eq!(in_app_url("https://evil.example/", ui), None);
        assert_eq!(in_app_url("mantle-ui://localhost:9/x", ui), None);
    }
}
