# Company sign-in in the client

The client's screens for company sign-in (OIDC). The contract is the brain's:
`docs/oidc-sign-in.md` in the mantle repo. With the mode off, or on a brain from
before it, nothing here shows, and the sign-in screen stays as it was.

## Where each thing is

| What the person sees                                        | Code                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| "Sign in with {label}" beside the password form             | `client/web/app/login/login-client.tsx`, `components/oidc/`              |
| The one dismissible offer card                              | `components/oidc/offer-card.tsx`, in the shell's bottom-right stack      |
| Settings > Profile; the account menu with no Profile screen | `components/oidc/company-sign-in-section.tsx`                            |
| Required mode: the one link step                            | `components/oidc/link-step.tsx`: at sign-in, invite, and `link-gate.tsx` |
| A fresh sign-in in place of the password for a key          | `components/api-access/api-access-client.tsx`                            |
| The page every flow ends on                                 | `client/web/app/auth/oidc/`                                              |

The MCP consent page is the brain's own page: its Confirm button runs the fresh
sign-in itself. The client only brings the person back to it after a sign-in
(`lib/oauth-consent.ts`).

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
client reads them for the request's own credential and works out nothing from how a
session signed in. So an SSO session whose password is no way in is never asked to
change it.

## Limits to know

- A web flow's way back is this tab. A provider step that opens another tab (an
  email link) ends with "This sign-in has ended", so a provider used here must
  finish its sign-in in the tab it began in.
- `mantle://` belongs to whichever app the system picked. With both desktop apps
  installed, a flow started in one can come back to the other, which spends nothing
  and drops it. Install one.
- Any app can open a `mantle://oidc` link, so a window takes one only while it waits
  for its own sign-in. Someone who holds a waiting flow's start URL (a proxy log, a
  synced browser history), and gets the person to click a link of theirs in that
  time, could finish that flow with their own provider account. The person is told
  of a link made, it is audited, and web tabs cannot be reached this way.

## The desktop shells

`window.mantleDesktop.oidc.open(url)` opens a sign-in in the system browser. Each
shell takes only this brain's `/api/auth/oidc/start`, whatever the page asks
(`oidcStartUrl` in `client/desktop/src/main/brain-fence.ts`, `oidc_start_url` in
`client/tauri/src/fence.rs`). A shell without it shows "Update this app" instead of
the button. A window takes a `mantle://oidc` link only once it has sent a sign-in out,
once, within 15 minutes (`oidcArrivalProfile`); any other link moves nothing. A fresh
sign-in the person walks away from clears what waits (the dialog's Cancel).
