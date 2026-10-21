# MantleOS Desktop

<img src="client/web/public/brand/mantleos-logo.svg" alt="MantleOS" height="48">

**MantleOS. The operations system, from one person to a whole enterprise.**
This repo is MantleOS Desktop: the web + desktop interface for MantleOS
brains (the server lives in
[crossworks-engineering/mantle](https://github.com/crossworks-engineering/mantle)).

> **One brand.** Until 2026-10-17 this app was called Jackdaw and the engine
> Mantle. Both are now MantleOS: what you see and click, on the web and the
> desktop, is MantleOS Desktop; the memory, the agents and the API underneath
> are the MantleOS brain. Engine-level names keep the word `mantle`
> (`MANTLE_*` variables, `@mantle/*` and `@crossworks/*` packages, `mantle_*`
> containers). The repo was renamed from `jackdaw` to `mantle-client` on
> 2026-10-21; the old GitHub address redirects here.

MantleOS Desktop is a zero-secret client: it holds no database, no session secret, and
no server code. Every byte of data comes from a MantleOS brain's HTTP API
(bearer + CORS), configured by a single value, the server origin. One running
MantleOS Desktop can connect to any brain. The desktop shell already keeps a list of
brains (a profile and session partition each, with a switcher in the tray);
the web client is single-origin, and a brain switcher there is roadmap.

## Run the web client next to your brain

You normally do not install this by hand. The MantleOS installer brings the web
client up beside the server stack as a second compose project, `mantle-client`,
from `docker-compose.client.yml` in the mantle deploy bundle (the same file is
at the root of this repo). It is one container, the image
`titanwest/mantle-client:<tag>`, which joins the server stack's network
(`mantle_default`) so the server's Caddy can front it. The only configuration
it takes is the server's public origin, `MANTLE_SERVER_ORIGIN`, read from the
stack's `.env`.

```sh
# from the mantle stack directory, next to the server's .env
docker compose -f docker-compose.client.yml up -d

# on a separate box, with its own Caddy front door
docker compose -f docker-compose.client.yml --profile standalone up -d
```

Which tag runs is decided by the server. Each mantle release records the
mantle-client tag it was tested with in `client-pair.tag` at the root of the mantle
repo, and the updater rolls the client to that tag when it rolls the server,
recording what it set in `data/update-signal/client-tag.auto`. To pin a tag by
hand, set `MANTLE_CLIENT_IMAGE_TAG` in the stack `.env`; a value the updater
did not write is treated as your pin and left alone. Note that rolling the
server stack with a bare `docker compose up -d` never loads this file, so the
client does not move with it.

## Get the desktop app

Installers are on the
[Releases page](https://github.com/crossworks-engineering/mantle-client/releases).
Each release carries one asset per platform:

- Linux: `.deb` (amd64) and `.AppImage` (x86_64)
- macOS: `.dmg` and `.zip` (Apple Silicon, arm64)
- Windows: `Setup.exe`

macOS builds are unsigned: on first launch, right-click the app and choose
Open. Being unsigned, the app cannot update itself on macOS; fetch the next
release by hand. On Linux and Windows it checks Releases on launch and every 4
hours, downloads in the background, and installs when you quit.

On first launch the connect screen asks for your brain's URL and probes
`GET /api/version` before saving it. Then log in as usual; each brain keeps its
own login. Details in `client/desktop/README.md`.

**Version pairing.** Client and server release on separate streams (mantle-client
v0.7.x, mantle v0.232.x). Which client goes with which server is recorded on
the mantle side: `client-pair.tag` names the mantle-client tag that mantle release
was tested with (for example mantle v0.232.188 pairs with v0.6.110). Run the web
image at that tag; the desktop build of the same version pairs the same way.

## Develop it

Node 26 or newer and pnpm 11.1.2 (`packageManager` in `package.json`). The
client has no brain of its own, so development means pointing it at a deployed
one:

```sh
pnpm install
pnpm dev:fe       # owner UI on :3000 against MANTLE_REMOTE
pnpm verify       # typecheck + lint + format + tests
```

`pnpm dev:fe` reads one line from `client/web/.env.detached.local`
(git-ignored) and exports it as `MANTLE_SERVER_ORIGIN`:

```
MANTLE_REMOTE=https://brain.example.com
```

The brain must list your dev origin in `MANTLE_API_CORS_ORIGINS` (for example
`http://localhost:3000`); the wildcard is refused on `/api/auth/**`, so the
explicit origin is required. Setup and troubleshooting: `docs/db-less-dev.md`.

`pnpm dev` on its own is bare `next dev` with no brain configured: the shell
renders and every data fetch fails. The Electron shell has its own dev loop,
see `client/desktop/README.md`.

## Layout

- `client/web`: the owner UI (Next.js). `pnpm dev:fe` runs it against the
  brain named by `MANTLE_REMOTE` (see `docs/db-less-dev.md`).
- `client/desktop`: the Electron shell wrapping the same UI.
- `packages/web-ui`: the UI kit (components, providers, hooks).
- `e2e`: the UI end-to-end suite (drives a running brain).

The wire contract is consumed from npm, published by the mantle repo on every
release: `@crossworks/{client-types,content-core,voice-client,share-ui}`.
Workspace imports keep the `@mantle/*` names; pnpm overrides map them to the
published packages. Those overrides live in `pnpm-workspace.yaml`, not in
`package.json#pnpm`: pnpm 11 reads its settings from the workspace file and
silently ignores that field.

History note: this repo was extracted from the mantle monorepo on 2026-08-13
(`git filter-repo`), preserving the full commit history of every file it
carries. The split plan lives in mantle's `docs/plans/jackdaw-repo-split.md`.
