#!/usr/bin/env node
/**
 * The route coverage gate. Walk EVERY screen under client/web/app against a
 * running deployment in a real browser and assert each one actually renders.
 *
 *   pnpm e2e:routes -- https://demo.example              (or E2E_CLIENT_URL)
 *   ROUTES_ONLY=/journal,/traces pnpm e2e:routes -- …   narrow the sweep
 *
 * It was born on the mantle repo's demo branch (P6b of the public demo, where
 * a fixture-driven predecessor had shipped 85 blank screens) and moved here
 * with the screens it walks in the 2026-08-13 split: the route list is
 * DERIVED from client/web/app, so the gate has to live beside that directory
 * or it goes quietly stale against the very screens it claims to cover.
 *
 * WHO IS SIGNED IN. The gate never signs in itself. Either the target admits
 * a visitor as-is (the public demo's edge injects the owner cookies on every
 * request), or you hand it the owner bearer that the split topology uses:
 *
 *   ROUTES_BEARER=<kind-'m' token>   seeded into localStorage under the
 *                                    contract key, plus the presence cookie —
 *                                    exactly what e2e/lib/fixtures.ts does
 *   ROUTES_BEARER_FILE=<path>        a {"token": …} file; defaults to the
 *                                    e2e global-setup artifact if present
 *
 * WHY A BROWSER, AND WHY <main>:
 * The failure this exists to catch is invisible to curl. A screen served
 * behind a misconfigured edge returns 200 with complete, well-formed HTML and
 * still renders nothing: the client never hydrates, so <main> holds an
 * unresolved React placeholder forever. Page BYTES cannot detect that — the
 * nav shell alone is ~103KB, so an entirely empty screen sails past any size
 * floor. The only honest measure is rendered text inside the content region,
 * read from a browser after hydration.
 *
 * READ-ONLY. Navigation is GET-only, and any non-GET the app fires on its own
 * is reported, so the gate is safe against a read-only edge — and against a
 * brain someone relies on, unlike the Playwright suite beside it.
 *
 * Not a Playwright spec on purpose: a spec asserts behaviour on a throwaway
 * brain, this sweeps rendering on a real one. It borrows the browser from the
 * same @playwright/test install.
 */
/*
 * `document` and `location` below appear only inside page.evaluate /
 * waitForFunction callbacks. Those are serialised and run in the BROWSER, not
 * in this Node process, so they are genuinely defined at the point of use —
 * eslint just cannot see across that boundary.
 */
/* global document, location, window */
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const APP_DIR = join(ROOT, 'client/web/app');

const baseArg = process.argv[2] || process.env.E2E_CLIENT_URL;
if (!baseArg) {
  console.error('usage: node e2e/check-routes.mjs <base-url>   (or set E2E_CLIENT_URL)');
  process.exit(2);
}
const BASE = baseArg.replace(/\/$/, '');

// Text shorter than this in <main> is not a rendered screen. Generous on
// purpose: the point is to separate "nothing at all" from "an honest empty
// state", not to police wording.
const THIN_CHARS = 120;

// ── The owner bearer, if the target does not admit visitors by itself ───────
// Same contract as e2e/lib/fixtures.ts (split topology): the token goes into
// localStorage under TOKEN_STORAGE_KEY and the presence cookie is set on the
// client origin so the middleware does not bounce every load to /login.
const TOKEN_STORAGE_KEY = 'mantle_token';
const PRESENCE_COOKIE = 'mantle_authed';
const bearer = (() => {
  if (process.env.ROUTES_BEARER) return process.env.ROUTES_BEARER;
  const file = process.env.ROUTES_BEARER_FILE || join(HERE, '.artifacts/owner-bearer.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')).token || null;
  } catch {
    return null;
  }
})();

