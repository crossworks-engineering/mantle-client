//! MantleOS Desktop on Tauri (T1): the static owner UI, one window per
//! brain, each on its own WebKit data store, logins in the OS keychain.
//!
//!   fence.rs     where a window may go; which addresses a brain may have
//!   host.rs      the UI host for one brain (the host contract, in Rust)
//!   net.rs       the shell's own two requests to a brain
//!   profiles.rs  profiles.json
//!   vault.rs     the keychain-backed token vault
//!   shell.rs     the app state and the two schemes
//!   windows.rs   brain windows, the connect window, the menu
//!   commands.rs  the IPC surface, each command granted per window
//!   dialog.rs    the native alert, the macOS version check

pub mod commands;
pub mod dialog;
pub mod fence;
pub mod host;
pub mod net;
pub mod profiles;
pub mod shell;
pub mod vault;
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
            commands::vault_load,
            commands::vault_set_for,
            commands::vault_clear_for,
            commands::vault_keep_only,
            commands::profiles_list,
            commands::profiles_add,
            commands::profiles_remove,
            commands::profiles_open,
        ])
        .register_asynchronous_uri_scheme_protocol(fence::UI_SCHEME, shell::serve_ui)
        .register_asynchronous_uri_scheme_protocol(fence::CONNECT_SCHEME, shell::serve_connect)
}

const KEYCHAIN_TITLE: &str = "Logins are not saved";
const KEYCHAIN_MESSAGE: &str = "MantleOS Desktop could not use this computer's keychain (on Linux: the Secret Service). You stay signed in until you quit the app, and then sign in again. Nothing is written to disk in its place.";

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
        Box::new(move || {
            let _ = notify.run_on_main_thread(|| dialog::alert(KEYCHAIN_TITLE, KEYCHAIN_MESSAGE));
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
    //! Each window reaches only the commands its capability grants: a brain
    //! window the vault, the connect window the profiles, any other window
    //! nothing, and a page off the app's own schemes nothing at all. Runs the
    //! real capabilities (compiled from capabilities/) on Tauri's mock runtime.

    use super::*;
    use std::sync::Arc;
    use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponseBody};
    use tauri::test::{get_ipc_response, mock_builder, noop_assets, INVOKE_KEY};
    use tauri::webview::InvokeRequest;
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    const COMMANDS: &[&str] = &[
        "vault_load",
        "vault_set_for",
        "vault_clear_for",
        "vault_keep_only",
        "profiles_list",
        "profiles_add",
        "profiles_remove",
        "profiles_open",
    ];

    fn request(cmd: &str, url: &str) -> InvokeRequest {
        let body = match cmd {
            "vault_set_for" => serde_json::json!({ "sessionId": "s1", "token": "t" }),
            "vault_clear_for" => serde_json::json!({ "sessionId": "s1" }),
            "vault_keep_only" => serde_json::json!({ "sessionIds": [], "strayBearers": [] }),
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
    /// command then answered), "denied" when the ACL refused it.
    fn outcome(res: Result<InvokeResponseBody, serde_json::Value>) -> &'static str {
        match res {
            Ok(_) => "allowed",
            Err(e) => {
                let text = e.to_string();
                if text.contains("not allowed") {
                    "denied"
                } else {
                    "allowed"
                }
            }
        }
    }

    #[test]
    fn each_window_reaches_only_its_own_commands() {
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

        let app = configure(mock_builder())
            .build(tauri::generate_context!(
                test = true,
                assets = noop_assets()
            ))
            .unwrap();
        app.manage(shell);

        let brain_label = profiles::label_for(&profile.id);
        app.state::<Shell>()
            .register_window(&brain_label, &profile.origin);
        let ui = WebviewUrl::CustomProtocol(shell::ui_root());
        let brain = WebviewWindowBuilder::new(&app, &brain_label, ui.clone())
            .build()
            .unwrap();
        let connect = WebviewWindowBuilder::new(
            &app,
            shell::CONNECT_LABEL,
            WebviewUrl::CustomProtocol(shell::connect_root()),
        )
        .build()
        .unwrap();
        let other = WebviewWindowBuilder::new(&app, "other", ui)
            .build()
            .unwrap();

        for cmd in COMMANDS {
            let vault = cmd.starts_with("vault_");
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
            // A brain window whose page is a remote one: no remote URL is
            // granted anything.
            let remote = outcome(get_ipc_response(
                &brain,
                request(cmd, "https://brain.example/"),
            ));
            assert_eq!(
                from_brain,
                if vault { "allowed" } else { "denied" },
                "{cmd} from a brain window"
            );
            assert_eq!(
                from_connect,
                if vault { "denied" } else { "allowed" },
                "{cmd} from the connect window"
            );
            assert_eq!(from_other, "denied", "{cmd} from another window");
            assert_eq!(remote, "denied", "{cmd} from a remote page");
        }

        // Past the ACL, the vault answers the brain window for its own brain.
        let held = get_ipc_response(&brain, request("vault_load", "mantle-ui://localhost/"));
        assert!(held.is_ok(), "{held:?}");
        let _ = std::fs::remove_dir_all(dir);
    }
}
