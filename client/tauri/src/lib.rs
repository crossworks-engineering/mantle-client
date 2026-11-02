//! MantleOS Desktop on Tauri (T1): the static owner UI, one window per
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
//!   dialog.rs    the native alert and notice, the macOS version check

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

const KEYCHAIN_TITLE: &str = "Logins are not saved";
const KEYCHAIN_MESSAGE: &str = "MantleOS Desktop could not use this computer's keychain (on Linux: the Secret Service), so it cannot keep you signed in. Make sure a keychain is installed and unlocked, then quit and reopen the app. Nothing is written to disk in its place.";

fn setup<R: Runtime>(
    app: &mut tauri::App<R>,
    files: Box<dyn FileSource>,
) -> Result<(), Box<dyn std::error::Error>> {
    // Below macOS 14 WebKit has no per-window data store, and wry quietly
    // gives every window the same one: every brain would share one storage.
    #[cfg(target_os = "macos")]
    if dialog::macos_major() < 14 {
        dialog::alert(
            "MantleOS Desktop needs macOS 14 or later",
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
        // Called by the vault once per run, never under its lock, and never
        // on the main thread: the notice is queued there and not waited on.
        Box::new(move || {
            let _ = notify.run_on_main_thread(|| dialog::notice(KEYCHAIN_TITLE, KEYCHAIN_MESSAGE));
        }),
    );
    let shell = match shell {
        Ok(shell) => shell,
        Err(error) => {
            dialog::alert("MantleOS Desktop cannot start", &error);
            std::process::exit(1);
        }
    };
    app.manage(shell);

    // Stores an earlier run could not remove go first, before any window.
    let retry = handle.clone();
    tauri::async_runtime::block_on(windows::retry_removals(retry));

    windows::rebuild_menu(&handle);
    windows::focus_or_open(&handle);

    // No keychain at all: say so now, not at the first sign-in, or a
    // restart would sign the user out without a word. From a task, so the
    // notice is shown once setup is done, beside the first window.
    if !handle.state::<Shell>().vault.has_store() {
        let app = handle.clone();
        tauri::async_runtime::spawn(async move {
            app.state::<Shell>().vault.tell_unavailable();
        });
    }
    Ok(())
}

pub fn run() {
    let mut context = tauri::generate_context!();
    let ui: Box<dyn FileSource> = Box::new(EmbeddedFiles(context.set_assets(Box::new(NoAssets))));
    let app = configure(tauri::Builder::default())
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
        .expect("MantleOS Desktop failed to start");

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
    //! profile commands (Tauri's ACL, from capabilities/), a brain window no
    //! command at all and its own brain's vault through the UI scheme
    //! (vault_endpoint.rs), and nothing else anything. Runs the real
    //! capabilities on Tauri's mock runtime.

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
    /// window, a window with another label, and a brain-shaped label the
    /// shell never opened.
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
            Box::new(|| {}),
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
