//! The windows: one per brain, each on its own data store, the connect
//! window and the keychain notice; the app menu that switches between brains.

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use url::Url;

use crate::fence::{self, Navigation, NoticeNavigation, OidcDeepLink, UI_ORIGIN};
use crate::profiles::{label_for, Profile};
use crate::shell::{connect_root, ui_root, Shell, CONNECT_LABEL, NOTICE_LABEL};
use crate::vault::Unavailable;

pub const MENU_ADD_REMOVE: &str = "add-remove";
pub const MENU_BRAIN_PREFIX: &str = "brain:";

/// Hand a URL to the OS (the browser, the mail app): http, https and mailto
/// only, checked here whatever the caller already checked.
pub fn open_outside<R: Runtime>(app: &AppHandle<R>, url: &Url) -> bool {
    if !fence::may_open_outside(url) {
        return false;
    }
    // The plugin's own JS commands are granted to no window: only this
    // Rust side opens anything.
    app.try_state::<tauri_plugin_opener::Opener<R>>()
        .is_some_and(|opener| opener.open_url(url.as_str(), None::<&str>).is_ok())
}

fn reveal<R: Runtime>(win: &WebviewWindow<R>) {
    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_focus();
}

/// `window.mantleDesktop` on a brain window's page, with Electron's
/// synchronous `tokenVault` (client/desktop/src/preload/app.ts). Each method
/// is one synchronous XMLHttpRequest to the UI scheme's `/_mantle/vault`
/// (vault_endpoint.rs), so every read asks the keychain and the page holds
/// no copy. The main frame only, and only on the UI origin: a brain's frames
/// never see it, and neither does a brain page the main frame was somehow
/// taken to (the endpoint refuses both anyway).
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
  var XHR = window.XMLHttpRequest;
  var stringify = JSON.stringify;
  var parse = JSON.parse;
  // One synchronous call. A refusal, an error or anything unexpected reads
  // as null: the page then sees no bearer, which is the truth it can act on.
  function call(op, args) {{
    var body = {{ op: op }};
    if (args) for (var k in args) if (Object.prototype.hasOwnProperty.call(args, k)) body[k] = args[k];
    try {{
      var xhr = new XHR();
      xhr.open('POST', 'mantle-ui://localhost/_mantle/vault', false);
      xhr.setRequestHeader('X-Mantle-Vault', '1');
      xhr.send(stringify(body));
      if (xhr.status !== 200) return null;
      var value = parse(xhr.responseText).value;
      return typeof value === 'string' ? value : null;
    }} catch (e) {{
      return null;
    }}
  }}
  var vault = Object.freeze({{
    get: function () {{ return call('get'); }},
    set: function (token) {{ call('set', {{ token: token }}); }},
    clear: function () {{ call('clear'); }},
    getFor: function (sessionId) {{ return call('getFor', {{ sessionId: sessionId }}); }},
    setFor: function (sessionId, token) {{ call('setFor', {{ sessionId: sessionId, token: token }}); }},
    clearFor: function (sessionId) {{ call('clearFor', {{ sessionId: sessionId }}); }},
    adopt: function (sessionId) {{ return call('adopt', {{ sessionId: sessionId }}); }},
    keepOnly: function (sessionIds, strayBearers) {{
      call('keepOnly', {{ sessionIds: sessionIds, strayBearers: strayBearers }});
    }}
  }});
  // Notifications and the dock badge come in T2. The page's type names
  // them, so they are here, and do nothing yet.
  var api = Object.freeze({{
    platform: {platform:?},
    tokenVault: vault,
    notify: function () {{}},
    setBadge: function () {{}},
    oidc: Object.freeze({{
      open: function (url) {{ return Promise.resolve(call('oidcOpen', {{ url: url }}) === '1'); }}
    }})
  }});
  Object.defineProperty(window, 'mantleDesktop', {{ value: api, writable: false, configurable: false }});

  // A plain link off the UI (the Microsoft sign-in link points at the
  // brain) opens outside, as Electron's will-navigate did, by way of a
  // new-window request: the navigation handler never opens anything
  // outside (fence.rs), and a new window is tied to this click. Runs after
  // the page's handlers (bubble phase, on document), and leaves alone what
  // they handled, other targets and downloads.
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
pub fn build_brain_window<R: Runtime>(
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
            let _ = open_outside(&new_app, &url);
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
        let win = build_brain_window(app, &profile)?;
        if !keep_if_listed(app, win, &profile.id) {
            return Err("Unknown brain. Refresh the list.".into());
        }
        shell.trace(|| format!("window {} opened at {}", label_for(&profile.id), ui_root()));
    }
    shell.set_front(Some(profile.id.clone()));
    rebuild_menu(app);
    Ok(())
}

