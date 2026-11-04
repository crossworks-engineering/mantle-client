# MantleOS on Tauri (T1)

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
  this brain, exactly the TS host's), the navigation handlers, and the
  page-load guard (`src/fence.rs`, `src/windows.rs`). A brain window has no
  IPC command at all.
- **Navigation.** The navigation handlers only allow or refuse; they never
  open anything outside the app, because wry asks them for every frame, with
  no user gesture needed. A brain window allows the UI, its brain's origin
  (for the brain's frames), about:blank, about:srcdoc and a matching blob:.
  When the MAIN frame commits anywhere but the UI it is sent back to
  `mantle-ui://localhost/`. Links open in the browser only through a
  new-window request (`on_new_window`), which WebKit's popup blocker ties to
  a click; the page script turns a plain main-frame link off the UI into one.
- **One window per brain**, labelled `brain-<profile id>`. macOS: a WebKit
  data store per brain (`data_store_identifier`, macOS 14 and later; the app
  refuses to run below that, because wry would quietly share one store).
  Linux: a data folder per brain.
- **The vault** (`src/vault.rs`) has Electron's shape and rules
  (`client/desktop/src/main/vault.ts`), with the keychain where Electron has
  files: service = the app identifier, user = `<profile id>` for the one
  unscoped slot an earlier build used, `<profile id>/<session id>` per
  login; `adopt` moves the slot's bearer to a login; `keepOnly` drops stray
  copies older than 120 s. A non-secret index per brain lists the session
  ids and when each was written. **The keychain is the only copy**: nothing
  else holds a bearer, the page asks again on every read, and a write the
  keychain refuses is simply not stored (the next read tells the truth).
  The index is written first, and when it cannot be written the keychain is
  not either (that login is simply not stored, traced but not shown as the
  keychain notice), so every entry is one the index names. Removing a brain
  deletes what its index names, then sweeps the keychain for its
  `<profile id>/` prefix (keyring-core's search) in case one was missed.
- **No keychain: this run only.** When the platform has no keychain, or the
  keychain does not answer a read when the vault is made (`Vault::new`, the
  one place this is decided), the vault keeps that run's bearers AND its
  index in the process's memory (`MemoryStore` in `src/vault.rs`). A sign-in
  works and lasts until the app quits; nothing of it is written to disk, and
  the next run starts on `/login`. The memory store answers as the keychain
  does and is the only copy in the same way, so the synchronous reads stay
  truthful. A keychain that answers at start and fails later in the run is
  not swapped out: that write is not stored, as above.
- **The page's way in** (`src/vault_endpoint.rs`): `window.mantleDesktop`
  (main frame, UI origin only) has Electron's synchronous `tokenVault`:
  `get`, `set`, `clear`, `getFor`, `setFor`, `clearFor`, `adopt`,
  `keepOnly`. Each is a synchronous XMLHttpRequest, `POST
mantle-ui://localhost/_mantle/vault` with `X-Mantle-Vault: 1` and a JSON
  body `{op, ...args}`; the answer is `{"value": <string or null>}`. It is
  answered only for POST with that header, `Origin` exactly
  `mantle-ui://localhost`, from a `brain-<uuid>` window the shell opened for
  a brain it lists, whose current URL is on the UI origin; anything else is
  403 with an empty body and nothing done. The brain comes from the window's
  label, never from the body. The work runs off the main thread (the
  scheme's asynchronous handler, then `spawn_blocking`), one call at a time
  under one lock per process, and nothing that shows UI runs under it.
  Whether the brain is still listed is asked again under that lock, with
  the call (`Vault::when`); removing a brain takes it off the list first and
  then removes its logins under the same lock, so a call on its way is
  refused, or comes first and is swept.
- **The keychain notice.** With no keychain, a notice says at start that
  logins last until you quit (`connect/notice.html`); when the keychain
  first fails during a run, it says so then (`connect/notice-failed.html`).
  Once per run, whichever comes first. It is a small window of the app's
  own on both platforms, label `notice`, on the connect scheme: NOT modal
  (nothing waits on it, no nested run loop), fixed text, no script (its CSP
  allows none), no command granted. Its OK is a form to `/notice-ok`, which
  the window's navigation handler turns into a close; `window.close()` would
  do nothing in wry on macOS and on Linux would take the webview out of its
  window. The window is built on the main thread, queued there from a task
  after setup, and never from under the vault's lock. The only native dialog
  left is the modal alert for a start that cannot go on.
- **Removing a brain** deletes its keychain entries and index, closes its
  window and removes its data store (`commands.rs`, `windows.rs`). When a
  store is still in use, or the keychain refuses to delete a login (or to
  search for them), the brain is listed in `pending-removals.json`, and the
  next start retries, as a task: the logins first, then the store, and the
  brain stays listed until both are done. Setup never waits for it. On
  macOS WebKit's store calls answer on the main thread's run loop, so a
  main thread blocked on them never gets the answer (the app hung at start
  that way). No window can use a removed brain's store or logins
  meanwhile: the brain is not listed. A window opened for a brain while it
  was being removed is checked against the list once it is built: if the
  brain is gone it is destroyed, and the brain is listed for the retry,
  which removes the store that window made.
- **Adding a brain** probes it with no lock held, then takes the profile
  list's lock only to load, merge and save: opening a brain takes that lock
  on the main thread.
- **Company sign-in.** The page opens the brain's start URL in the system
  browser (`mantleDesktop.oidc.open`, the vault endpoint's `oidcOpen`: that
  brain's `/api/auth/oidc/start` and nothing else). The flow comes back as
  `mantle://oidc#...`, through the deep-link plugin (and, on Linux, the
  single-instance plugin, which hands a second process's link over). The shell
  keeps only the fields the flow's end can hold and loads them on the window's
  `/auth/oidc`, the page the web app ends on, which compares the brain and holds
  the verifier (`src/fence.rs`, `src/windows.rs`). Any app can open such a link,
  so only a window that sent a sign-in out takes one, once, within 15 minutes;
  any other moves nothing. Other `mantle://` links are
  still T2's. Neither plugin's JS command is granted to any window.
- **Capabilities** (`capabilities/`): the profile commands, granted to the
  `connect` window for the app's own page only. No other window gets any
  command. A test runs them, and the vault endpoint's refusals, on Tauri's
  mock runtime.
- **The connect window** (`connect/`) is a small plain page on a second
  scheme, `mantle-connect://localhost`. That scheme serves each file to its
  own window only: the connect page to `connect`, the notice to `notice`.

## Toolchain and pins

Rust 1.99.1 (`rust-toolchain.toml`; rustup picks it up). Every crate is pinned
exactly (`=x.y.z`) and `Cargo.lock` is committed: tauri 2.12.5, tauri-build
2.7.4, tauri-plugin-opener 2.7.2, tauri-plugin-deep-link 2.6.2,
tauri-plugin-single-instance 2.5.4 (`rust-ini` is held at 0.21.1 in
`Cargo.lock`: the deep-link plugin does not build on Linux with 0.21.3), serde 1.0.229, serde_json 1.0.154, ureq
3.5.0 (rustls only, no cookie store), uuid 1.29.0, url 2.5.8, keyring-core
1.0.1, apple-native-keyring-store 1.0.2 (macOS), zbus-secret-service-keyring-store
1.0.1 (Linux), and for the native alert and the macOS version check the
versions wry already uses: objc2 0.6.5, objc2-foundation 0.3.2,
objc2-app-kit 0.3.2 with NSAlert only (macOS), gtk 0.18.2 (Linux).

The shell's own two requests (the appearance for env.js, the version probe)
check TLS against the OS trust store through ureq's `platform-verifier`
feature (rustls-platform-verifier 0.7.1, locked in `Cargo.lock`), so a brain
on a private CA the computer trusts works for them as it does for WebKit.

**Accepted advisory:** glib (RUSTSEC-2024-0429) comes in with Tauri's GTK 3
stack on Linux (gtk 0.18, webkit2gtk). It is not used directly here, and it
cannot be moved off without leaving Tauri 2's Linux webview; it is accepted
as a Tauri-on-Linux dependency until Tauri moves to GTK 4.

## Build

The export must exist before any build (it is embedded, in dev builds too):

```sh
pnpm -C client/web build
cd client/tauri
cargo test                  # unit tests, the shared host cases, the ACL test
scripts/build.sh            # the release build (below)
```

On macOS, `scripts/build.sh` builds the app bundle with tauri-cli 2.12.4
(`cargo install tauri-cli --version '=2.12.4' --locked`), unsigned:
`open target/release/bundle/macos/MantleOS.app`. macOS takes the name in
the menu bar and the Dock icon from the bundle; a bare binary shows its file
name and no icon. `icons/icon.icns` is made from the Electron shell's
1024-pixel icon (`client/desktop/build/icon.png`) with `sips` and
`iconutil`.

On Linux, `scripts/build.sh` builds the binary alone:
`./target/release/mantle-desktop`. Install the WebKitGTK 4.1 and GTK 3
development packages first (Debian and Ubuntu: `libwebkit2gtk-4.1-dev`,
`libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `libssl-dev`,
`build-essential`, `pkg-config`), and a Secret Service (GNOME Keyring,
KeePassXC) for the vault.

`MANTLE_DESKTOP_TRACE=1` prints a line per scheme request (with the CSP and
env.js it served), per vault call (its op and status) and per keychain
failure to stderr. Never a token.

The Linux image (`docker/linux.Dockerfile`) installs rustup-init at a pinned
version with its sha256 checked, and runs the scripted sign-in test
(`e2e/`), which reads the vault through the page's own `tokenVault`. One
step reads it from `/invite`, a link-code page served with
`Referrer-Policy: no-referrer`, where an invite sign-in keeps its bearer,
and prints the `Origin` the shell saw (WebKitGTK sends the UI's). Its
last step runs with no Secret Service: the notice shows once and its OK
closes it, a sign-in works for that run with the bearer in no file and not
in localStorage, and the next run is back on `/login`.

## Known

- **A Secret Service that asks to be unlocked holds up the vault** (Linux).
  Keychain calls run under the vault's one lock, so while GNOME Keyring or
  KeePassXC waits for its unlock prompt, every vault call, in every brain
  window, waits with it (each page's synchronous `tokenVault` call blocks
  that page) until the prompt is answered. The read that checks the
  keychain at start (`Vault::new`) runs on the main thread, before the
  first window, so a prompt there holds the start until it is answered.
  A macOS keychain prompt (a locked keychain, or an access prompt after the
  app's signature changed) holds the vault the same way.

## What T1 leaves for T2

- Deep links (`mantle://`) other than a company sign-in's: `deep_link_to_path`
  and `in_app_url` are ported with Electron's rules but not wired.
- Notifications, the dock badge and `attention`: `notify` and `setBadge` are
  no-ops.
- Downloads (WebKit cancels them without a download handler), the tray,
  updates, signing, installers and the Linux bundles, "add a login for another
  brain" (`brains.openForLogin`), permission prompts (the microphone).
- The sub-frame fence: wry asks the navigation handler for every frame
  without saying which, so the brain origin is allowed for its frames (the
  main frame is sent back by the page-load guard). Electron's rule that an
  app frame stays on its own frame documents (`frameNavigationAllowed`)
  needs the frame's own URL, which wry does not give. On Linux the same
  holds for IPC, which carries the main frame's URL; the vault no longer
  uses IPC, and its endpoint tells frames apart by the `Origin` WebKit sets.
