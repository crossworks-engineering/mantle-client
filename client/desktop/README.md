# MantleOS Desktop: the desktop app

Electron shell around the owner UI. The original design and phasing plan
predates the 2026-08-13 repo split and is no longer carried as a document;
this README is the current reference.

The shell ships the connect screen, per-brain session partitions, the
native-parity CORS fencing, and an **embedded copy of the built owner UI** —
the standalone `next build` of `client/web`, run as a `utilityProcess` on a
sticky loopback port (sticky because localStorage — and the bearer in it — is
origin-scoped; a changing port would log everyone out).

## Run it

```sh
pnpm -C client/desktop build:ui   # build client/web standalone → client/desktop/ui/
pnpm -C client/desktop dev        # the Electron shell
```

The connect screen asks for your brain's URL (probes `GET /api/version` before
saving), then the window loads the UI pointed at that brain — log in as usual;
the bearer lands in the profile's own persisted session partition, so each
brain keeps its own login and a relaunch goes straight back in.

For UI iteration without rebuilding, `MANTLE_DESKTOP_RENDERER_URL` points the
shell at a `client/web` dev server instead of the embedded copy
(e.g. `pnpm dev:fe -- --port 3001`, then set it to `http://localhost:3001`).

## Packaging

```sh
pnpm -C client/desktop build:ui   # always first — the package embeds ui/
pnpm -C client/desktop dist       # AppImage + deb on Linux; dmg/zip on mac; nsis on Windows
```

CI (`.github/workflows/desktop.yml`) builds all three OSes on the same `v*`
tags as the image release and uploads installers to a **draft** GitHub
release — publishing stays a human act. Auto-update (electron-updater) checks
the published releases, downloads in the background, notifies once, and
installs on quit — never a surprise restart.

### macOS signing

CI picks the mode from the repository secrets:

| Secrets present | Result on a downloaded Mac build |
| --- | --- |
| none (branch or manual build only; a tag build FAILS if any of the five is missing) | **Ad-hoc** signed. macOS says it cannot verify the developer; the user opens it once with System Settings > Privacy & Security > Open Anyway. No self-update. |
| `CSC_LINK` + `CSC_KEY_PASSWORD` + the three `APPLE_API_*` | **Developer ID** signed, hardened runtime, notarized and stapled. Opens with no warning; electron-updater self-updates. |

| Secret | What it holds |
| --- | --- |
| `CSC_LINK` | The "Developer ID Application" certificate with its private key, exported as `.p12`, then base64 (`base64 -i cert.p12 \| pbcopy`). |
| `CSC_KEY_PASSWORD` | The password set on that `.p12` export. |
| `APPLE_API_KEY` | The full text of an App Store Connect API key (`AuthKey_<id>.p8`). A Team key with the Developer role or higher. |
| `APPLE_API_KEY_ID` | That key's Key ID. |
| `APPLE_API_ISSUER` | The Issuer ID shown above the key list in App Store Connect. |

Never commit any of these or paste them into a log. The `Verify macOS
signature` step fails the job when the bundle's seal is broken, and on a
Developer ID build also runs `spctl` and `xcrun stapler validate`.

Builds up to v0.6.251 had no signing step at all. The bundle kept Electron's
linker-signed stub, and macOS reported the quarantined download as
"damaged", with no Open Anyway button. Users of those builds can clear the
flag with `xattr -dr com.apple.quarantine /Applications/Jackdaw.app`.

`pnpm dist` on a Mac signs with whatever identity the keychain offers;
`-c.mac.identity=- -c.mac.hardenedRuntime=false -c.mac.notarize=false`
reproduces the CI ad-hoc build.

## Desktop integration

- **Deep links**: `mantle://n/<id>` (or any `mantle://<path>`) opens the
  in-app route in the current/last-used brain window.
- **Notifications**: the UI's `DesktopBridge`
  (`client/web/components/desktop/desktop-bridge.tsx`) feature-detects
  `window.mantleDesktop` and forwards assistant outbound pings
  (`/api/assistant/stream`) to OS notifications while the window is hidden.
  Clicking one focuses the app.
- **Tray**: open / switch brain / quit. A badge API (`setBadge`) is exposed
  for later wiring.

## What the shell does (and doesn't)

- **Native-parity CORS fencing**, scoped to the configured brain origin only:
  outgoing `Origin` dropped (a native client sends none — same stance as the
  mobile companion), ACAO injected on responses so the embedded renderer
  accepts them. No server-side CORS setup needed on any box.