// ── Playwright, borrowed from the suite ─────────────────────────────────────
const require = createRequire(import.meta.url);
let chromium;
try {
  // require, not import: @playwright/test is CommonJS and its named exports do
  // not survive ESM interop here — `chromium` comes back undefined.
  const entry = require.resolve('@playwright/test', { paths: [HERE] });
  chromium = require(entry).chromium;
  if (!chromium) throw new Error('@playwright/test loaded but exposes no chromium');
} catch (err) {
  console.error('✗ cannot load Playwright — run `pnpm -C e2e install` first');
  console.error('  ' + err.message);
  process.exit(2);
}

// ── The route list is DERIVED, never hand-maintained ────────────────────────
// A hardcoded list stops covering new screens the moment someone adds one, and
// this gate exists precisely so nothing goes unlooked-at.
function routeFiles(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) routeFiles(p, acc);
    else if (e.name === 'page.tsx') acc.push(p);
  }
  return acc;
}
const allRoutes = routeFiles(APP_DIR)
  .map((f) => {
    const r = f
      .slice(APP_DIR.length)
      .replace(/\/page\.tsx$/, '')
      .replace(/\/\([^/]+\)/g, ''); // route groups are not URL segments
    return r === '' ? '/' : r;
  })
  .sort();

// ── Fixtures for dynamic segments, fetched read-only from the target ────────
// The API lives on the same origin behind the demo edge; on a split
// deployment the fetches below go to the client origin and 404, so every
// dynamic route is reported SKIPPED rather than silently passed.
const apiHeaders = {
  accept: 'application/json',
  ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
};
const getJson = async (path) => {
  try {
    const r = await fetch(BASE + path, { headers: apiHeaders });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
};
const pluck = (obj, key) => {
  if (!obj) return null;
  const list = Array.isArray(obj) ? obj : obj[key];
  return Array.isArray(list) && list.length && list[0].id ? list[0].id : null;
};

const f = {};
await Promise.all([
  getJson('/api/notes?limit=1').then((d) => (f.note = pluck(d, 'notes'))),
  getJson('/api/pages?limit=1').then((d) => (f.page = pluck(d, 'pages'))),
  getJson('/api/tables?limit=1').then((d) => (f.table = pluck(d, 'tables'))),
  getJson('/api/traces?limit=1').then((d) => (f.trace = pluck(d, 'traces'))),
  getJson('/api/events?limit=1').then((d) => (f.event = pluck(d, 'events'))),
  getJson('/api/secrets?limit=1').then((d) => (f.secret = pluck(d, 'secrets'))),
  getJson('/api/apps?limit=1').then((d) => (f.app = pluck(d, 'apps'))),
  getJson('/api/heartbeats').then((d) => (f.heartbeat = pluck(d, 'heartbeats'))),
  getJson('/api/contacts?limit=1').then((d) => (f.contact = pluck(d, 'contacts'))),
  getJson('/api/draws?limit=1').then((d) => (f.draw = pluck(d, 'draws'))),
  getJson('/api/email/accounts').then((d) => (f.account = pluck(d, 'accounts'))),
  getJson('/api/changelog').then((d) => (f.changelog = d?.latest || d?.versions?.[0] || null)),
  // The reader hands back the href of its first document. Normalise it to a
  // path: a bare "docs/…" (no leading slash) is not a URL the browser will
  // open, and anything that is not under /docs is not this screen's fixture.
  getJson('/api/docs/collections').then((d) => {
    // One href per collection (an object), or a single string on older APIs.
    const raw = d?.firstDocHref;
    const first =
      typeof raw === 'string' ? raw : Object.values(raw ?? {}).find((v) => typeof v === 'string');
    const href = typeof first === 'string' ? first.trim() : '';
    const path = href.startsWith('/') ? href : href ? `/${href}` : '';
    f.docHref = path.startsWith('/docs/') ? path : null;
  }),
]);
f.node = f.note; // /n/[id] and /nodes/[id]/history take any node

// Which fixture fills which segment. A route whose fixture is missing is
// SKIPPED and reported as such — never silently dropped, and never counted as
// a pass. A screen with a dynamic segment that has no line here is skipped
// too, and named, so adding a screen makes the gap visible rather than quiet.
const FIXTURES = [
  ['/notes/[id]', () => f.note && `/notes/${f.note}`],
  ['/pages/[id]', () => f.page && `/pages/${f.page}`],
  ['/tables/[id]', () => f.table && `/tables/${f.table}`],
  ['/traces/[id]', () => f.trace && `/traces/${f.trace}`],
  ['/events/[id]', () => f.event && `/events/${f.event}`],
  ['/secrets/[id]', () => f.secret && `/secrets/${f.secret}`],
  ['/apps/[id]', () => f.app && `/apps/${f.app}`],
  ['/heartbeats/[id]', () => f.heartbeat && `/heartbeats/${f.heartbeat}`],
  ['/draw/[id]', () => f.draw && `/draw/${f.draw}`],
  ['/n/[id]', () => f.node && `/n/${f.node}`],
  ['/nodes/[id]/history', () => f.node && `/nodes/${f.node}/history`],
  ['/debug/journey/[traceId]', () => f.trace && `/debug/journey/${f.trace}`],
  ['/changelog/[version]', () => f.changelog && `/changelog/${f.changelog}`],
  ['/docs/[collection]/[...slug]', () => f.docHref],
  ['/settings/accounts/[id]/edit', () => f.account && `/settings/accounts/${f.account}/edit`],
  ['/settings/accounts/[id]/folders', () => f.account && `/settings/accounts/${f.account}/folders`],
];
const fixtureFor = (route) => {
  const hit = FIXTURES.find(([pattern]) => pattern === route);
  return hit ? { url: hit[1](), known: true } : { url: null, known: false };
};

const only = process.env.ROUTES_ONLY?.split(',').map((s) => s.trim());
const targets = allRoutes
  .filter((r) => !only || only.includes(r))
  .map((route) => {
    if (!route.includes('[')) return { route, url: route };
    const { url, known } = fixtureFor(route);
    if (url) return { route, url };
    return {
      route,
      url,
      skip: known ? 'no fixture on this brain' : 'no fixture rule — add one to FIXTURES',
    };
  });

// ── Walk them ───────────────────────────────────────────────────────────────
// The browser cannot see everything. Some screens are filled by the client's
// own server fetching the API, so a 500 there never reaches the page's network
// log — /runners once rendered a tidy 176-char empty state while GET
// /api/runners returned 500 server-side, invisible to every browser-level
// assertion. When the API's log is on this machine (ROUTES_API_LOG — the demo
// bench sets it), watch it across the sweep and count what it recorded, so a
// failure the browser cannot witness is still reported rather than assumed
// absent. Against a remote box there is no log to read; the report says so.
const API_LOG = process.env.ROUTES_API_LOG || null;
const countApiErrors = () => {
  if (!API_LOG) return null;
  try {
    return readFileSync(API_LOG, 'utf8')
      .split('\n')
      .filter((l) => l.includes('unhandled error')).length;
  } catch {
    return null;
  }
};
const apiErrorsBefore = countApiErrors();

const browser = await chromium.launch();
const results = [];
const noted = [];

async function newContext() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (bearer) {
    // The presence flag as ui-prefs keeps it (it was a cookie before the
    // desktop app's own URL scheme, which keeps none).
    await ctx.addInitScript(
      ([key, value, presenceKey, presence]) => {
        window.localStorage.setItem(key, value);
        window.localStorage.setItem(presenceKey, presence);
      },
      [TOKEN_STORAGE_KEY, bearer, `mantle_pref:${PRESENCE_COOKIE}`, JSON.stringify({ v: '1' })],
    );
  }
  return ctx;
}

