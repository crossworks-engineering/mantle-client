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

/// What a window does with a navigation: let it happen, or not. The
/// navigation handlers never open anything outside the app: wry asks them for
/// every frame's navigations alike, before the CSP's frame-src is checked and
/// with no user gesture required, so an "open it in the browser" answer here
/// would let any frame open browser tabs or prefilled mail drafts at will.
/// Outside opens happen only from a new-window request (on_new_window), which
/// WebKit's popup blocker ties to a user gesture.
#[derive(Debug, PartialEq, Eq)]
pub enum Navigation {
    Allow,
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
/// frames, so it is allowed, and so are about:blank, about:srcdoc and a
/// blob: of the UI or the brain. Which sub-frames may load at all is the
/// CSP's frame-src (the brain, self and blob:). A MAIN frame that commits to
/// anything but the UI is sent back to the UI (windows.rs, on_page_load), and
/// gets nothing from the shell meanwhile: the page API is defined only on the
/// UI origin, and the vault answers only a window showing it.
///
/// Everything else is refused, Tauri's own `tauri://localhost` included. A
/// plain link the user clicks in the main frame that leads off the UI does
/// reach this handler, as a navigation of the main frame, unless the page
/// script turned it into a new-window request first (windows.rs,
/// page_api_script); that request is what opens it outside.
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
    Navigation::Refuse
}

/// The connect window goes nowhere but its own page.
pub fn connect_navigation(url: &Url) -> Navigation {
    if is_connect_url(url) {
        Navigation::Allow
    } else {
        Navigation::Refuse
    }
}

/// The keychain notice's two pages (connect/notice*.html), and where its OK
/// button goes: a plain form, no script, so OK is a navigation.
pub const NOTICE_PAGES: [&str; 2] = ["/notice.html", "/notice-failed.html"];
pub const NOTICE_OK_PATH: &str = "/notice-ok";

/// What the notice window does with a navigation. Like the others it never
/// opens anything outside; its one extra answer is to close itself, which is
/// what its OK button asks for.
#[derive(Debug, PartialEq, Eq)]
pub enum NoticeNavigation {
    Allow,
    Close,
    Refuse,
}

