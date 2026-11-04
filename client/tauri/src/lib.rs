//! MantleOS on Tauri (T1): the static owner UI, one window per
//! brain, each on its own WebKit data store, logins in the OS keychain.
//!
//!   fence.rs     where a window may go; which addresses a brain may have
//!   host.rs      the UI host for one brain (the host contract, in Rust)
//!   net.rs       the shell's own two requests to a brain
//!   profiles.rs  profiles.json
//!   vault.rs     the keychain-backed token vault
//!   vault_endpoint.rs  the page's synchronous way to it, on the UI scheme
//!   shell.rs     the app state and the two schemes
//!   windows.rs   brain windows, the connect window, the menu
//!   commands.rs  the IPC surface: the connect window's commands
//!   dialog.rs    the native alert, the macOS version check

pub mod commands;
pub mod dialog;
pub mod fence;
pub mod host;
pub mod net;
pub mod profiles;
pub mod shell;
pub mod vault;
pub mod vault_endpoint;
pub mod windows;

use std::borrow::Cow;

use tauri::utils::assets::{AssetKey, AssetsIter, CspHash};
#[cfg(target_os = "macos")]
use tauri::RunEvent;
use tauri::{Manager, Runtime, WindowEvent};

use tauri_plugin_deep_link::DeepLinkExt;

use crate::host::FileSource;
use crate::shell::Shell;

/// The static export, embedded at compile time (tauri.conf.json
/// frontendDist), looked up EXACTLY: one key, one file. Tauri's own lookup
/// (AssetResolver::get, which ends in AppManager::get_asset) falls back to
/// `<path>.html`, `<path>/index.html` and then to `index.html` for any
/// path, which would break the host contract's 404 and placeholder rules.
struct EmbeddedFiles<R: Runtime>(Box<dyn tauri::Assets<R>>);

impl<R: Runtime> FileSource for EmbeddedFiles<R> {
    fn read(&self, rel: &str) -> Option<Cow<'_, [u8]>> {
        if rel.is_empty() {
            return None;
        }
        self.0.get(&AssetKey::from(rel))
    }
}

/// What Tauri's own `tauri://localhost` serves: nothing. The export is taken
/// out of the context before the app is built and handed to the UI scheme,
/// so Tauri's protocol has no files and no index fallback; a brain window
/// may not navigate there anyway (fence.rs).
struct NoAssets;

impl<R: Runtime> tauri::Assets<R> for NoAssets {
    fn get(&self, _key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        None
    }
    fn iter(&self) -> Box<AssetsIter<'_>> {
        Box::new(std::iter::empty())
    }
    fn csp_hashes(&self, _html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        Box::new(std::iter::empty())
    }
}

/// The commands and the schemes, shared by the app and the ACL test.
pub fn configure<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
        .invoke_handler(tauri::generate_handler![
            commands::profiles_list,
            commands::profiles_add,
            commands::profiles_remove,
            commands::profiles_open,
        ])
        .register_asynchronous_uri_scheme_protocol(fence::UI_SCHEME, shell::serve_ui)
        .register_asynchronous_uri_scheme_protocol(fence::CONNECT_SCHEME, shell::serve_connect)
}

/// `mantle://oidc`: a company sign-in coming back (fence.rs oidc_deep_link).
/// Every other `mantle://` link is T2's. The rest of the plugin (its JS
/// commands) is granted to no window.
fn listen_for_deep_links<R: Runtime>(app: &tauri::App<R>) {
    let links = app.deep_link();
    // Linux has no bundle to name the scheme: it is registered at run time.
    #[cfg(target_os = "linux")]
    let _ = links.register("mantle");
    let deliver = |app: &tauri::AppHandle<R>, urls: Vec<url::Url>| {
        for url in urls {
            if let Some(link) = fence::oidc_deep_link(url.as_str()) {
                let handle = app.clone();
                // Windows are built on the main thread, queued from here.
                let _ = app.run_on_main_thread(move || windows::deliver_oidc(&handle, &link));
            }
        }
    };
    if let Ok(Some(urls)) = links.get_current() {
        deliver(app.handle(), urls);
    }
    let handle = app.handle().clone();
    links.on_open_url(move |event| deliver(&handle, event.urls()));
}