async function visit({ route, url, skip }) {
  if (skip) return { route, state: 'SKIP', note: skip };

  const ctx = await newContext();
  const page = await ctx.newPage();
  const consoleErrors = [];
  const writes = [];
  const badResponses = [];

  const fontBlocks = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text().slice(0, 200);
    // A blocked webfont logs TWICE: the policy message (matched below by its
    // text) and a bare "Failed to load resource: net::ERR_FAILED" that names
    // the file only in the message's location. Pair it by the file type so
    // the second half does not fail a screen the first half already excused.
    const at = m.location()?.url || '';
    if (/^Failed to load resource/.test(text) && /\.(woff2?|ttf|otf)(\?|$)/i.test(at)) {
      fontBlocks.push(at);
      return;
    }
    consoleErrors.push(text);
  });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e.message).slice(0, 200)));
  page.on('request', (r) => {
    if (r.method() !== 'GET' && r.method() !== 'HEAD')
      writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  page.on('response', (r) => {
    const p = new URL(r.url()).pathname;
    if (r.status() >= 400 && p.startsWith('/api/')) badResponses.push(`${r.status()} ${p}`);
  });

  let state = 'OK';
  let note = '';
  let chars = 0;
  try {
    const resp = await page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const status = resp?.status() ?? 0;

    // Give the client a chance to hydrate and fill the region, but do not
    // hang the whole sweep on one screen.
    await page
      .waitForFunction(
        (min) => {
          const m = document.querySelector('main');
          return m && m.innerText.trim().length >= min;
        },
        THIN_CHARS,
        { timeout: 12_000 },
      )
      .catch(() => {});

    // Then LET IT SETTLE before judging. Without this the gate probes the
    // instant the text threshold is met and closes the page, so a data call
    // that fires slightly later never happens at all — and a screen stuck on
    // "Loading…" behind a failed fetch passes, because the surrounding
    // boilerplate alone clears the threshold. /docs did exactly that: 174
    // chars of explanatory text, a permanent spinner, and GET
    // /api/docs/collections returning 500 that the sweep never even provoked.
    await page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => {});
    await page.waitForTimeout(1_200);

    // WHICH container to measure. <main> is the content region inside the app
    // shell, and measuring it is the whole point — the nav alone is ~103KB, so
    // measuring the body would pass a screen with nothing in it.
    //
    // But not every route lives in that shell. A standalone page (the retired
    // team portal's eleven screens were the case that taught this) renders
    // with no <main> at all; an earlier version of this gate called each one
    // "no <main> element", confident failures against screens that worked.
    // Such pages carry no nav, so their body IS their content and measuring
    // it is safe.
    const probe = await page.evaluate(() => {
      const m = document.querySelector('main');
      const el = m ?? document.body;
      const frame = el ? el.querySelector('iframe') : null;
      return {
        container: m ? 'main' : 'body',
        frame: frame ? { w: frame.clientWidth, h: frame.clientHeight } : null,
        text: el ? el.innerText.trim() : '',
        pending: el ? el.innerHTML.includes('template id="B:') : false,
        path: location.pathname,
      };
    });
    chars = probe.text.length;

    if (status >= 400) {
      state = 'FAIL';
      note = `HTTP ${status}`;
    } else if (!probe.text && !probe.pending) {
      state = 'FAIL';
      note = 'no content region at all';
    } else if (probe.pending) {
      state = 'FAIL';
      note = 'unresolved React placeholder — client never hydrated';
    } else if (chars === 0) {
      state = 'FAIL';
      note = 'empty <main>';
    } else if (chars < THIN_CHARS) {
      // A mini-app renders INSIDE a sandboxed iframe on an opaque origin, so
      // its content is unreadable from here by design — the parent only holds
      // the toolbar. Calling that "thin" would be wrong: the honest statement
      // is that the sandbox is mounted and this gate cannot see inside it.
      if (probe.frame && probe.frame.w > 200 && probe.frame.h > 100) {
        note = `sandboxed app ${probe.frame.w}x${probe.frame.h} — contents not readable from the parent`;
      } else {
        state = 'THIN';
        note = `only ${chars} chars`;
      }
    }

    // A bounce to /login is the one redirect that is never fine: it means the
    // target did not admit us, and every screen after this one would "render"
    // the login form. Say so once, loudly, rather than 100 times quietly.
    if (probe.path === '/login' && url !== '/login') {
      state = 'FAIL';
      note = 'redirected to /login — the target did not admit the visitor (see ROUTES_BEARER)';
    } else if (probe.path !== url && state === 'OK') {
      // Other redirects are not automatically a fault: the detail routes
      // deliberately become list-plus-selection (/notes/<id> →
      // /notes?selected=<id>) and render the record perfectly well. Report
      // where it went AND how much it rendered, so "redirect" never has to be
      // taken on trust.
      state = 'REDIR';
      note = `→ ${probe.path} (${chars} chars)`;
    }
  } catch (err) {
    state = 'FAIL';
    note = String(err.message).split('\n')[0].slice(0, 120);
    // The TARGET went away — not this route's fault, and not the next
    // thirty's either. A sweep that keeps going after the server dies produces
    // a report full of confident failures against screens it never loaded,
    // which is worse than no report: it looks like a catastrophic regression.
    if (/ERR_CONNECTION_REFUSED|ECONNREFUSED|net::ERR_EMPTY_RESPONSE/.test(err.message)) {
      state = 'ABORT';
    }
  }

  // A 401/403 is not automatically a defect. A gated screen answers 401 by
  // design and renders an honest sign-in or token screen, and the browser logs
  // a resource error for it (the retired team portal's eleven screens were
  // once reported broken exactly this way). Those
  // statuses are already surfaced in the AUTH section, so drop only the
  // resource-load noise that corresponds to them — a real JS exception
  // (pageerror) or a 5xx still fails, below.
  const expectedAuthNoise = badResponses.some((b) => b.startsWith('401') || b.startsWith('403'));
  // A font blocked inside the app sandbox degrades styling in the frame and
  // nothing else — it comes from the shared stylesheet the runtime injects,
  // not from anything an app asked for, so it fires for ANY app and would keep
  // /apps permanently red. Two shapes of the same thing: the sandbox CSP
  // (font-src data:), and CORS from the sandbox's opaque origin ('null') when
  // the font is served without Access-Control-Allow-Origin. Narrow on purpose:
  // only font loads, only those two policies. Every other violation fails.
  const cspFontNoise = (e) =>
    /font/i.test(e) && (/Content Security Policy/i.test(e) || /CORS policy/i.test(e));
  const realErrors = consoleErrors.filter(
    (e) => !(expectedAuthNoise && /Failed to load resource/i.test(e)) && !cspFontNoise(e),
  );
  const cspFonts = consoleErrors.filter(cspFontNoise);
  if (cspFonts.length || fontBlocks.length)
    noted.push(`${route}: the sandbox blocked a webfont (styling only)`);
  if (realErrors.length && state === 'OK') {
    state = 'FAIL';
    note = realErrors[0];
  }

  // A screen that renders a tidy empty state while its data call 500s is a
  // BROKEN screen, and the first version of this gate passed exactly that:
  // /runners scored OK on 176 chars of text while GET /api/runners returned
  // 500 twice. Rendering something is not the same as rendering the data.
  // 5xx fails outright; 401/403 is surfaced rather than swallowed, because a
  // read-only edge answers writes with 403 by design, and a 401 needs a human
  // decision, not an automatic verdict.
  const server5xx = badResponses.filter((b) => b.startsWith('5'));
  if (server5xx.length && state === 'OK') {
    state = 'FAIL';
    note = `renders, but its API failed: ${server5xx[0]}`;
  }

  await ctx.close();
  return { route, state, note, chars, consoleErrors, writes, badResponses };
}

