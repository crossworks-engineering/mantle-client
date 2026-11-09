# e2e — the split's regression net

Playwright suite that drives a LIVE stack end-to-end. Written before the
server/client split (v0.200.0) so every phase of it lands against a green net.
One spec set, two topologies:

| Project       | Meaning                                                                                       | When it runs                                                          |
| ------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `same-origin` | client and server are one origin (the monolith, or the server app's own share/print surfaces) | CI on every PR + locally                                              |
| `split`       | client (owner UI) on its own origin, server on the canonical origin                           | gate for Phase 4+; auto-skipped while `E2E_CLIENT_URL` is unset/equal |

Specs: auth, pages CRUD, realtime SSE, `?at=` asset tokens, public share,
PDF export, the brain's `/app-runtime` CORS, the editor header, `/tasks`
behaviour, the resizable shell, and the shared field primitives. The team-code
portal's specs went with the portal (member logins Phase 6); the Team admin and
member login specs went with Team admin and the member shell (phase W5c).
Fixtures make
specs topology-blind — same-origin auth is the session cookie, split auth is the
kind-`'m'` bearer (localStorage contract in `lib/contract.ts`).

⚠ **Never assert a transition from `getComputedStyle`.** Playwright injects
`*, ::before, ::after { transition: none !important }` into the page, so every
computed `transition-property` reads `none` under test and such an assertion
passes whatever the app does. Read the authored rules out of `document
.styleSheets` instead — `shell-layout.spec.ts` does, and the comment there
explains why.

## The workspace specs (`pnpm e2e:workspace`): no brain needed

`e2e/workspace/` holds specs for the one shell every login uses (phase W5c)
that run against an in-memory brain the spec starts in its own process
(`workspace/mock-workspace-api.ts`), not against a real one. Its own config,
`playwright.workspace.config.ts`, starts `next dev` for this checkout on
`:3921` with `MANTLE_SERVER_ORIGIN` pointed at the mock on `:3922`; nothing
else is needed. Stop a `next dev` running in `client/web` first (Next allows
one per directory). `E2E_BROWSER_CHANNEL=chrome` drives the installed Chrome
when Playwright's bundled browser is not downloaded. `E2E_WORKSPACE_PORT` and
`E2E_WORKSPACE_API_PORT` move the two ports when another run holds them.

Every spec signs in through the real `/login` form: the password goes to the
mock's `POST /api/auth/token`, which answers one bearer per login (an admin
and a member, one test password; no client login since W8). The mock answers `GET /api/shell`
for each the way a W6b brain does (`role`, `loginId`, `workspaces`, `areas`,
`treeKinds`; the member's private workspace is "Mo Member (only you)",
marked `private: true`), the owner tree and page routes every login's Pages
screen reads in its own scope (each row and page with the caller's item caps:
`mayEdit`, `mayManage`, and `readOnly` with `snapshotOf` on the member's
snapshot copy), a file's detail and a `/n` node lookup,
`POST /api/pages` with the `?ws=` rules (a Moderator's workspace, else the
private one; 403 for a workspace the login is not in), and the few owner
routes the admin's Users screen reads. It refuses a member every
owner route the brain did not open to it (`MEMBER_OPEN` in shell-nav.ts),
answers the retired routes 410, and records every request with the login
that sent it, so a spec can assert what a login never asked for. Anything
else is a plain 404.

- `member-shell.spec.ts`: the rail with the work screens and Workspaces and no
  Admin rows; a switcher with exactly the member's workspaces, its private one
  as Only you; Pages with only the items of those workspaces, read from the
  owner routes the brain opened to it and never a retired route; a new page
  in the private workspace and in Team (as a Moderator), and a refusal in a
  workspace the member is no longer in; the item caps (a Team page moves and
  deletes, a read page and a snapshot copy show no Move, the read page no
  Edit or Delete); a `/n` link to a file opens it in its folder from
  `GET /api/files/files/:id`; a typed admin screen says "You cannot manage
  this part of the brain."; `/review` and `/team-admin` land on the home.
- `company-sign-in.spec.ts`: Admin > Company sign-in in each mode: the secret
  in `setup`, the SCIM token on a Control Center only, the lock, the `.env`
  values, the refusals, a brain before the screen, the search palette, the
  redirect from the old Settings path (`mock-sso-setup.ts`).