fn setup<R: Runtime>(
    app: &mut tauri::App<R>,
    files: Box<dyn FileSource>,
) -> Result<(), Box<dyn std::error::Error>> {
    // Below macOS 14 WebKit has no per-window data store, and wry quietly
    // gives every window the same one: every brain would share one storage.
    #[cfg(target_os = "macos")]
    if dialog::macos_major() < 14 {
        dialog::alert(
            "MantleOS needs macOS 14 or later",
            "This version of macOS cannot keep each brain's window apart from the others. Update macOS to Sonoma (14) or later.",
        );
        std::process::exit(1);
    }

    let handle = app.handle().clone();
    let config_dir = app.path().app_config_dir()?;
    let data_dir = app.path().app_data_dir()?;
    let identifier = app.config().identifier.clone();
    let notify = handle.clone();
    let shell = Shell::new(
        files,
        &identifier,
        &config_dir,
        &data_dir,
        vault::Vault::platform_store(),
        // Called by the vault once per run, never under its lock. The notice
        // window is built on the main thread, queued there from a task
        // (run_on_main_thread runs at once when called there, as from
        // setup), so it comes after setup and nothing waits on it.
        Box::new(move |why| {
            let app = notify.clone();
            tauri::async_runtime::spawn(async move {
                let main = app.clone();
                let _ = app.run_on_main_thread(move || windows::open_notice(&main, why));
            });
        }),
    );
    let shell = match shell {
        Ok(shell) => shell,
        Err(error) => {
            dialog::alert("MantleOS cannot start", &error);
            std::process::exit(1);
        }
    };
    app.manage(shell);

    // Stores an earlier run could not remove: in the background. Never
    // block_on here: setup runs on the main thread, inside the event loop,
    // and WebKit's store calls answer on that loop (windows.rs,
    // start_retry_removals).
    windows::start_retry_removals(&handle);

    windows::rebuild_menu(&handle);
    windows::focus_or_open(&handle);
    listen_for_deep_links(app);

    // No keychain: logins last for this run only. Say so now, not at the
    // first sign-in, or a restart would sign the user out without a word.
    // The vault's lock is not held here, and the callback only queues the
    // notice window on the main thread, so it opens once setup is done.
    if handle.state::<Shell>().vault.this_run_only() {
        handle.state::<Shell>().vault.tell_unavailable();
    }
    Ok(())
}