/// A company sign-in came back as `mantle://oidc`. It goes to a window that
/// sent one out, on the page the web app ends on (/auth/oidc), which compares
/// the brain again and holds the verifier. Any other link moves nothing: any
/// app can open a `mantle://` link (fence.rs oidc_arrival_profile).
pub fn deliver_oidc<R: Runtime>(app: &AppHandle<R>, link: &OidcDeepLink) {
    let Ok(target) = Url::parse(&format!("{UI_ORIGIN}/auth/oidc#{}", link.fragment)) else {
        return;
    };
    let shell = app.state::<Shell>();
    let Some(id) = shell.take_oidc_arrival(&link.iss, crate::profiles::now_ms()) else {
        return;
    };
    if let Some(win) = app.get_webview_window(&label_for(&id)) {
        reveal(&win);
        let _ = win.navigate(target);
    }
}

/// A brain window that was just built, checked against the list again: the
/// list was read under `edits`, but the window is built after that lock is
/// released, and a removal (commands.rs) may have come in between. It then
/// found no window to close, and removed the store before this window made
/// it again. Asked under `edits`, so a removal after this answer finds the
/// window. A window for a brain gone meanwhile is destroyed, and the brain
/// listed in pending-removals.json: the store it made is removed at the next
/// start (it is in use until the window is gone, and on macOS WebKit's store
/// calls need the main thread, so none is made here). Its page has no vault
/// meanwhile: the vault asks the list too. The window is destroyed with the
/// lock released, since destroying it from another thread waits on the main
/// thread, which may be waiting for `edits`.
pub fn keep_if_listed<R: Runtime>(
    app: &AppHandle<R>,
    win: WebviewWindow<R>,
    profile_id: &str,
) -> bool {
    let shell = app.state::<Shell>();
    {
        let _edit = shell.edits.lock().unwrap_or_else(|e| e.into_inner());
        if shell.profiles.find(profile_id).is_some() {
            return true;
        }
        list_pending_removal(&shell, profile_id.to_string());
    }
    let label = win.label().to_string();
    let _ = win.destroy();
    shell.unregister_window(&label);
    eprintln!("[mantle-desktop] {label}: its brain was removed while it opened; closed");
    false
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
    .title("MantleOS")
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

/// The keychain notice's page and title, per reason. The text is the page's
/// own, fixed (connect/notice*.html); this line also goes to stderr, so a
/// run from a terminal says the same.
pub fn notice_page(why: Unavailable) -> (&'static str, &'static str, &'static str) {
    match why {
        Unavailable::NoKeychain => (
            fence::NOTICE_PAGES[0],
            "Logins last until you quit",
            "no keychain; a login is kept in memory until the app quits, never on disk",
        ),
        Unavailable::KeychainFailed => (
            fence::NOTICE_PAGES[1],
            "A login was not saved",
            "the keychain refused a request; a login may not have been kept",
        ),
    }
}

/// The keychain notice: a small window of its own, NOT modal (nothing waits
/// on it, no nested run loop), on the connect scheme with fixed text and no
/// script. It is granted no command (capabilities/ name only the connect
/// window). OK is a form that goes to /notice-ok, which this window's
/// navigation handler turns into a close: window.close() does nothing in
/// wry on macOS, and on Linux it would take the webview out of its window.
/// Called on the main thread, once per run (the vault's `told`), never from
/// under the vault's lock.
pub fn open_notice<R: Runtime>(app: &AppHandle<R>, why: Unavailable) {
    let (page, title, line) = notice_page(why);
    eprintln!("[mantle-desktop] {title}: {line}");
    if let Some(win) = app.get_webview_window(NOTICE_LABEL) {
        reveal(&win);
        return;
    }
    let Ok(url) = connect_root().join(page) else {
        return;
    };
    let closer = app.clone();
    let built = WebviewWindowBuilder::new(app, NOTICE_LABEL, WebviewUrl::CustomProtocol(url))
        .title(title)
        .inner_size(460.0, 250.0)
        .resizable(false)
        .minimizable(false)
        .maximizable(false)
        .always_on_top(true)
        .center()
        // Keeps nothing, and shares no storage with a brain.
        .incognito(true)
        .disable_drag_drop_handler()
        .on_navigation(move |url| match fence::notice_navigation(url) {
            NoticeNavigation::Allow => true,
            NoticeNavigation::Close => {
                // From a task, not from inside WebKit's policy callback.
                let app = closer.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(win) = app.get_webview_window(NOTICE_LABEL) {
                        let _ = win.close();
                    }
                });
                false
            }
            NoticeNavigation::Refuse => false,
        })
        .on_new_window(|_url, _features| NewWindowResponse::Deny)
        .build();
    if let Err(error) = built {
        eprintln!("[mantle-desktop] notice: {error}");
    }
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
        crate::dialog::alert("MantleOS", &error);
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
        crate::dialog::alert("MantleOS", &error);
    }
}