- `fleet.spec.ts`: Admin > Fleet on a Control Center only: the boxes, a ban
  previewed then made, Lift and Retire, an owner match; phase 2's provider
  key on one or many boxes (each box's answer, never the key); and on Users,
  the Archived list, Enable on an archived login, and Disable again
  (`mock-fleet.ts`).
- `admin-shell.spec.ts`: the full nav with Settings > Users, the owner Pages
  screen (every page of the brain) and the Users screen (no sign-in by email
  code and no client login since W8).
- `admin-switcher.spec.ts`: an Admin user who is also in Team switches to
  Team and back; the switcher's label, the Pages list's `?ws=` and a new
  page's `?ws=` follow each pick, also with the browser's storage full (the
  pick then holds for the page); and on Pages, Notes, Files and Apps a pick
  loads the list again with the new `?ws=` and shows only that workspace's
  items (the mock holds one item in Admin and one in Team per list).
  Only the storage-full case guards the fix in `lib/workspace-current.ts`;
  the others pass with or without it.
- `retired-links.spec.ts`: old portal links (`/team`, `/hub`, `/client-signin`)
  land on a bare `/login`; old review links land on the home.
- `lessons.spec.ts`: a lesson from the pages tree's Lessons folder plays
  with the agent's hands: from the profile menu, step by step, a settings
  step done as the user would; a `?lesson=` link only offers one, and a
  page outside the folder is refused.
- `login-brains.spec.ts`: the sign-in screen against more than one brain (the
  desktop shell's per-window brain header) and after every way a sign-in fails.
- `landing.spec.ts`: Home shows the current workspace's landing page and
  changes with the switcher (the Desk, or the workspace's home app); "All my
  workspaces" shows all of them; an Admin user finds the Dashboard in the menu.
- `agent-calls.spec.ts`: an in-app agent's ui calls reach this window
  (played through the dev build's `window.__mantleAgentCalls`): off by
  default, the profile menu's opt-in, the first call asks the user, allowed
  calls answer with this window's id, a turn asks once before it clicks or
  types (Not now refuses the rest of it), and its writes go as the user's
  own; a member turns it on too, and its window answers its own agent.
- `agent-hands.spec.ts`: an agent driving the window (lib/agent-ui, through
  the dev build's `window.__mantleAgentHands`): the screen read as labelled
  controls, typing and clicking, Stop, a settings change made as the user
  would, a route with a query refused, and a real click pausing it.
- `area-capture.spec.ts`: the rail's area capture (the desktop capture
  stubbed): drag an area, see it, then Attach to chat (an Admin user) or
  Save (a member, no attach); Esc saves nothing, and the save never names
  the switcher's workspace (`POST /api/screenshots`).
- `desk.spec.ts`: the Desk saved on the login's profile (`GET`/`PUT
/api/profile/home-desk`, compare-and-set on a version): a change is saved
  once, read back after a reload, and when another device saved first its
  desk shows with one quiet toast.
- `sounds.spec.ts`: a change to the UI sounds is saved at once
  (`PUT /api/profile/sounds`) and names the login the tab shows (`loginId`).
- `desk-theme.spec.ts`: the Desk's Theme card picks the colour theme from a
  menu that opens on the worn theme, by keyboard.
- `desk-quick-task.spec.ts`: the Desk's Quick task adds a task (first line
  the title, the rest the body) in the workspace the switcher shows, and is
  offered only to a login that has Tasks (`tasksKind` turns them on).
- `tables-import.spec.ts`: Import on the Tables screen takes the three types
  and refuses another, opens the new table in the workspace picked, shows the
  brain's words for a refusal and says a brain with no such route needs an
  update; the upload dock's line for a spreadsheet shows only when the shell
  says `noAutoTables`.
- `tree-tabs.spec.ts`: the tree's view tabs (Folders, Recent, Most used,
  A to Z) fold to icons, each named by its label, when the list is dragged
  narrow, and never overlap, at the smallest, default and largest font size.

CI runs them on every push and pull request (the `e2e-workspace` job in
`.github/workflows/verify.yml`), with no brain and nothing configured.

## The route coverage gate (`pnpm e2e:routes`)

A different instrument from the suite: `e2e/check-routes.mjs` derives every
screen from `client/web/app`, opens each one in a real browser against a
deployment you name, and fails on anything that does not actually render —
an unresolved React placeholder, an empty `<main>`, a 5xx behind a tidy empty
state, a bounce to `/login`. GET-only, so it is safe against a brain people
rely on and against a read-only edge. It came from the mantle demo branch,
where its fixture-driven predecessor had shipped 85 blank screens; it lives
here because the route list has to be derived from the screens beside it.

```sh
pnpm e2e:routes -- https://demo.example                 # the target admits visitors (demo edge)
ROUTES_BEARER=<owner token> pnpm e2e:routes -- https://app.example   # split topology: seeds the bearer + presence flag
ROUTES_ONLY=/journal,/traces pnpm e2e:routes -- …       # narrow the sweep
```

Dynamic segments are filled from read-only API fixtures (`FIXTURES` in the
script). A screen whose fixture is absent on that brain is reported SKIPPED,
never counted as a pass; a new dynamic screen with no fixture rule is named
so the gap is visible. `ROUTES_API_LOG=<path>` watches a local API log for
server-side errors the browser cannot see (the demo bench sets it).

## Run it

**You bring the brain.** This repo is the client: no server workspace, no
database, so nothing here can start one. The runner brings the owner UI from
this checkout, puts it on `:3901` in front of the brain you name, and runs the
suite against that pair.

```sh
E2E_SERVER_URL=https://brain.example pnpm e2e        # boot the UI → suite → stop
E2E_SERVER_URL=… pnpm e2e:up      # keep the UI up while iterating…
E2E_SERVER_URL=… pnpm e2e:test    # …re-run the suite against it
pnpm e2e:down                     # stop it
```

⚠ **The suite CREATES AND DELETES CONTENT** on whatever brain you name. Point
it at a throwaway one, never at a brain anyone relies on.

### No brain to point at? Build a throwaway one

The brain is a mantle checkout. This assumes mantle's dev sidecars are already
up (`mantle_dev_pg`, `mantle_dev_objectstore`); if they are not, `pnpm start` in
that repo brings them up. Everything here is deliberately beside the dev brain rather
than on top of it: its own database, its own bucket, its own port.

```sh
# in the mantle repo — a database and a bucket of its own
docker exec mantle_dev_pg psql -U postgres -d postgres -c 'CREATE DATABASE mantle_e2e;'
for f in infra/postgres/init/*.sql; do
  docker exec -i mantle_dev_pg psql -U postgres -d mantle_e2e -v ON_ERROR_STOP=1 < "$f"
done
# plain S3 calls against the dev RustFS; no `mc` (it went with MinIO)
S3_BUCKET=mantle-e2e pnpm -C packages/storage objectstore:ensure

export DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54323/mantle_e2e'
pnpm -C packages/db migrate
pnpm -C server/web pgboss:init

DATABASE_URL="$DATABASE_URL" S3_BUCKET=mantle-e2e PORT=3900 \
  NEXT_PUBLIC_APP_URL=http://localhost:3900 \
  MANTLE_API_CORS_ORIGINS=http://localhost:3901 \
  MANTLE_CLIENT_ORIGIN=http://localhost:3901 \
  pnpm -C server/web dev
```

Then, back here: `E2E_SERVER_URL=http://localhost:3900 pnpm e2e`. The brain has
no owner, so global-setup creates one through the real signup path.

Things that are easy to get wrong:

- **The init SQL must be applied by hand.** The Postgres image runs
  `/docker-entrypoint-initdb.d/*.sql` once, at first cluster init, for the
  DEFAULT database only. A new database on an existing cluster has no `vector`
  extension and no `auth.users`, and the migrations fail with a schema error
  that does not say so.
- **`pgboss:init` runs under `tsx --env-file-if-exists=./.env.local`**, and that
  file's `DATABASE_URL` points at the DEV brain. A shell variable does win — but
  confirm which database got the schema before starting anything that writes,
  because the thing you are about to point at it deletes content.
- **`MANTLE_API_CORS_ORIGINS` must name the client origin** (`:3901`), or every
  browser test fails on CORS while the API-only ones pass — a confusing split
  that looks like an auth bug.
- **`MANTLE_CLIENT_ORIGIN` should name it too**: it is where the brain sends
  the `/n/<id>` links it builds (they live in the client app). No spec depends
  on it any more; the `/team` redirect spec that did went with the retired
  team portal.
- **Do not bind the brain to `127.0.0.1`** (`HOST`). The PDF and drawing
  render sidecar (`mantle_dev_browser`) is a container, and it reaches the
  brain at `host.docker.internal:<PORT>`. On loopback only, `pdf-export` fails
  with a 500 and the draws `snapshot cache` spec gets a null SVG, both from
  `ERR_CONNECTION_REFUSED` in the brain's log. Leave `HOST` unset (the server
  defaults to `0.0.0.0`) and keep the port closed to the network.
- **Migrate and the server must use the same `MANTLE_MASTER_KEY`**, and it must
  be a base64 32-byte key (`openssl rand -base64 32`). The read-only database
  roles get their passwords from it at migrate time, and the first owner's
  onboarding seals a key with it: any other string fails global-setup with an
  onboarding 500 ("must decode to 32 bytes").

Tear down with `DROP DATABASE mantle_e2e`, then delete the `mantle-e2e` bucket in
the dev RustFS console (http://localhost:9001, `minio` / `minio12345`) or with
any S3 client pointed at `http://localhost:9000`.

That combination — owner UI on its own origin, brain on another — _is_ the
`split` topology, so `pnpm e2e` runs the `split` project. The `same-origin`
project means one origin serving both, which this repo cannot produce locally;
run it directly against a box deployed that way:

```sh
E2E_SERVER_URL=https://box.example.com \
E2E_EMAIL=owner@example.com E2E_PASSWORD=… pnpm -C e2e e2e:same
```

A brain with no owner yet bootstraps itself through the REAL first-run path:
signup → onboarding saveKey (dummy OpenRouter key — saved regardless of probe)
→ provision → finish. No DB backdoors; the integrity gates get exercised too.
On a brain that already has one, set `E2E_EMAIL` / `E2E_PASSWORD` to match.

`E2E_SKIP_PDF=1` skips the PDF spec on brains without the browserless sidecar.
`E2E_CLIENT_PORT` moves the owner UI off `:3901`. Before the suite, `up`
requests every static screen once, so `next dev` has compiled them all and no
spec races a first compile (a minute or two; `E2E_WARM=0` skips it).

The owner UI's own `next dev` log and pid file live outside the checkout, in
`${TMPDIR:-/tmp}/jackdaw-e2e-<port>/` (`client.log`, `client.pid`); a failed
`up` prints the tail of that log. Keep them out of the tree: every request
appends to the log, and a file that changes under `turbopack.root` can make
Next rebuild and reload the page, which makes another request.

### What used to be here, and where it is NOT

The runner used to boot a hermetic stack of its own: throwaway Postgres and
MinIO in Docker, `@mantle/db` migrations, pg-boss and the server app on `:3900`.
The split took it out of this repo, and the script kept calling four paths that
no longer exist — so the suite could not be started at all, which is how it
stayed broken quietly. `e2e/stack/docker-compose.yml` went the same way: it
mounted an `infra/` directory this repo does not have, and provisioned a
database for code that lives elsewhere now.

⚠️ **An earlier version of this file said that stack "moved to the mantle
repo". It did not.** Checked on 2026-09-15: mantle's `e2e/` holds
`node_modules`, `test-results` and a stale tsbuildinfo — no specs, no
`scripts/run-local.sh`, no compose file. The hermetic stack exists in NEITHER
repo, and the ports some notes still quote for it (55432 / 59000 / 59222) bind
nothing. If you go looking for it to save yourself the setup below, you will
lose an hour. Build the brain instead — the recipe is above and takes minutes.

Because nothing could run it, the suite quietly rotted: when it was first run
again on 2026-09-15 it was 135 of 161, and four of those failures were specs
that had broken the day a shell went translucent. Whatever else is true of this
directory, an e2e suite nobody can start is not a regression net.
