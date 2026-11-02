//! The app's whole IPC surface: the connect window's profile commands, each
//! granted to that window in capabilities/connect.json (and refused to every
//! other window by Tauri's ACL), and each checking again, here, that the
//! page asking is the connect page: the ACL is per label.
//!
//! A brain window has no command at all. Its vault is the UI scheme's own
//! endpoint (vault_endpoint.rs), not IPC.

use tauri::{AppHandle, Manager, Runtime, State, Webview};

use crate::fence;
use crate::profiles::Profile;
use crate::shell::{Shell, CONNECT_LABEL};
use crate::windows;

fn connect_only<R: Runtime>(webview: &Webview<R>) -> Result<(), String> {
    let on_page = webview.url().is_ok_and(|u| fence::is_connect_url(&u));
    if webview.label() == CONNECT_LABEL && on_page {
        Ok(())
    } else {
        Err("Not available here.".into())
    }
}

#[tauri::command]
pub fn profiles_list<R: Runtime>(
    webview: Webview<R>,
    shell: State<'_, Shell>,
) -> Result<Vec<Profile>, String> {
    connect_only(&webview)?;
    Ok(shell.profiles.load())
}

/// Probe-before-save. Async (off the main thread): the probe may take ten
/// seconds, and nothing here needs an order.
#[tauri::command]
pub async fn profiles_add<R: Runtime>(webview: Webview<R>, url: String) -> Result<Profile, String> {
    connect_only(&webview)?;
    let app = webview.app_handle().clone();
    let added = tauri::async_runtime::spawn_blocking(move || {
        let shell = app.state::<Shell>();
        let _edit = shell.edits.lock().unwrap_or_else(|e| e.into_inner());
        shell.profiles.add(&url, crate::net::probe_version)
    })
    .await
    .map_err(|e| e.to_string())??;
    windows::rebuild_menu(webview.app_handle());
    Ok(added)
}

/// Removing a brain deletes its keychain entries, its index, its window and
/// its data store. Only an id this app minted and still lists.
#[tauri::command]
pub async fn profiles_remove<R: Runtime>(webview: Webview<R>, id: String) -> Result<(), String> {
    connect_only(&webview)?;
    let app: AppHandle<R> = webview.app_handle().clone();
    let removed = {
        let shell = app.state::<Shell>();
        let _edit = shell.edits.lock().unwrap_or_else(|e| e.into_inner());
        shell.profiles.remove(&id)?
    };
    if !removed {
        return Ok(());
    }
    // Off the list first, then its logins: a vault call on its way asks
    // under the vault's lock whether the brain is still listed
    // (vault_endpoint.rs), so it is refused, or it comes before this
    // removal, which waits for that lock and finds what it wrote. Logins
    // the keychain would not delete keep the brain in pending-removals.json
    // (remove_brain_store), and the next start tries again.
    let shell = app.state::<Shell>();
    let logins_gone = {
        let app = app.clone();
        let id = id.clone();
        tauri::async_runtime::spawn_blocking(move || app.state::<Shell>().vault.remove_profile(&id))
            .await
            .unwrap_or(false)
    };
    let label = crate::profiles::label_for(&id);
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.destroy();
    }
    shell.unregister_window(&label);
    windows::rebuild_menu(&app);
    windows::remove_brain_store(app.clone(), id, logins_gone).await;
    Ok(())
}

#[tauri::command]
pub async fn profiles_open<R: Runtime>(webview: Webview<R>, id: String) -> Result<(), String> {
    connect_only(&webview)?;
    let app = webview.app_handle().clone();
    windows::open_brain(&app, &id)?;
    let _ = webview.window().close();
    Ok(())
}
