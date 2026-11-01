# Static UI: the host contract

The owner UI (`client/web`) builds to static files: `pnpm -C client/web build`
writes `client/web/out/`. No server renders it. A **host** serves those files
and does the few jobs a server used to do.

Hosts:

- the desktop shell, per brain window (Electron today, Tauri later):
  `client/desktop/src/main/static-host.ts`. It serves `http://mantle-ui.localhost`
  by intercepting http in each brain window's session, so nothing reaches the
  network. A real http origin, not a custom scheme: Chromium gives a custom
  scheme no cookies, and the login gate and layout state live in cookies.
- the box, per box (T0b: Caddy or the brain serves `out/`)
- e2e: `next dev` plays the host there (`app/env.js/route.ts` answers per
  request in dev), and specs answer `/env.js` themselves to stand in for a
  window's host. Only `next build` exports; `next dev` stays an ordinary dev
  server, because an export refuses every id it did not export.

The build hands every host what it needs in `out/_mantle/`, so no host keeps
its own copy of the policy, the routes or the theme tables:

| File                      | What it is                                                                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `out/_mantle/boot.js`     | The first-paint script. The UI loads it itself; a host only serves it.                                                                                      |
| `out/_mantle/csp.txt`     | The full Content-Security-Policy, with `{brain}` and `{brain_ws}` to fill. Generated from `lib/csp.ts`.                                                     |
| `out/_mantle/routes.json` | The dynamic routes (`/notes/[id]`), the placeholder value (`_`), and the no-referrer prefixes (`noReferrer`). Generated from `app/` and `lib/link-code.ts`. |

## 1. Serve the files, with the placeholder fallback

For a request path `P`, without its query:

1. Serve the first file that exists: `out/P`, `out/P.html`, `out/P/index.html`.
2. Else, if `P` matches a route in `routes.json`, put the placeholder in each
   dynamic segment and try step 1 again. A catch-all (`[...slug]`) takes the
   rest of the path as one `_`. Prefer the longest matching route.
   `/notes/abc123` serves `out/notes/_.html`.
3. Next's data files follow the same rule. Match on the path without the
   suffix, then put the suffix back:
   - `/notes/abc123.txt` serves `out/notes/_.txt`
   - `/notes/abc123/__next.<anything>.txt` serves `out/notes/_/__next.<anything>.txt`
4. Else serve `out/404.html` with status 404.

Never redirect to the placeholder: the address bar must keep the real path.
The page reads its params from it (`lib/route-params.ts`).

## 2. Serve `/env.js` yourself

Serve `/env.js` in front of `out/env.js`. The file in `out/` is the safe
default (same-origin, no appearance). Yours:

```js
window.__MANTLE_ENV__ = {
  apiBase: 'https://brain.example', // the brain's origin, '' for same-origin
  serverOrigin: 'https://brain.example', // same, for links to the brain
  turnStreaming: '', // MANTLE_TURN_STREAMING
  tour: '', // MANTLE_TOUR
  appearance: {/* GET <brain>/api/appearance, raw, or null */},
};
```

- `Cache-Control: no-store`.
- `appearance` is the brain's public `GET /api/appearance` body, unchanged.
  `boot.js` maps it onto `<html>` before the first paint. On a fetch failure
  send `null`: the page then wears the fresh-install look, and the providers
  still correct it after mount. Never block or fail the page on it.
- Cache the appearance for a short time (30 s when it worked, 5 s when it
  failed), per brain.

## 3. Headers

| Header                                               | Where                                                                                       | Value                                                                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `Content-Security-Policy`                            | every HTML response                                                                         | `csp.txt`, with `{brain}` = the brain's origin and `{brain_ws}` = the same with `wss://` (or `ws://`). For same-origin, both become empty. |
| `Referrer-Policy: no-referrer`                       | the prefixes in `routes.json` `noReferrer` (`/client-signin`, `/invite`) and anything below |                                                                                                                                            |
| `Cache-Control: public, max-age=31536000, immutable` | `/_next/static/*`                                                                           | content-hashed                                                                                                                             |
| `Cache-Control: no-cache`                            | HTML, `/_mantle/*`                                                                          | so a new build shows at once                                                                                                               |

The CSP is a header, not a meta tag, so `frame-ancestors` works.

## What the UI does itself

- **First paint.** `/env.js` and `/_mantle/boot.js` are blocking scripts at
  the top of `<head>`. `boot.js` writes the theme, fonts, avatar style and
  backgrounds onto `<html>`, and keeps the brain's name in the tab title.
- **The login gate and retired pages.** `boot.js` runs `lib/route-guard.ts`
  before anything paints: no session goes to `/login?next=…`, an old path such
  as `/team` goes to its new home. This was the Next middleware.
- **Layout state.** The rail widths and collapsed state come from cookies,
  read in the browser (`app/(app)/layout.tsx`).
- **Values only the host knows** (the brain's origin, its branding) are read
  after hydration (`lib/use-hydrated.ts`). The login and invite cards stay
  invisible until then, so a wrong brand never shows.