// Serial on purpose: one brain, one API process, and a screen that is slow
// because the box is loaded is indistinguishable from one that is broken.
for (const t of targets) {
  const r = await visit(t);
  if (r.state === 'ABORT') {
    console.error(`\n✗ target unreachable at ${r.route} — ${r.note}`);
    console.error('  The target stopped answering mid-sweep, so every route after this point');
    console.error('  would be reported as broken when it was never loaded. Aborting instead.');
    console.error(
      `  ${results.length} route(s) had been judged; that partial result is NOT a pass.`,
    );
    await browser.close();
    process.exit(2);
  }
  results.push(r);
  const mark = { OK: '✓', THIN: '·', SKIP: '–', REDIR: '→', FAIL: '✗' }[r.state];
  const detail = r.state === 'OK' ? `${r.chars} chars` : r.note;
  console.log(`${mark} ${r.route.padEnd(38)} ${detail}`);
}

await browser.close();

// ── Report ──────────────────────────────────────────────────────────────────
const by = (s) => results.filter((r) => r.state === s);
const fails = by('FAIL');
const thin = by('THIN');
const skipped = by('SKIP');
const writes = results.flatMap((r) => r.writes || []);

console.log('\n' + '─'.repeat(60));
console.log(
  `${results.length} routes — ${by('OK').length} ok · ${by('REDIR').length} redirect · ` +
    `${thin.length} thin · ${skipped.length} skipped · ${fails.length} failed`,
);