- **`window.__MANTLE_ENV__` injection** via preload (read-only), with the dev
  server's `/env.js` neutralized so the user's chosen brain always wins.
- **No secrets in the shell config.** The server URL list (`profiles.json`
  in userData) is plain config; bearers live in the **token vault**
  (`src/main/vault.ts`): OS-keychain-encrypted files (Electron `safeStorage`),
  the same at-rest posture as the mobile companion's Keychain. One file per
  login held for a brain (`vault/<profileId>/<sessionId>.tok`), so a brain
  window can hold several logins and switch between them. A window reaches
  only its own brain's files, and the session id, which comes from the page,
  is validated before it is used in a path. The one-slot file earlier builds
  wrote (`vault/<profileId>.tok`) is adopted into a login by a rename on the
  first run after the update, so updating signs nobody out. The UI's
  token-store feature-detects the vault and also moves a pre-vault
  localStorage bearer into it on first read.
- **One window per brain**, listed in the tray and the Brain menu, most
  recently used first. Logins WITHIN a brain are switched inside its window
  (the profile menu); the shell knows brains, the page knows logins.
- External links (share links, docs) open in the system browser.
- Every login signs in here with its password: there is no client login and
  no sign-in by email code (workspaces W8).

## Media permissions

The shell registers no permission handler today (no
`setPermissionRequestHandler` or `setPermissionCheckHandler` on the session),
so microphone and camera prompts follow Electron's defaults: a packaged
Electron app grants renderer permission requests unless a handler denies
them, and the OS-level prompt (macOS microphone access, for example) is
whatever the platform does. The Developer ID build runs under the hardened
runtime, so `build/entitlements.mac.plist` carries the microphone and camera
entitlements; without them macOS blocks the device even after the user says
yes. This has not been verified
in the packaged app; treat voice capture on desktop as untested until it is.

## The app icon

`build/icon.png` (electron-builder's source for .icns/.ico) and
`resources/icon.png` (the Tray and Notification image) are the same committed
1024² file: the MantleOS sun icon on brand cream `#FDE7BC` (not brown: the
icon's deep rust rim disappears on brown). There is no generator; it is
rendered from the SVG when the mark changes. The SVG is
`client/web/public/brand/mantleos-icon.svg`, a copy of the mantle repo's
`brand/mantle-sun-icon.svg`. Render it with any SVG rasteriser (resvg,
rsvg-convert, a browser), never by upscaling a PNG:

```bash
# 881 px badge, centred on a 1024² cream square (86% coverage, as before).
resvg -w 881 client/web/public/brand/mantleos-icon.svg /tmp/badge.png
magick -size 1024x1024 xc:'#FDE7BC' /tmp/badge.png -gravity center -composite \
  -alpha off client/desktop/build/icon.png
cp client/desktop/build/icon.png client/desktop/resources/icon.png
```

The sun badge is opaque, so it needs none of the backing disc the old
Jackdaw bird badge did. MantleOS mobile composes its icon from the same mark;
see that repo's `tool/generate_app_icon.dart` and `branding/README.md`.

## Names that still say Jackdaw, on purpose

The 2026-10-17 rename to MantleOS Desktop changed what a user reads (window
and dialog titles, tray tooltip, notifications, the connect screen, the Linux
synopsis). These stay as they were until a migration is planned and one
auto-update has been tested on an installed app:

- `appId: engineering.crossworks.jackdaw`: the macOS bundle id and the
  Windows install identity. Changing it makes the update a different app.
- `productName: Jackdaw` (here and in `package.json`): Electron derives the
  `userData` folder (profiles, `shell.json`, the token vault) and, on macOS,
  the `safeStorage` keychain entry from it. A new name starts with an empty
  folder and cannot decrypt the old vault: every saved brain and login would
  be lost. Renaming needs `app.setPath('userData', …)` pinned to the old
  folder plus a keychain plan, tested on a real install.
- `publish.repo: jackdaw`: the electron-updater feed. Installed apps look
  there; GitHub redirects a renamed repo, but test one update after the
  `jackdaw` → `mantle-client` rename before trusting it.
- `linux.executableName` / `artifactName` (`jackdaw-…`): file names the
  update metadata and existing installs refer to.
- The `X-Jackdaw-Brain` request headers, which the web build reads too.