pub fn run() {
    let mut context = tauri::generate_context!();
    let ui: Box<dyn FileSource> = Box::new(EmbeddedFiles(context.set_assets(Box::new(NoAssets))));
    let app = configure(tauri::Builder::default())
        // One instance, as Electron's shell: a `mantle://` link on Linux starts a
        // second process, which hands the link over (the plugin's `deep-link`
        // feature) and leaves. Must be the first plugin.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // A link is judged where it is delivered, and may move nothing.
            if !argv.iter().any(|a| a.starts_with("mantle://")) {
                windows::focus_or_open(app);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        // Opens links outside, from Rust only. Its click script is off: it
        // would call the plugin's JS command, which no window is granted.
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .on_menu_event(|app, event| windows::on_menu(app, event.id().as_ref()))
        .on_window_event(|window, event| {
            let label = window.label().to_string();
            let Some(id) = profiles::id_from_label(&label).map(str::to_string) else {
                return;
            };
            let app = window.app_handle();
            match event {
                WindowEvent::Focused(true) => {
                    let shell = app.state::<Shell>();
                    if shell.front().as_deref() != Some(id.as_str()) {
                        shell.set_front(Some(id));
                        windows::rebuild_menu(app);
                    }
                }
                WindowEvent::Destroyed => {
                    app.state::<Shell>().unregister_window(&label);
                    windows::rebuild_menu(app);
                }
                _ => {}
            }
        })
        .setup(move |app| setup(app, ui))
        .build(context)
        .expect("MantleOS failed to start");

    app.run(|app, event| match event {
        // macOS keeps the app running with no window, as Electron's shell
        // did; the dock icon brings one back.
        #[cfg(target_os = "macos")]
        RunEvent::ExitRequested {
            code: None, api, ..
        } => api.prevent_exit(),
        #[cfg(target_os = "macos")]
        RunEvent::Reopen {
            has_visible_windows: false,
            ..
        } => windows::focus_or_open(app),
        _ => {
            let _ = app;
        }
    });
}

#[cfg(test)]
mod acl_tests {
    //! Each window reaches only what it is meant to: the connect window its
    //! profile commands (Tauri's ACL, from capabilities/), the keychain
    //! notice no command at all, a brain window no command at all and its
    //! own brain's vault through the UI scheme (vault_endpoint.rs), and
    //! nothing else anything. Runs the real capabilities on Tauri's mock
    //! runtime.

    use super::*;
    use std::sync::Arc;
    use tauri::http;
    use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponseBody};
    use tauri::test::{get_ipc_response, mock_builder, noop_assets, MockRuntime, INVOKE_KEY};
    use tauri::webview::InvokeRequest;
    use tauri::{App, WebviewUrl, WebviewWindowBuilder};

    const COMMANDS: &[&str] = &[
        "profiles_list",
        "profiles_add",
        "profiles_remove",
        "profiles_open",
    ];

    /// The commands that existed before the vault left IPC: no window may
    /// reach them now.
    const GONE: &[&str] = &[
        "vault_load",
        "vault_set_for",
        "vault_clear_for",
        "vault_keep_only",
    ];

    fn request(cmd: &str, url: &str) -> InvokeRequest {
        let body = match cmd {
            "profiles_add" => serde_json::json!({ "url": "not a url" }),
            "profiles_remove" | "profiles_open" => serde_json::json!({ "id": "x" }),
            _ => serde_json::json!({}),
        };
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: url.parse().unwrap(),
            body: InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        }
    }

    /// "allowed" when the ACL let the call reach the command (whatever the
    /// command then answered), "denied" when the ACL or the router refused it.
    fn outcome(res: Result<InvokeResponseBody, serde_json::Value>) -> &'static str {
        match res {
            Ok(_) => "allowed",
            Err(e) => {
                let text = e.to_string();
                if text.contains("not allowed") || text.contains("not found") {
                    "denied"
                } else {
                    "allowed"
                }
            }
        }
    }

    struct Fixture {
        app: App<MockRuntime>,
        dir: std::path::PathBuf,
        brain: String,
        elsewhere: String,
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    /// The app on the mock runtime, with: a brain window on the UI, a
    /// brain window whose page is on its brain (not the UI), the connect
    /// window, the keychain notice, a window with another label, and a
    /// brain-shaped label the shell never opened.
    fn fixture() -> Fixture {
        let dir = std::env::temp_dir().join(format!("mantle-desktop-acl-{}", uuid::Uuid::new_v4()));
        let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../host/test-fixtures/host-contract/ui");
        let store = keyring_core::mock::Store::new().unwrap();
        let shell = Shell::new(
            Box::new(host::DirSource(fixture)),
            "test.mantle-desktop",
            &dir,
            &dir,
            Some(store as Arc<keyring_core::CredentialStore>),
            Box::new(|_| {}),
        )
        .unwrap();
        let profile = shell
            .profiles
            .add("https://brain.example", |_| Ok("1".into()))
            .unwrap();
        let other = shell
            .profiles
            .add("https://other.example", |_| Ok("1".into()))
            .unwrap();

        let app = configure(mock_builder())
            .build(tauri::generate_context!(
                test = true,
                assets = noop_assets()
            ))
            .unwrap();
        app.manage(shell);

        let brain = profiles::label_for(&profile.id);
        let elsewhere = profiles::label_for(&other.id);
        let ui = WebviewUrl::CustomProtocol(shell::ui_root());
        for (label, origin) in [(&brain, &profile.origin), (&elsewhere, &other.origin)] {
            app.state::<Shell>().register_window(label, origin);
        }
        WebviewWindowBuilder::new(&app, &brain, ui.clone())
            .build()
            .unwrap();
        WebviewWindowBuilder::new(
            &app,
            &elsewhere,
            WebviewUrl::External("https://other.example/".parse().unwrap()),
        )
        .build()
        .unwrap();
        WebviewWindowBuilder::new(
            &app,
            shell::CONNECT_LABEL,
            WebviewUrl::CustomProtocol(shell::connect_root()),
        )
        .build()
        .unwrap();
        WebviewWindowBuilder::new(
            &app,
            shell::NOTICE_LABEL,
            WebviewUrl::CustomProtocol(shell::connect_root().join("notice.html").unwrap()),
        )
        .build()
        .unwrap();
        WebviewWindowBuilder::new(&app, "other", ui.clone())
            .build()
            .unwrap();
        let unknown = profiles::label_for(&uuid::Uuid::new_v4().to_string());
        WebviewWindowBuilder::new(&app, &unknown, ui)
            .build()
            .unwrap();
        Fixture {
            app,
            dir,
            brain,
            elsewhere,
        }
    }

    #[test]
    fn each_window_reaches_only_its_own_commands() {
        let f = fixture();
        let brain = f.app.get_webview_window(&f.brain).unwrap();
        let connect = f.app.get_webview_window(shell::CONNECT_LABEL).unwrap();
        let other = f.app.get_webview_window("other").unwrap();
        let notice = f.app.get_webview_window(shell::NOTICE_LABEL).unwrap();

        for cmd in COMMANDS.iter().chain(GONE) {
            let profiles = cmd.starts_with("profiles_");
            let from_brain = outcome(get_ipc_response(
                &brain,
                request(cmd, "mantle-ui://localhost/"),
            ));
            let from_connect = outcome(get_ipc_response(
                &connect,
                request(cmd, "mantle-connect://localhost/"),
            ));
            let from_other = outcome(get_ipc_response(
                &other,
                request(cmd, "mantle-ui://localhost/"),
            ));
            // The connect window whose page is a remote one: no remote URL
            // is granted anything.
            let remote = outcome(get_ipc_response(
                &connect,
                request(cmd, "https://brain.example/"),
            ));
            assert_eq!(from_brain, "denied", "{cmd} from a brain window");
            assert_eq!(
                from_connect,
                if profiles { "allowed" } else { "denied" },
                "{cmd} from the connect window"
            );
            assert_eq!(from_other, "denied", "{cmd} from another window");
            // The keychain notice: no command, from its own page or any.
            for page in [
                "mantle-connect://localhost/notice.html",
                "mantle-connect://localhost/",
            ] {
                let from_notice = outcome(get_ipc_response(&notice, request(cmd, page)));
                assert_eq!(from_notice, "denied", "{cmd} from the notice at {page}");
            }
            assert_eq!(remote, "denied", "{cmd} from a remote page");
        }
    }

    fn vault_request(
        method: &str,
        headers: &[(&str, &str)],
        body: serde_json::Value,
    ) -> http::Request<Vec<u8>> {
        let mut req = http::Request::builder()
            .method(method)
            .uri("mantle-ui://localhost/_mantle/vault");
        for (name, value) in headers {
            req = req.header(*name, *value);
        }
        req.body(body.to_string().into_bytes()).unwrap()
    }

    const GOOD: &[(&str, &str)] = &[("origin", "mantle-ui://localhost"), ("x-mantle-vault", "1")];

    fn call(f: &Fixture, label: &str, body: serde_json::Value) -> (u16, Vec<u8>) {
        let res = vault_endpoint::serve(f.app.handle(), label, &vault_request("POST", GOOD, body));
        (res.status().as_u16(), res.body().clone())
    }

    fn value(answer: (u16, Vec<u8>)) -> serde_json::Value {
        assert_eq!(answer.0, 200);
        serde_json::from_slice::<serde_json::Value>(&answer.1).unwrap()["value"].clone()
    }

    #[test]
    fn the_vault_answers_a_brain_window_on_the_ui_for_its_own_brain() {
        let f = fixture();
        let set = serde_json::json!({ "op": "setFor", "sessionId": "s1", "token": "bearer.one" });
        assert_eq!(value(call(&f, &f.brain, set)), serde_json::Value::Null);
        let get = serde_json::json!({ "op": "getFor", "sessionId": "s1" });
        assert_eq!(value(call(&f, &f.brain, get.clone())), "bearer.one");
        // The brain comes from the label, never from the body.
        let foreign = serde_json::json!({ "op": "getFor", "sessionId": "s1", "profile": "x" });
        assert_eq!(value(call(&f, &f.brain, foreign)), "bearer.one");
        // The unscoped slot, and adopt as a move.
        let slot = serde_json::json!({ "op": "set", "token": "legacy" });
        value(call(&f, &f.brain, slot));
        let adopt = serde_json::json!({ "op": "adopt", "sessionId": "s2" });
        assert_eq!(value(call(&f, &f.brain, adopt)), "legacy");
        assert_eq!(
            value(call(&f, &f.brain, serde_json::json!({ "op": "get" }))),
            serde_json::Value::Null
        );
        // keepOnly ignores anything that is not two lists.
        let odd = serde_json::json!({ "op": "keepOnly", "sessionIds": "s1", "strayBearers": ["bearer.one"] });
        value(call(&f, &f.brain, odd));
        assert_eq!(value(call(&f, &f.brain, get)), "bearer.one");
        // Not a call: 400, nothing done.
        assert_eq!(
            call(&f, &f.brain, serde_json::json!({ "op": "load" })).0,
            400
        );
        assert_eq!(call(&f, &f.brain, serde_json::json!(["getFor"])).0, 400);
    }

    #[test]
    fn the_vault_refuses_everything_else_with_an_empty_403() {
        let f = fixture();
        let set = serde_json::json!({ "op": "setFor", "sessionId": "s1", "token": "planted" });
        let refused = |label: &str, method: &str, headers: &[(&str, &str)]| {
            let res = vault_endpoint::serve(
                f.app.handle(),
                label,
                &vault_request(method, headers, set.clone()),
            );
            assert_eq!(res.status().as_u16(), 403, "{label} {method} {headers:?}");
            assert!(res.body().is_empty());
        };
        let marker = ("x-mantle-vault", "1");
        // The request's own checks, from the right window.
        for origin in [
            None,
            Some("null"),
            Some("https://brain.example"),
            Some("mantle-ui://localhost.evil"),
            Some("mantle-ui://localhost/"),
            Some("mantle-connect://localhost"),
        ] {
            let mut headers = vec![marker];
            if let Some(o) = origin {
                headers.push(("origin", o));
            }
            refused(&f.brain, "POST", &headers);
        }
        refused(&f.brain, "POST", &[("origin", "mantle-ui://localhost")]);
        refused(
            &f.brain,
            "POST",
            &[
                ("origin", "mantle-ui://localhost"),
                ("x-mantle-vault", "true"),
            ],
        );
        refused(&f.brain, "GET", GOOD);
        refused(&f.brain, "OPTIONS", GOOD);
        refused(&f.brain, "PUT", GOOD);
        // A good request from the wrong window.
        refused(shell::CONNECT_LABEL, "POST", GOOD);
        refused("other", "POST", GOOD);
        refused("brain-not-a-uuid", "POST", GOOD);
        refused(
            &profiles::label_for(&uuid::Uuid::new_v4().to_string()),
            "POST",
            GOOD,
        );
        // A brain window the shell opened, whose page is not the UI.
        refused(&f.elsewhere, "POST", GOOD);
        // Nothing was written by any of them.
        let get = serde_json::json!({ "op": "getFor", "sessionId": "s1" });
        assert_eq!(value(call(&f, &f.brain, get)), serde_json::Value::Null);
    }

    #[test]
    fn a_brain_window_that_leaves_the_ui_loses_the_vault() {
        let f = fixture();
        let set = serde_json::json!({ "op": "setFor", "sessionId": "s1", "token": "bearer.one" });
        value(call(&f, &f.brain, set));
        let window = f.app.get_webview_window(&f.brain).unwrap();
        window
            .navigate("https://brain.example/".parse().unwrap())
            .unwrap();
        let get = serde_json::json!({ "op": "getFor", "sessionId": "s1" });
        assert_eq!(call(&f, &f.brain, get.clone()).0, 403);
        window.navigate(shell::ui_root()).unwrap();
        assert_eq!(value(call(&f, &f.brain, get)), "bearer.one");
    }

    /// The start's retry runs as a task (setup never waits for it, see
    /// windows::start_retry_removals) and each id leaves the list on its
    /// own: a removal listed while it runs is kept. The mock runtime has no
    /// WebKit data stores (they are todo!() in it), so this runs where a
    /// store is a folder; on macOS the comment and the absence of block_on
    /// are what holds.
    #[cfg(not(target_os = "macos"))]
    #[test]
    fn the_start_retry_runs_as_a_task_and_keeps_a_removal_made_meanwhile() {
        let f = fixture();
        let shell = f.app.state::<Shell>();
        let gone = uuid::Uuid::new_v4().to_string();
        let listed = profiles::id_from_label(&f.brain).unwrap().to_string();
        let folder = |id: &str| windows::brain_data_dir(f.app.handle(), id).unwrap();
        std::fs::create_dir_all(folder(&gone)).unwrap();
        std::fs::create_dir_all(folder(&listed)).unwrap();
        shell.update_pending_removals(|ids| {
            ids.push(gone.clone());
            ids.push(listed.clone());
        });
        windows::start_retry_removals(f.app.handle());
        let meanwhile = uuid::Uuid::new_v4().to_string();
        shell.update_pending_removals(|ids| ids.push(meanwhile.clone()));
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while shell.pending_removals() != vec![meanwhile.clone()] {
            assert!(
                std::time::Instant::now() < deadline,
                "the retry did not finish: {:?}",
                shell.pending_removals()
            );
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        assert!(!folder(&gone).exists(), "an unlisted brain's store goes");
        assert!(folder(&listed).exists(), "a listed brain's store stays");
    }

    /// A removal whose logins the keychain would not delete keeps the brain
    /// listed even when its store went; the start's retry then removes the
    /// logins (before the store step) and only then lets the brain go. On a
    /// folder store, for the reason above.
    #[cfg(not(target_os = "macos"))]
    #[test]
    fn the_start_retry_removes_logins_left_behind_then_lets_the_brain_go() {
        let f = fixture();
        let shell = f.app.state::<Shell>();
        let gone = uuid::Uuid::new_v4().to_string();
        let folder = windows::brain_data_dir(f.app.handle(), &gone).unwrap();
        std::fs::create_dir_all(&folder).unwrap();
        shell.vault.set_for(&gone, "s1", "left.behind", 1);
        tauri::async_runtime::block_on(windows::remove_brain_store(
            f.app.handle().clone(),
            gone.clone(),
            false,
        ));
        assert!(!folder.exists(), "the store went");
        assert_eq!(shell.pending_removals(), vec![gone.clone()]);

        windows::start_retry_removals(f.app.handle());
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while !shell.pending_removals().is_empty() {
            assert!(
                std::time::Instant::now() < deadline,
                "the retry did not finish: {:?}",
                shell.pending_removals()
            );
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        assert_eq!(shell.vault.get_for(&gone, "s1"), None);

        // Both done at once: nothing is listed.
        let done = uuid::Uuid::new_v4().to_string();
        tauri::async_runtime::block_on(windows::remove_brain_store(
            f.app.handle().clone(),
            done,
            true,
        ));
        assert!(shell.pending_removals().is_empty());
    }

    /// The probe runs with no lock held: `open_brain` takes `edits` on the
    /// main thread, and a probe may take ten seconds. The save is under it.
    #[test]
    fn adding_a_brain_probes_without_the_edits_lock() {
        let f = fixture();
        let shell = f.app.state::<Shell>();
        let added = commands::add_profile(&shell, "https://third.example", |_| {
            assert!(
                shell.edits.try_lock().is_ok(),
                "the probe ran under the edits lock"
            );
            Ok("1".into())
        })
        .unwrap();
        assert!(shell.profiles.find(&added.id).is_some());
        // A probe that fails saves nothing.
        let failed = commands::add_profile(&shell, "https://fourth.example", |_| Err("no".into()));
        assert!(failed.is_err());
        assert_eq!(shell.profiles.load().len(), 3);
    }

    /// A window built for a brain removed while it was being built (open
    /// and remove at once): destroyed, and the brain listed for the start's
    /// retry, which removes the store it made. A brain still listed keeps
    /// its window. The race is the gap between the list read and the build,
    /// made here by removing the brain between the two. What the mock
    /// runtime cannot show: that the window is gone. Its destroy drops the
    /// window from the runtime's own table only, and Tauri's manager drops
    /// it on the Destroyed event, which an app that is not running never
    /// gets.
    #[test]
    fn a_window_built_for_a_brain_removed_meanwhile_is_closed_and_its_store_listed() {
        let f = fixture();
        let shell = f.app.state::<Shell>();
        let kept = shell
            .profiles
            .add("https://kept.example", |_| Ok("1".into()))
            .unwrap();
        let win = windows::build_brain_window(f.app.handle(), &kept).unwrap();
        assert!(windows::keep_if_listed(f.app.handle(), win, &kept.id));
        let kept_label = profiles::label_for(&kept.id);
        assert!(f.app.get_webview_window(&kept_label).is_some());
        assert!(shell.brain_of_window(&kept_label).is_some());

        let raced = shell
            .profiles
            .add("https://raced.example", |_| Ok("1".into()))
            .unwrap();
        let win = windows::build_brain_window(f.app.handle(), &raced).unwrap();
        // The removal lands after the list was read, before the re-check.
        shell.profiles.remove(&raced.id).unwrap();
        assert!(!windows::keep_if_listed(f.app.handle(), win, &raced.id));
        let label = profiles::label_for(&raced.id);
        assert!(shell.brain_of_window(&label).is_none());
        assert_eq!(shell.pending_removals(), vec![raced.id.clone()]);
        // Its page has no vault meanwhile.
        assert_eq!(call(&f, &label, serde_json::json!({ "op": "get" })).0, 403);
        // open_brain on a brain gone before the read refuses at once.
        assert!(windows::open_brain(f.app.handle(), &raced.id).is_err());
        assert_eq!(shell.pending_removals(), vec![raced.id]);
    }

    #[test]
    fn a_brain_no_longer_listed_loses_the_vault() {
        let f = fixture();
        let id = profiles::id_from_label(&f.brain).unwrap().to_string();
        f.app.state::<Shell>().profiles.remove(&id).unwrap();
        assert_eq!(
            call(&f, &f.brain, serde_json::json!({ "op": "get" })).0,
            403
        );
    }
}
