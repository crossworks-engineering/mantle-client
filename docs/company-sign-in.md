# Company sign-in in the client

The client's screens for company sign-in (OIDC). The contract is the brain's:
`docs/oidc-sign-in.md` in the mantle repo. With the mode off, or on a brain from
before it, nothing here shows, and the sign-in screen stays as it was.

## Where each thing is

| What the person sees                                        | Code                                                                       |
| ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| "Sign in with {label}" beside the password form             | `client/web/app/login/login-client.tsx`, `components/oidc/`                |
| The one dismissible offer card                              | `components/oidc/offer-card.tsx`, in the shell's bottom-right stack        |
| Settings > Profile; the account menu with no Profile screen | `components/oidc/company-sign-in-section.tsx`                              |
| Required mode: the one link step                            | `components/oidc/link-step.tsx`: at sign-in, invite, and `link-gate.tsx`   |
| A fresh sign-in in place of the password for a key          | `components/api-access/api-access-client.tsx`                              |
| The page every flow ends on                                 | `client/web/app/auth/oidc/`                                                |
| The setup screen, Admin > Company sign-in                   | `client/web/app/(app)/admin/company-sign-in/`, `lib/sso-setup.ts`          |

The MCP consent page is the brain's own page: its Confirm button runs the fresh
sign-in itself. The client only brings the person back to it after a sign-in
(`lib/oauth-consent.ts`).

## The setup screen

A client's Microsoft admin enters the client secret on this screen while the
box's `MANTLE_OIDC_MODE` is `setup`. On a Control Center the screen also makes
the SCIM token: SCIM runs on a Control Center only (owner, 2026-11-09), and the
screen knows one by `GET /api/fleet` (200 on a Control Center, 404 elsewhere).
Off one, the SCIM URL, the SCIM token and the provisioning steps do not show.
The contract and every stated cost are the brain's: "The setup screen" in
`docs/oidc-sign-in.md` in the mantle repo.

The screen is at Admin > Company sign-in (`/admin/company-sign-in`) since
2026-11-09. The old path, `/settings/company-sign-in`, redirects there. On a
Control Center the Admin group also holds Fleet (`/admin/fleet`,
`lib/fleet.ts`): the boxes, the fleet bans, the provider keys and the fleet
matrix (`lib/fleet-matrix.ts`; `docs/control-center.md` in the mantle repo).

- The sidebar offers the entry only to a login with the users area, while
  `GET /api/users/sso-setup` answers a mode other than `off`. The search palette
  offers it the same way. A brain before the screen answers 405, because the path
  matches `/api/users/:id`, or 404: both read as off.
- While the window is open, the brain refuses a company session with a 401. This
  client then clears its bearer and goes to `/login`, on the web and in a desktop
  app. So a person whose app made a call in the window signs in again after it,
  though the brain never ended that session. A person who holds only a company
  sign-in sees no company button in the window: it is off.
- `setup`: a warning, a password field for the secret that stays empty after a
  save, Save and Make SCIM token, which each ask for the password, and Test.
- `optional`, `required`: the same values read-only, and "Locked by the box
  operator."
- A value the box `.env` holds reads so, and offers no write.
- The token shows once, in this screen's state only. It is never kept in the
  query cache, and a reload or leaving the screen loses it. A failed status read does not take it away.
- A refusal that says the screen is out of date (`setup-closed`, `env-wins`) reads
  the status again, so the screen shows the lock or the `.env` value.
- The secret field asks `autoComplete="new-password"`, not `off`, so a browser does
  not fill the admin's own password into it.

The types in `lib/sso-setup.ts` mirror the brain's DTOs. Replace them with
`@mantle/client-types` when the next contract is published.

## One way back

Every flow is handed to the client (PKCE between the client and the brain) and
ends on `/auth/oidc`, in a browser and in a desktop shell alike:

1. The client makes a verifier and keeps it, with what the flow is for, in this
   tab's sessionStorage (`lib/oidc/flow.ts`).
2. The person goes to the provider: the same tab on the web, the system browser
   from a desktop shell.
3. The flow comes back with a one-time code in the fragment: `<origin>/auth/oidc`
   on the web, `mantle://oidc` to a desktop shell. The shell keeps only the fields
   the flow's end can hold, and loads them on the brain window's `/auth/oidc`.
4. An inline script takes the code out of the address before anything else loads
   (`lib/link-code.ts`). The page then decides (`decideArrival`): the `iss` must
   be the origin this page connected to, a flow must be waiting, and for the same
   purpose. Anything else spends nothing.
5. A sign-in's or a link's code is spent at `POST /api/auth/oidc/exchange`. A fresh
   code goes back to the screen that asked, in the one request it confirms.

A screen that leaves for a fresh sign-in leaves its form in the same storage, with
no password in it, and comes back to it.

## What the client never decides

Which password rule holds, whether a change is due, and whether a login may unlink
are the brain's answers (`GET /api/auth/oidc/status`, `GET /api/auth/whoami`). The
client has no forced change-password screen yet (the brain's Phase 1 step), so nothing
reads `mustChangePassword` today; that screen must follow it, for the request's own
credential. There is one thing it reads for itself: the
account menu offers no "Change password" from a session company sign-in made, read from
the bearer's own `so` claim, since a change would end that session. That decides only
what the menu offers; the brain still judges every request. The status does not say how
a session signed in, so this stays here until it does.

## Limits to know

- A web flow's way back is this tab. A provider step that opens another tab (an
  email link) ends with "This sign-in has ended", so a provider used here must
  finish its sign-in in the tab it began in.
- Any app can open a `mantle://oidc` link. While a window waits, a link naming its
  brain ends that wait (the person starts again; a code it carries is spent with the
  waiting verifier and refused), and a link naming a brain the shell does not hold
  reloads the window on that page, whose unsaved typing may go. Nothing leaks and no
  session results. Outside a wait, links move nothing.
- One flow at a time in a window. Starting a second replaces the first, and the first's
  way back then ends the wait with "This sign-in has ended". Start again.
- `mantle://` belongs to whichever app the system picked. With both desktop apps
  installed, a flow started in one can come back to the other, which spends nothing
  and drops it. Install one.
- Any app can open a `mantle://oidc` link, so a window takes one only while it waits
  for its own sign-in. Someone who holds a waiting flow's start URL (a proxy log, a
  synced browser history), and gets the person to click a link of theirs in that
  time, could finish that flow with their own provider account. The person is told
  of a link made, and it is audited. A web tab is harder to reach (the crafted link
  must land in the very tab that waits) but it is the same limit.

## The desktop shells

`window.mantleDesktop.oidc.open(url)` opens a sign-in in the system browser. Each
shell takes only this brain's `/api/auth/oidc/start`, whatever the page asks
(`oidcStartUrl` in `client/desktop/src/main/brain-fence.ts`, `oidc_start_url` in
`client/tauri/src/fence.rs`). A shell without it shows "Update this app" instead of
the button. A window takes a `mantle://oidc` link only once it has sent a sign-in out,
within 15 minutes (`oidcArrival`); any other link moves nothing. A fresh sign-in the
person walks away from (Stop, Cancel, "Use my password instead", "Not now", a password
sign-in, a sign-out or a switch of login) ends the wait. Only leaving the screen does
not: it ends on its own after 15 minutes. `link-gate.tsx` is a
backstop: the brain holds such a session, so a person normally meets the link step at
sign-in.
