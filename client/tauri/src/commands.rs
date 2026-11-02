//! The app's whole IPC surface. Each command is granted to one kind of
//! window in capabilities/ (and refused to every other by Tauri's ACL), and
//! each checks again, here, which window is asking: the ACL is per label,
//! and these also need the page in it to be the app's own.
//!
//! The vault commands are plain `fn`, not `async`: Tauri runs those on the
//! main thread one at a time in the order they arrive, so a write the page
//! makes before a navigation has landed before the next page loads.

use std::collections::HashMap;

use tauri::{AppHandle, Manager, Runtime, State, Webview};

use crate::fence;
use crate::profiles::{id_from_label, Profile};
use crate::shell::{Shell, CONNECT_LABEL};
use crate::windows;

/// The profile a brain window's call is for. Never a parameter: it is the
/// window's own, from its label, and the window must be one the shell opened
/// for a brain it still lists, showing the UI's own origin.
fn brain_profile<R: Runtime>(webview: &Webview<R>, shell: &Shell) -> Result<String, String> {
    let label = webview.label();
    let id = id_from_label(label).ok_or("Not available here.")?;
    if shell.brain_of_window(label).is_none() || shell.profiles.find(id).is_none() {
        return Err("Not available here.".into());
    }
    let on_ui = webview.url().is_ok_and(|u| fence::is_ui_url(&u));
    if !on_ui {
        return Err("Not available here.".into());
    }
    Ok(id.to_string())
}

fn connect_only<R: Runtime>(webview: &Webview<R>) -> Result<(), String> {
    let on_page = webview.url().is_ok_and(|u| fence::is_connect_url(&u));
    if webview.label() == CONNECT_LABEL && on_page {
        Ok(())
    } else {
        Err("Not available here.".into())
    }
}

#[tauri::command]
pub fn vault_load<R: Runtime>(
    webview: Webview<R>,
    shell: State<'_, Shell>,
) -> Result<HashMap<String, String>, String> {
    let profile = brain_profile(&webview, &shell)?;
    let held = shell.vault.load(&profile);
    shell.trace(|| {
        format!(
            "vault_load from {} -> {} login(s)",
            webview.label(),
            held.len()
        )
    });
    Ok(held)
}

#[tauri::command]
pub fn vault_set_for<R: Runtime>(
    webview: Webview<R>,
    shell: State<'_, Shell>,
    session_id: String,
    token: String,
) -> Result<(), String> {
    let profile = brain_profile(&webview, &shell)?;
    shell.trace(|| format!("vault_set_for from {}", webview.label()));
    shell.vault.set_for(&profile, &session_id, &token)
}

#[tauri::command]
pub fn vault_clear_for<R: Runtime>(
    webview: Webview<R>,
    shell: State<'_, Shell>,
    session_id: String,
) -> Result<(), String> {
    let profile = brain_profile(&webview, &shell)?;
    shell.trace(|| format!("vault_clear_for from {}", webview.label()));
    shell.vault.clear_for(&profile, &session_id)
}

/// Strings only: anything else in either list is ignored, as Electron does.
fn strings(value: &serde_json::Value) -> Option<Vec<String>> {
    value.as_array().map(|items| {
        items
            .iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect()
    })
}

#[tauri::command]
pub fn vault_keep_only<R: Runtime>(
    webview: Webview<R>,
    shell: State<'_, Shell>,
    session_ids: serde_json::Value,
    stray_bearers: serde_json::Value,
) -> Result<(), String> {
    let profile = brain_profile(&webview, &shell)?;
    shell.trace(|| format!("vault_keep_only from {}", webview.label()));
    if let (Some(ids), Some(strays)) = (strings(&session_ids), strings(&stray_bearers)) {
        shell
            .vault
            .keep_only(&profile, &ids, &strays, crate::profiles::now_ms());
    }
    Ok(())
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
    let shell = app.state::<Shell>();
    shell.vault.remove_profile(&id);
    let label = crate::profiles::label_for(&id);
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.destroy();
    }
    shell.unregister_window(&label);
    windows::rebuild_menu(&app);
    windows::remove_brain_store(app.clone(), id).await;
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
