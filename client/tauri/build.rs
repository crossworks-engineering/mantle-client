use std::path::Path;

/// Every command the app defines. Listing them makes each one need a
/// permission (`allow-<command>`), granted per window in capabilities/: a
/// command no capability names is refused to every window.
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

fn main() {
    // The export is embedded at compile time (tauri.conf.json frontendDist).
    // Say what to do instead of failing deep inside the context macro.
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
    let routes = Path::new(&manifest_dir).join("../web/out/_mantle/routes.json");
    if !routes.exists() {
        panic!(
            "The owner UI export is missing ({}). Build it first: pnpm -C client/web build",
            routes.display()
        );
    }
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("tauri-build");
}