if (writes.length) {
  console.log(`\n⚠ non-GET requests fired by the app itself: ${[...new Set(writes)].join(', ')}`);
}
if (skipped.length) {
  console.log('\nSKIPPED — no fixture, so these were NOT covered:');
  for (const r of skipped) console.log(`  ${r.route.padEnd(38)} ${r.note}`);
}
if (thin.length) {
  console.log(
    '\nTHIN — renders, but nearly nothing. Decide per screen: seed it, or accept an honest empty state.',
  );
  for (const r of thin) console.log(`  ${r.route.padEnd(38)} ${r.note}`);
}

// Auth failures on screens that still rendered. Not an automatic verdict —
// but never silent either, because "the page looked fine" is how a demo ships
// with a dead surface behind it.
const authIssues = results.filter(
  (r) =>
    r.state !== 'FAIL' &&
    (r.badResponses || []).some((b) => b.startsWith('401') || b.startsWith('403')),
);
if (authIssues.length) {
  console.log('\nAUTH — rendered, but an API call was refused:');
  for (const r of authIssues) {
    console.log(`  ${r.route.padEnd(38)} ${[...new Set(r.badResponses)].slice(0, 3).join(', ')}`);
  }
}
const apiErrorsAfter = countApiErrors();
if (process.env.ROUTES_DEBUG)
  console.log(`[debug] api log ${API_LOG} before=${apiErrorsBefore} after=${apiErrorsAfter}`);
