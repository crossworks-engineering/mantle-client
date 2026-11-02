//! The windows: one per brain, each on its own data store, and the connect
//! window; the app menu that switches between brains.

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use url::Url;

use crate::fence::{self, Navigation};
use crate::profiles::{label_for, Profile};
use crate::shell::{connect_root, ui_root, Shell, CONNECT_LABEL};

pub const MENU_ADD_REMOVE: &str = "add-remove";
pub const MENU_BRAIN_PREFIX: &str = "brain:";

/// Hand a URL to the OS (the browser, the mail app): http, https and mailto
/// only, checked here whatever the caller already checked.
pub fn open_outside<R: Runtime>(app: &AppHandle<R>, url: &Url) {
    if !fence::may_open_outside(url) {
        return;
    }
    // The plugin's own JS commands are granted to no window: only this
    // Rust side opens anything.
    if let Some(opener) = app.try_state::<tauri_plugin_opener::Opener<R>>() {
        let _ = opener.open_url(url.as_str(), None::<&str>);
    }
}

fn reveal<R: Runtime>(win: &WebviewWindow<R>) {
    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_focus();
}

/// `window.mantleDesktop` on a brain window's page: the async vault, served
/// by the vault commands (commands.rs). The main frame only, and only on the
/// UI origin: a brain's frames never see it, and neither does a brain page
/// the main frame was somehow taken to. No synchronous `tokenVault`: this
/// shell cannot answer synchronously, and the page knows to load once
/// (packages/web-ui desktop-vault.ts).
pub fn page_api_script() -> String {
    let platform = if cfg!(target_os = "macos") {
        "darwin"
    } else {
        std::env::consts::OS
    };
    format!(
        r#"(function () {{
  if (window.top !== window) return;
  if (window.location.protocol !== 'mantle-ui:' || window.location.host !== 'localhost') return;
  var captured = window.__TAURI_INTERNALS__;
  function invoke(cmd, args) {{
    var tauri = captured || window.__TAURI_INTERNALS__;
    if (!tauri) return Promise.reject(new Error('The desktop shell is not ready.'));
    return tauri.invoke(cmd, args);
  }}
  var vault = Object.freeze({{
    load: function () {{ return invoke('vault_load'); }},
    setFor: function (sessionId, token) {{
      return invoke('vault_set_for', {{ sessionId: sessionId, token: token }}).then(function () {{}});
    }},
    clearFor: function (sessionId) {{
      return invoke('vault_clear_for', {{ sessionId: sessionId }}).then(function () {{}});
    }},
    keepOnly: function (sessionIds, strayBearers) {{
      return invoke('vault_keep_only', {{ sessionIds: sessionIds, strayBearers: strayBearers }}).then(function () {{}});
    }}
  }});
  // Notifications and the dock badge come in T2. The page's type names
  // them, so they are here, and do nothing yet.
  var api = Object.freeze({{
    platform: {platform:?},
    notify: function () {{}},
    setBadge: function () {{}},
    tokenVaultAsync: vault
  }});
  Object.defineProperty(window, 'mantleDesktop', {{ value: api, writable: false, configurable: false }});

  // A plain link off the UI (the Microsoft sign-in link points at the
  // brain) opens outside, as Electron's will-navigate did. The navigation
  // handler cannot do this itself: wry asks it for sub-frames too, without
  // saying which, so it must let the brain origin through for the brain's
  // own frames. Runs after the page's handlers (bubble phase, on document),
  // and leaves alone what they handled, other targets and downloads.
  document.addEventListener('click', function (event) {{
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var el = event.target;
    var link = el && el.closest ? el.closest('a[href]') : null;
    if (!link || typeof link.href !== 'string') return;
    if (link.target && link.target !== '_self') return;
    if (link.hasAttribute('download')) return;
    var url;
    try {{ url = new URL(link.href, window.location.href); }} catch (e) {{ return; }}
    if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'mailto:') return;
    event.preventDefault();
    window.open(url.href, '_blank', 'noopener');
  }});
}})();"#
    )
}

/// The data store a brain window lives in. macOS: WebKit's own store for an
/// identifier (the profile id's 16 bytes; macOS 14 and later, checked at
/// start). Elsewhere: its own folder.
#[cfg(target_os = "macos")]
pub fn store_id(profile_id: &str) -> Result<[u8; 16], String> {
    uuid::Uuid::parse_str(profile_id)
        .map(|u| u.into_bytes())
        .map_err(|e| e.to_string())
}

