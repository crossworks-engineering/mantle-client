# MantleOS Desktop on Tauri (T1)

The desktop shell rebuilt on Tauri 2: the owner UI's static export
(`client/web/out`) in one window per brain, each window on its own WebKit
data store, the logins in the OS keychain. It sits beside the Electron shell
(`client/desktop`), which it does not touch.

## How it works

- **The UI** is served on the app's own scheme, `mantle-ui://localhost`, to
  brain windows only (`src/host.rs`, a Rust port of the host contract in
  `docs/static-ui-host.md`). The export is embedded at compile time and looked
  up exactly; Tauri's own `tauri://localhost` is left with no files.
  Everything the scheme serves is public: a brain's frames can load any of it
  with a `<script src>`.
- **Nothing intercepts http.** The page talks to its brain directly from
  WebKit. The fence is the CSP the scheme serves (the build's `csp.txt` for
  this brain, plus Tauri's IPC in `connect-src`), the navigation handlers,
  and a small IPC surface (`src/fence.rs`, `src/commands.rs`).
- **One window per brain**, labelled `brain-<profile id>`. macOS: a WebKit
  data store per brain (`data_store_identifier`, macOS 14 and later; the app
  refuses to run below that, because wry would quietly share one store).
  Linux: a data folder per brain.
- **The vault** (`src/vault.rs`): one keychain entry per login, service = the
  app identifier, user = `<profile id>/<session id>`, plus a non-secret index
  of session ids per brain. The page reaches it as
  `window.mantleDesktop.tokenVaultAsync` (`packages/web-ui/src/desktop-vault.ts`).
  The brain is never a parameter: it comes from the calling window. Without a
  keychain, logins live in memory for the run and the user is told once.
- **Capabilities** (`capabilities/`): the vault commands are granted to
  `brain-*` windows, the profile commands to the `connect` window, both for
  the app's own pages only. A test runs them on Tauri's mock runtime.
- **The connect window** (`connect/`) is a small plain page on a second
  scheme, `mantle-connect://localhost`.

## Toolchain and pins

Rust 1.99.1 (`rust-toolchain.toml`; rustup picks it up). Every crate is pinned
exactly (`=x.y.z`) and `Cargo.lock` is committed: tauri 2.12.5, tauri-build
2.7.4, tauri-plugin-opener 2.7.2, serde 1.0.229, serde_json 1.0.154, ureq
3.5.0 (rustls only, no cookie store), uuid 1.29.0, url 2.5.8, keyring-core
1.0.1, apple-native-keyring-store 1.0.2 (macOS), zbus-secret-service-keyring-store
1.0.1 (Linux), and for the native alert and the macOS version check the
versions wry already uses: objc2 0.6.5, objc2-foundation 0.3.2,
objc2-app-kit 0.3.2 (macOS), gtk 0.18.2 (Linux).

## Build

The export must exist before any build (it is embedded, in dev builds too):

```sh
pnpm -C client/web build
cd client/tauri
cargo test                  # unit tests, the shared host cases, the ACL test
scripts/build.sh            # cargo build --release --features custom-protocol
./target/release/mantle-desktop
```

On macOS that is all. On Linux, install the WebKitGTK 4.1 and GTK 3
development packages first (Debian and Ubuntu: `libwebkit2gtk-4.1-dev`,
`libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `libssl-dev`,
`build-essential`, `pkg-config`), and a Secret Service (GNOME Keyring,
KeePassXC) for the vault.

`MANTLE_DESKTOP_TRACE=1` prints a line per scheme request (with the CSP and
env.js it served) and per vault call to stderr. Never a token.

## What T1 leaves for T2

- Deep links (`mantle://`): `deep_link_to_path` and `in_app_url` are ported
  with Electron's rules but not wired; single instance with them.
- Notifications, the dock badge and `attention`: `notify` and `setBadge` are
  no-ops.
- Downloads (WebKit cancels them without a download handler), the tray,
  updates, signing and bundles (`tauri build`), "add a login for another
  brain" (`brains.openForLogin`), permission prompts (the microphone).
- The sub-frame fence: wry asks the navigation handler for every frame
  without saying which, so the brain origin is allowed for its frames, and a
  page script sends main-frame links outside. Electron's rule that an app
  frame stays on its own frame documents (`frameNavigationAllowed`) needs the
  frame's own URL, which wry does not give.