if (apiErrorsBefore !== null && apiErrorsAfter > apiErrorsBefore) {
  const lines = readFileSync(API_LOG, 'utf8')
    .split('\n')
    .filter((l) => l.includes('unhandled error'))
    .slice(apiErrorsBefore);
  const paths = [
    ...new Set(
      lines.map((l) => (l.match(/unhandled error on \w+ ([^:]+)/) || [])[1]).filter(Boolean),
    ),
  ];
  console.log(
    `\nSERVER-SIDE API ERRORS — ${apiErrorsAfter - apiErrorsBefore} unhandled error(s) logged during this sweep.`,
  );
  console.log(
    'These do not reach the browser, so no screen above can be trusted to have shown them:',
  );
  for (const p of paths) console.log(`  ${p}`);
}

if (noted.length) {
  console.log('\nNOTED — real, but not a failure:');
  for (const n of noted) console.log(`  ${n}`);
}

if (fails.length) {
  console.log('\nFAILED:');
  for (const r of fails) {
    console.log(`  ${r.route.padEnd(38)} ${r.note}`);
    if (r.badResponses?.length)
      console.log(`      api: ${[...new Set(r.badResponses)].slice(0, 4).join(', ')}`);
  }
  console.log('\n✗ coverage gate FAILED');
  process.exit(1);
}
// Never print an unqualified tick over errors that were logged. A gate that
// says ✓ while the server was throwing is how you learn to stop reading it.
const serverSideErrors = apiErrorsBefore !== null ? apiErrorsAfter - apiErrorsBefore : 0;
if (serverSideErrors > 0) {
  console.log(
    `\n✓ every covered route renders — but the API logged ${serverSideErrors} error(s) above. Read those.`,
  );
} else if (API_LOG === null) {
  console.log('\n✓ every covered route renders (remote target — no API log was watched)');
} else {
  console.log('\n✓ every covered route renders');
}