#[cfg(not(target_os = "macos"))]
pub fn brain_data_dir<R: Runtime>(
    app: &AppHandle<R>,
    profile_id: &str,
) -> Result<std::path::PathBuf, String> {
    Ok(app
        .state::<Shell>()
        .data_dir
        .join("brains")
        .join(profile_id))
}

/// Loads the UI's root in a brain window whose main frame left it. Sent from
/// a task, not from inside the page-load callback WebKit is running.
fn send_back_to_ui<R: Runtime>(webview: WebviewWindow<R>) {
    let label = webview.label().to_string();
    tauri::async_runtime::spawn(async move {
        let _ = webview.navigate(ui_root());
    });
    eprintln!("[mantle-desktop] {label}: the main frame left the UI; sent back");
}

/// The ONE function that builds a brain window.
fn build_brain_window<R: Runtime>(
    app: &AppHandle<R>,
    profile: &Profile,
) -> Result<WebviewWindow<R>, String> {
    let shell = app.state::<Shell>();
    let label = label_for(&profile.id);
    shell.register_window(&label, &profile.origin);

    let brain = profile.origin.clone();
    let new_app = app.clone();
    let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::CustomProtocol(ui_root()))
        .title(&profile.name)
        .inner_size(1440.0, 920.0)
        .min_inner_size(640.0, 480.0)
        // The page takes its own file drops (the upload dock); Tauri's
        // handler would swallow them for an event nothing listens to.
        .disable_drag_drop_handler()
        .initialization_script(page_api_script())
        // Allow or refuse, never open outside: wry asks this for every
        // frame (fence.rs, brain_navigation).
        .on_navigation(move |url| fence::brain_navigation(url, &brain) == Navigation::Allow)
        // The main frame stays on the UI. Allowing the brain origin above is
        // for its frames; a main frame that commits anywhere else (a form
        // posted to the brain, a script assigning location) is sent back.
        // Started is the commit, and it is the main frame's alone, on both
        // platforms.
        .on_page_load(|webview, payload| {
            if payload.event() == PageLoadEvent::Started && !fence::is_ui_url(payload.url()) {
                send_back_to_ui(webview);
            }
        })
        // A popup the page asked for, tied by WebKit to a user gesture: the
        // only way anything is opened outside.
        .on_new_window(move |url, _features| {
            open_outside(&new_app, &url);
            NewWindowResponse::Deny
        })
        // The page names itself after its brain; the window list follows.
        .on_document_title_changed(|win, title| {
            let _ = win.set_title(&title);
        });

    #[cfg(target_os = "macos")]
    let builder = builder.data_store_identifier(store_id(&profile.id)?);
    #[cfg(not(target_os = "macos"))]
    let builder = builder.data_directory(brain_data_dir(app, &profile.id)?);

    builder.build().map_err(|e| {
        shell.unregister_window(&label);
        e.to_string()
    })
}

/// Go to a brain: its window if it has one (one window per brain), a new one
/// on `/` if not.
pub fn open_brain<R: Runtime>(app: &AppHandle<R>, profile_id: &str) -> Result<(), String> {
    let shell = app.state::<Shell>();
    let profile = {
        let _edit = shell.edits.lock().unwrap_or_else(|e| e.into_inner());
        let profile = shell
            .profiles
            .find(profile_id)
            .ok_or("Unknown brain. Refresh the list.")?;
        let _ = shell.profiles.touch(profile_id);
        profile
    };
    if let Some(win) = app.get_webview_window(&label_for(&profile.id)) {
        reveal(&win);
    } else {
        build_brain_window(app, &profile)?;
        shell.trace(|| format!("window {} opened at {}", label_for(&profile.id), ui_root()));
    }
    shell.set_front(Some(profile.id.clone()));
    rebuild_menu(app);
    Ok(())
}

pub fn open_connect<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(CONNECT_LABEL) {
        reveal(&win);
        return Ok(());
    }
    let new_app = app.clone();
    WebviewWindowBuilder::new(
        app,
        CONNECT_LABEL,
        WebviewUrl::CustomProtocol(connect_root()),
    )
    .title("MantleOS Desktop")
    .inner_size(480.0, 640.0)
    .resizable(false)
    // The connect page keeps nothing, and shares no storage with a brain.
    .incognito(true)
    .disable_drag_drop_handler()
    .on_navigation(|url| fence::connect_navigation(url) == Navigation::Allow)
    .on_new_window(move |url, _features| {
        open_outside(&new_app, &url);
        NewWindowResponse::Deny
    })
    .build()
    .map_err(|e| e.to_string())?;
    app.state::<Shell>()
        .trace(|| format!("window {CONNECT_LABEL} opened at {}", connect_root()));
    Ok(())
}