/// Removes what a removed brain kept in WebKit: its data store (macOS) or
/// its folder. A store still in use cannot go yet, and neither can logins
/// the keychain would not delete (`logins_gone` false, from
/// Vault::remove_profile): the brain is then listed and both are retried at
/// the next start (retry_removals). Only ever adds to the list: a window
/// built for this brain while it was being removed (open_brain) may have
/// listed it already, for a store made after this one went. Called from an
/// async command, off the main thread: see retry_removals for why that
/// matters.
pub async fn remove_brain_store<R: Runtime>(
    app: AppHandle<R>,
    profile_id: String,
    logins_gone: bool,
) {
    let removed = remove_store_now(&app, &profile_id).await;
    if !(removed && logins_gone) {
        list_pending_removal(&app.state::<Shell>(), profile_id);
    }
}

/// Lists a brain for the start's retry, once.
fn list_pending_removal(shell: &Shell, profile_id: String) {
    shell.update_pending_removals(|pending| {
        if !pending.contains(&profile_id) {
            pending.push(profile_id);
        }
    });
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

/// At start: finish the removals an earlier run could not: the logins the
/// keychain would not delete, then the store. Started
/// from setup as a task, NEVER awaited there (no block_on): on macOS both
/// WebKit calls (fetchAllDataStoreIdentifiers, removeDataStoreForIdentifier)
/// are queued to the main thread and answer on its run loop, so a main
/// thread that waits for them waits forever, and the app would hang before
/// its first window on every start after a removal that had to wait. Nothing
/// needs it done first: a removed brain is not listed, so no window opens on
/// its store meanwhile. Each id leaves the list on its own, so a removal
/// made while this runs is kept.
pub fn start_retry_removals<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    tauri::async_runtime::spawn(retry_removals(app));
}

async fn retry_removals<R: Runtime>(app: AppHandle<R>) {
    let pending = app.state::<Shell>().pending_removals();
    for id in pending {
        let still_listed = app.state::<Shell>().profiles.find(&id).is_some();
        let done = still_listed || {
            // The keychain calls block (an unlock prompt can hold them), so
            // on a blocking thread, not this task's.
            let vault_app = app.clone();
            let vault_id = id.clone();
            let logins_gone = tauri::async_runtime::spawn_blocking(move || {
                vault_app.state::<Shell>().vault.remove_profile(&vault_id)
            })
            .await
            .unwrap_or(false);
            // The store even when the logins are not done: each step is
            // safe to repeat, and the id stays listed until both are.
            let store_gone = remove_store_now(&app, &id).await;
            logins_gone && store_gone
        };
        if done {
            app.state::<Shell>()
                .update_pending_removals(|left| left.retain(|x| x != &id));
        }
    }
}