/// The notice window shows its own two pages and nothing else; OK closes it.
pub fn notice_navigation(url: &Url) -> NoticeNavigation {
    if !is_connect_url(url) || url.fragment().is_some() {
        return NoticeNavigation::Refuse;
    }
    match url.path() {
        // The form's GET adds an empty query: any query is the same OK.
        NOTICE_OK_PATH => NoticeNavigation::Close,
        path if NOTICE_PAGES.contains(&path) && url.query().is_none() => NoticeNavigation::Allow,
        _ => NoticeNavigation::Refuse,
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

/// A company sign-in's way back to the shell, parsed (brain
/// docs/oidc-sign-in.md).
#[derive(Debug, PartialEq, Eq)]
pub struct OidcDeepLink {
    pub iss: String,
    pub fragment: String,
}

fn oidc_result_ok(result: &str) -> bool {
    (1..=32).contains(&result.len()) && result.bytes().all(|b| b.is_ascii_lowercase() || b == b'-')
}

fn oidc_code_ok(code: &str) -> bool {
    (1..=128).contains(&code.len())
        && code
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// `mantle://oidc#oidc=...&iss=...`, or None for anything else. Any app can
/// open a `mantle://` link, so only what the flow's end can hold is taken,
/// rebuilt from its parts: what reaches the page is exactly these fields. The
/// page then refuses a code it is not waiting for, and a code is worth nothing
/// without its verifier. Port of oidcDeepLink in brain-fence.ts.
pub fn oidc_deep_link(link: &str) -> Option<OidcDeepLink> {
    let url = Url::parse(link).ok()?;
    if url.scheme() != "mantle" || url.host_str() != Some("oidc") || url.port().is_some() {
        return None;
    }
    if !matches!(url.path(), "" | "/") || url.query().is_some() {
        return None;
    }
    let pairs: Vec<(String, String)> =
        url::form_urlencoded::parse(url.fragment().unwrap_or("").as_bytes())
            .into_owned()
            .collect();
    let get = |key: &str| {
        pairs
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
            .filter(|v| !v.is_empty())
    };
    let result = get("oidc").filter(|r| oidc_result_ok(r))?;
    let iss_url = Url::parse(get("iss")?).ok()?;
    if !matches!(iss_url.scheme(), "http" | "https") {
        return None;
    }
    let iss = iss_url.origin().ascii_serialization();
    let mut out = url::form_urlencoded::Serializer::new(String::new());
    out.append_pair("oidc", result);
    if result == "code" {
        let code = get("code").filter(|c| oidc_code_ok(c))?;
        let purpose = get("purpose").filter(|p| matches!(*p, "signin" | "link" | "fresh"))?;
        out.append_pair("code", code);
        out.append_pair("purpose", purpose);
    }
    out.append_pair("iss", &iss);
    Some(OidcDeepLink {
        iss,
        fragment: out.finish(),
    })
}

/// How long a brain window waits for a company sign-in it sent out.
pub const OIDC_ARMED_MS: u64 = 15 * 60_000;

/// The profile whose window a `mantle://oidc` link goes to, or None to drop it
/// with no window moved. Any app can open such a link, so only a window that
/// sent a sign-in out to the browser takes one: the one for the brain the link
/// names, else the last that went out, whose page sees that the brain differs
/// and spends nothing. `armed`: (profile id, its origin, when its wait ends).
/// Port of oidcArrivalProfile in brain-fence.ts.
pub fn oidc_arrival_profile(
    armed: &[(String, String, u64)],
    iss: &str,
    now: u64,
) -> Option<String> {
    let live: Vec<&(String, String, u64)> = armed.iter().filter(|a| a.2 > now).collect();
    live.iter()
        .find(|a| a.1 == iss)
        .or_else(|| live.iter().max_by_key(|a| a.2))
        .map(|a| a.0.clone())
}

/// `raw`, parsed, when it starts a company sign-in on this window's brain, the
/// only URL the page may ask the shell to open this way. Exactly the brain's
/// origin and the start path. Port of oidcStartUrl in brain-fence.ts.
pub fn oidc_start_url(raw: &str, brain_origin: &str) -> Option<Url> {
    if raw.len() > 4096 {
        return None;
    }
    let url = Url::parse(raw).ok()?;
    (url.origin().ascii_serialization() == brain_origin && url.path() == "/api/auth/oidc/start")
        .then_some(url)
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
        // Never opened outside from here: refused, whatever the scheme.
        let refuse = [
            "https://evil.example/",
            "http://brain.example/",
            "https://brain.example:8443/",
            "mailto:a@b.example?subject=x&body=y",
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
    fn the_notice_shows_its_own_pages_and_its_ok_closes_it() {
        for page in NOTICE_PAGES {
            assert_eq!(
                notice_navigation(&url(&format!("mantle-connect://localhost{page}"))),
                NoticeNavigation::Allow,
                "{page}"
            );
        }
        for ok in [
            "mantle-connect://localhost/notice-ok",
            "mantle-connect://localhost/notice-ok?",
        ] {
            assert_eq!(notice_navigation(&url(ok)), NoticeNavigation::Close, "{ok}");
        }
        for refused in [
            "mantle-connect://localhost/",
            "mantle-connect://localhost/index.html",
            "mantle-connect://localhost/notice.css",
            "mantle-connect://localhost/notice.html?x=1",
            "mantle-connect://localhost/notice.html#x",
            "mantle-connect://localhost:1/notice-ok",
            "mantle-connect://other/notice-ok",
            "mantle-ui://localhost/notice-ok",
            "mantle-ui://localhost/",
            "https://x.example/notice-ok",
            "mailto:a@b.example",
            "about:blank",
        ] {
            assert_eq!(
                notice_navigation(&url(refused)),
                NoticeNavigation::Refuse,
                "{refused}"
            );
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
            Navigation::Refuse
        );
        assert_eq!(
            connect_navigation(&url("mailto:a@b.example")),
            Navigation::Refuse
        );
    }

    #[test]
    fn oidc_deep_link_takes_a_code_a_purpose_and_the_brain_and_nothing_else() {
        let iss = "https%3A%2F%2Fbrain.example";
        assert_eq!(
            oidc_deep_link(&format!(
                "mantle://oidc#oidc=code&code=abc_-1&purpose=signin&iss={iss}&evil=1"
            )),
            Some(OidcDeepLink {
                iss: "https://brain.example".into(),
                fragment: format!("oidc=code&code=abc_-1&purpose=signin&iss={iss}"),
            })
        );
        // A flow that stopped: no code rides along.
        assert_eq!(
            oidc_deep_link(&format!("mantle://oidc#oidc=cancelled&code=x&iss={iss}")),
            Some(OidcDeepLink {
                iss: "https://brain.example".into(),
                fragment: format!("oidc=cancelled&iss={iss}"),
            })
        );
        // The brain as an origin: no path or query reaches the page.
        assert_eq!(
            oidc_deep_link("mantle://oidc#oidc=failed&iss=https%3A%2F%2Fbrain.example%2Fx%3Fy%3D1")
                .map(|l| l.iss),
            Some("https://brain.example".to_string())
        );
    }

    #[test]
    fn oidc_deep_link_refuses_anything_that_is_not_the_flows_end() {
        let iss = "https%3A%2F%2Fbrain.example";
        for link in [
            "mantle://n/abc".to_string(),
            "mantle://oidc".to_string(),
            "mantle://oidc#oidc=code".to_string(),
            format!("mantle://oidc/more#oidc=failed&iss={iss}"),
            format!("mantle://oidc?x=1#oidc=failed&iss={iss}"),
            format!("mantle://other#oidc=failed&iss={iss}"),
            format!("https://oidc#oidc=failed&iss={iss}"),
            format!("mantle://oidc#oidc=code&code=abc&purpose=other&iss={iss}"),
            format!("mantle://oidc#oidc=code&code=a%20b&purpose=link&iss={iss}"),
            format!("mantle://oidc#oidc=code&purpose=link&iss={iss}"),
            format!("mantle://oidc#oidc=%3Cb%3E&iss={iss}"),
            "mantle://oidc#oidc=failed".to_string(),
            "mantle://oidc#oidc=failed&iss=javascript:alert(1)".to_string(),
            "mantle://oidc#oidc=failed&iss=not%20a%20url".to_string(),
            "not a link".to_string(),
        ] {
            assert_eq!(oidc_deep_link(&link), None, "{link}");
        }
    }

    #[test]
    fn oidc_arrival_goes_only_to_a_window_that_waits() {
        let a = "https://a.example";
        let b = "https://b.example";
        let armed = |id: &str, origin: &str, until| (id.to_string(), origin.to_string(), until);
        // No window sent a sign-in out, or the wait is over: dropped.
        assert_eq!(oidc_arrival_profile(&[], a, 10), None);
        assert_eq!(oidc_arrival_profile(&[armed("a", a, 10)], a, 10), None);
        let both = [armed("a", a, 100), armed("b", b, 200)];
        // The brain the link names, if it waits.
        assert_eq!(oidc_arrival_profile(&both, a, 10).as_deref(), Some("a"));
        // Else the last that went out, whose page refuses it.
        assert_eq!(
            oidc_arrival_profile(&both, "https://alias.example", 10).as_deref(),
            Some("b")
        );
        // A named brain that is not waiting is not woken.
        assert_eq!(
            oidc_arrival_profile(&[armed("a", a, 100)], b, 10).as_deref(),
            Some("a")
        );
    }

    #[test]
    fn oidc_start_url_takes_this_brains_start_path_only() {
        let brain = "https://brain.example";
        let good = format!("{brain}/api/auth/oidc/start?ticket=abc");
        assert_eq!(
            oidc_start_url(&good, brain).map(|u| u.to_string()),
            Some(good)
        );
        for raw in [
            "https://evil.example/api/auth/oidc/start".to_string(),
            format!("{brain}/api/auth/oidc/callback"),
            format!("{brain}.evil.example/api/auth/oidc/start"),
            "file:///etc/passwd".to_string(),
            "mantle://oidc".to_string(),
            "/api/auth/oidc/start".to_string(),
            String::new(),
            format!("{brain}/api/auth/oidc/start?x={}", "a".repeat(5000)),
        ] {
            assert_eq!(oidc_start_url(&raw, brain), None, "{raw}");
        }
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