/// The window to show when the app is asked for one: the last-used brain,
/// else the connect window.
pub fn focus_or_open<R: Runtime>(app: &AppHandle<R>) {
    let shell = app.state::<Shell>();
    if let Some(front) = shell.front() {
        if let Some(win) = app.get_webview_window(&label_for(&front)) {
            reveal(&win);
            return;
        }
    }
    let opened = match shell.profiles.last_used() {
        Some(profile) => open_brain(app, &profile.id),
        None => open_connect(app),
    };
    if let Err(error) = opened {
        crate::dialog::alert("MantleOS Desktop", &error);
        let _ = open_connect(app);
    }
}

/// The app menu: the standard one, plus a Brain menu with one item per brain
/// (a check on the one in front) and the way to add or remove one. Rebuilt
/// whenever brains change or another brain comes to the front: the list in
/// it is a snapshot.
pub fn rebuild_menu<R: Runtime>(app: &AppHandle<R>) {
    let build = || -> tauri::Result<Menu<R>> {
        let shell = app.state::<Shell>();
        let front = shell.front();
        let mut brains = shell.profiles.load();
        brains.sort_by_key(|b| std::cmp::Reverse(b.last_used_at));
        let submenu = Submenu::new(app, "Brain", true)?;
        for brain in &brains {
            let item = CheckMenuItem::with_id(
                app,
                format!("{MENU_BRAIN_PREFIX}{}", brain.id),
                &brain.name,
                true,
                front.as_deref() == Some(brain.id.as_str()),
                None::<&str>,
            )?;
            submenu.append(&item)?;
        }
        if !brains.is_empty() {
            submenu.append(&PredefinedMenuItem::separator(app)?)?;
        }
        submenu.append(&MenuItem::with_id(
            app,
            MENU_ADD_REMOVE,
            "Add or Remove a Brain…",
            true,
            Some("CmdOrCtrl+Shift+B"),
        )?)?;
        let menu = Menu::default(app)?;
        menu.append(&submenu)?;
        Ok(menu)
    };
    match build() {
        Ok(menu) => {
            let _ = app.set_menu(menu);
        }
        Err(error) => eprintln!("[mantle-desktop] menu: {error}"),
    }
}

/// A menu click.
pub fn on_menu<R: Runtime>(app: &AppHandle<R>, id: &str) {
    let result = if id == MENU_ADD_REMOVE {
        open_connect(app)
    } else if let Some(profile_id) = id.strip_prefix(MENU_BRAIN_PREFIX) {
        open_brain(app, profile_id)
    } else {
        return;
    };
    if let Err(error) = result {
        crate::dialog::alert("MantleOS Desktop", &error);
    }
}

/// Removes what a removed brain kept in WebKit: its data store (macOS) or
/// its folder. A store still in use cannot go yet; it is listed and retried
/// at the next start, before any window opens.
pub async fn remove_brain_store<R: Runtime>(app: AppHandle<R>, profile_id: String) {
    let removed = remove_store_now(&app, &profile_id).await;
    let shell = app.state::<Shell>();
    let mut pending = shell.pending_removals();
    pending.retain(|id| id != &profile_id);
    if !removed {
        pending.push(profile_id);
    }
    shell.set_pending_removals(&pending);
}

async fn remove_store_now<R: Runtime>(app: &AppHandle<R>, profile_id: &str) -> bool {
    #[cfg(target_os = "macos")]
    {
        let Ok(id) = store_id(profile_id) else {
            return true;
        };
        match app.fetch_data_store_identifiers().await {
            Ok(ids) if !ids.contains(&id) => return true,
            _ => {}
        }
        app.remove_data_store(id).await.is_ok()
    }
    #[cfg(not(target_os = "macos"))]
    {
        let Ok(dir) = brain_data_dir(app, profile_id) else {
            return true;
        };
        match std::fs::remove_dir_all(&dir) {
            Ok(()) => true,
            Err(e) => e.kind() == std::io::ErrorKind::NotFound,
        }
    }
}

/// At start: finish removing the stores an earlier run could not.
pub async fn retry_removals<R: Runtime>(app: AppHandle<R>) {
    let pending = app.state::<Shell>().pending_removals();
    let mut left = Vec::new();
    for id in pending {
        let still_listed = app.state::<Shell>().profiles.find(&id).is_some();
        if !still_listed && !remove_store_now(&app, &id).await {
            left.push(id);
        }
    }
    app.state::<Shell>().set_pending_removals(&left);
}
