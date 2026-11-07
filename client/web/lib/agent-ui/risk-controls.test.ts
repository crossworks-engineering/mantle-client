import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { elementRefusal } from './model';

/**
 * Two lists of controls an agent driving the window cannot press.
 *
 * The first, the login scan below. Every control that switches, adds, signs out or forgets a login carries
 * `data-agent-risk`, so an agent driving the window cannot press it
 * (lib/agent-ui; the kit's login-change-guard is the second line).
 *
 * The scan: in every .tsx of the app and the kit, the functions that call a
 * login change (directly, or through another such function of the same
 * file) are found, and every JSX opening tag whose event handler or href
 * names one of them, or a sign-in-again / add-login path, must carry
 * `data-agent-risk`, itself or on the `asChild` parent it renders through.
 *
 * The second, PERSON_CONTROLS at the end: a person's own acts, read from the
 * mantle repo (packages/tools/src/person-only-acts.ts and the `people` rows of
 * server/web/lib/auth/route-mcp-ledger.json).
 */

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const DIRS = ['client/web/app', 'client/web/components', 'packages/web-ui/src'];
/** Screens outside the app shell: an agent never opens them
 *  (safeAgentRoute refuses /login, /invite, /auth, /onboarding, /pair), so
 *  their sign-in flows are not agent controls. */
const OUTSIDE_SHELL = /^client\/web\/app\/(login|invite|auth|onboarding|pair)\//;

/** The calls that change the login. */
const ACTIONS = [
  'switchSession',
  'signOutActive',
  'signOutSession',
  'forgetSession',
  'forgetSessions',
  'removeSession',
  'performSignOut',
  'signOutEverywhere',
  'signLoginOutEverywhere',
];
/** An href or handler naming one of these goes to add or re-sign a login,
 *  or opens a sign-out or forget confirm. */
const PATHS = /signInAgainPath|ADD_LOGIN_PATH|\/login\?add=|kind: '(signout|forget)'/;

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsxFiles(p));
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** The index just past the brace that closes the one at `open`. */
function closeOf(src: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i]!;
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  return src.length;
}

/** The opening tag around `at`: from its `<` to its `>` (braces skipped). */
function tagAround(src: string, at: number): { start: number; text: string } {
  let start = at;
  while (start > 0 && !(src[start] === '<' && /[A-Za-z]/.test(src[start + 1] ?? ''))) start--;
  let i = start + 1;
  while (i < src.length && src[i] !== '>') {
    if (src[i] === '{') i = closeOf(src, i);
    else i++;
  }
  return { start, text: src.slice(start, i + 1) };
}

/** A name used as code, not inside a string ('commit' is a sound's name,
 *  `/commit` a path) or as a property (`x.commit`). */
const word = (names: Set<string>) =>
  new RegExp(`(?<![\\w'"\`/.-])(${[...names].join('|')})(?![\\w'"\`-])`);

/** A family of risky actions: the calls that do it, the hrefs or handler
 *  text that lead to it, and what a function body says when it does it. */
type Family = { actions: readonly string[]; paths: RegExp; bodies: RegExp | null };

const LOGIN: Family = { actions: ACTIONS, paths: PATHS, bodies: null };

/** The open brace of the object literal around `at`, or -1. */
function objectAround(src: string, at: number): number {
  let depth = 0;
  for (let i = at; i >= 0; i--) {
    const c = src[i];
    if (c === '}') depth++;
    else if (c === '{') {
      if (depth === 0) return i;
      depth--;
    }
  }
  return -1;
}

/** The controls of one file that do one of `family`'s actions, and whether
 *  each is marked: a JSX tag's `data-agent-risk` (or its `asChild`
 *  parent's), or a header tool or menu entry's `risk`. */
export function riskyControls(
  raw: string,
  family: Family = LOGIN,
): { tag: string; marked: boolean }[] {
  // Comments say "commit" and "sign out" too: only the code counts.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
  const touches =
    family.actions.some((a) => src.includes(a)) ||
    family.paths.test(src) ||
    (family.bodies !== null && family.bodies.test(src));
  if (!touches) return [];
  // Functions that do it, to a fixed point.
  const names = new Set(family.actions);
  const defs = [
    ...src.matchAll(
      /(?:function\s+(\w+)\s*\(|const\s+(\w+)\s*=\s*(?:useCallback\(\s*)?(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>)/g,
    ),
  ].map((m) => {
    const brace = src.indexOf('{', m.index! + m[0].length);
    return { name: (m[1] ?? m[2])!, body: src.slice(m.index!, closeOf(src, brace)) };
  });
  for (let grew = true; grew;) {
    grew = false;
    for (const d of defs) {
      if (names.has(d.name)) continue;
      const rest = d.body.slice(d.name.length);
      const direct = family.bodies !== null && family.bodies.test(rest);
      // A component (capitalised) is not a handler: its body holds the
      // whole screen.
      if (/^[A-Z]/.test(d.name)) continue;
      if (direct || (names.size > 0 && word(names).test(rest))) {
        names.add(d.name);
        grew = true;
      }
    }
  }
  const named = (text: string) =>
    (names.size > 0 && word(names).test(text)) || family.paths.test(text);
  const out: { tag: string; marked: boolean }[] = [];
  // JSX attributes.
  for (const m of src.matchAll(/\b(on[A-Z]\w*|href)=(\{|")/g)) {
    const at = m.index!;
    const valueStart = at + m[0].length - 1;
    const value =
      m[2] === '{'
        ? src.slice(valueStart, closeOf(src, valueStart))
        : src.slice(valueStart, src.indexOf('"', valueStart + 1) + 1);
    if (!named(value)) continue;
    const tag = tagAround(src, at);
    let marked = tag.text.includes('data-agent-risk');
    if (!marked) {
      // Rendered through an `asChild` parent that carries the mark.
      const parent = tagAround(src, tag.start - 1);
      marked = parent.text.includes('asChild') && parent.text.includes('data-agent-risk');
    }
    out.push({ tag: tag.text.split('\n')[0]!.trim(), marked });
  }
  // Header tools and menu entries: `{ key, label, onSelect: ... }`.
  for (const m of src.matchAll(/\b(onSelect|onClick)\s*:/g)) {
    const at = m.index!;
    const open = objectAround(src, at);
    if (open < 0) continue;
    const obj = src.slice(open, closeOf(src, open));
    const value = src.slice(at + m[0].length, at + m[0].length + 200).split(/,\s*\n/)[0]!;
    if (!named(value)) continue;
    out.push({
      tag: obj.split('\n').slice(0, 3).join(' ').replace(/\s+/g, ' ').slice(0, 80),
      marked: /\brisk\s*:/.test(obj) || obj.includes('data-agent-risk'),
    });
  }
  return out;
}

/** The login family, as the round 5 test named it. */
export const loginControls = (src: string) => riskyControls(src, LOGIN);

const SOURCES = () =>
  DIRS.flatMap((d) => tsxFiles(join(REPO, d)))
    .filter((file) => !OUTSIDE_SHELL.test(relative(REPO, file)))
    .map((file) => ({ file: relative(REPO, file), src: readFileSync(file, 'utf8') }));

describe('login controls carry data-agent-risk', () => {
  const found = SOURCES().flatMap(({ file, src }) =>
    loginControls(src).map((c) => ({ file, ...c })),
  );

  it('finds the controls it is meant to (the scan still works)', () => {
    const files = new Set(found.map((c) => c.file));
    for (const f of [
      'client/web/components/layout/rail/profile-menu.tsx',
      'client/web/app/(app)/settings/sessions/sessions-client.tsx',
      'client/web/app/(app)/settings/users/users-client.tsx',
      'client/web/components/oidc/link-gate.tsx',
      'client/web/components/layout/shell-screens.tsx',
    ])
      expect(files).toContain(f);
    expect(found.length).toBeGreaterThanOrEqual(12);
  });

  it('every one of them is marked', () => {
    expect(found.filter((c) => !c.marked)).toEqual([]);
  });

  it('the scan sees an unmarked one', () => {
    const src = `
      async function leave() { await signOutActive(); }
      export const A = () => <Button onClick={() => void leave()}>Sign out</Button>;
      export const B = () => <Button data-agent-risk="session" onClick={leave}>Sign out</Button>;
      export const C = () => (
        <Item asChild data-agent-risk="session"><a href="/login?add=1">Add</a></Item>
      );
    `;
    expect(loginControls(src).map((c) => c.marked)).toEqual([false, true, true]);
  });
});

/** Comments say the same words: only the code counts. */
const codeOf = (raw: string) =>
  raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

/** The opening tags a piece of text sits in: `needle` is part of the tag. */
function tagsWith(file: string, needle: string): string[] {
  const src = codeOf(readFileSync(join(REPO, file), 'utf8'));
  const out: string[] = [];
  for (let at = src.indexOf(needle); at >= 0; at = src.indexOf(needle, at + 1)) {
    out.push(tagAround(src, at).text);
  }
  return out;
}

const APP = 'client/web/app/(app)';
const COMPANY = `${APP}/settings/(hub)/company-sign-in/company-sign-in-client.tsx`;
const MARK = 'data-agent-risk="person"';
/** A switch an agent may turn the safe way: marked only on the press that
 *  loosens, as an agent may send only the value that tightens. */
const onWhen = (test: string) => `data-agent-risk={${test}}`;

/** [the file, a piece of the control's opening tag, its mark]. */
const PERSON_CONTROLS: readonly (readonly [string, string, string])[] = [
  // pending_approve
  [`${APP}/pending/pending-client.tsx`, "decide(row.id, 'approve')", MARK],
  ['client/web/components/pending/questionnaire-card.tsx', "decide(row.id, 'approve')", MARK],
  [
    'client/web/components/pending/questionnaire-card.tsx',
    "decide(row.id, 'approve', { answer: opt })",
    MARK,
  ],
  ['client/web/components/pending/questionnaire-card.tsx', 'onClick={submitForm}', MARK],
  ['client/web/components/pending/questionnaire-card.tsx', 'disabled={!freeText.trim()}', MARK],
  // api_tool_update: enabled, requires_confirm, external_access
  [
    `${APP}/settings/tools/tools-client.tsx`,
    'checked={form.enabled}',
    onWhen("form.enabled ? undefined : 'person'"),
  ],
  [
    `${APP}/settings/tools/tools-client.tsx`,
    'checked={form.requiresConfirm}',
    onWhen("form.requiresConfirm ? 'person' : undefined"),
  ],
  [
    `${APP}/settings/tools/external-access-section.tsx`,
    'id="external-access-switch"\n',
    onWhen("on ? undefined : 'person'"),
  ],
  // recall_map_publish, recall_prompt_confirm, recall_revision_restore
  [`${APP}/recall/v2/map-workbench.tsx`, 'publish(true)', MARK],
  [`${APP}/recall/v2/card-editor.tsx`, 'answerPrompt(true)', MARK],
  [
    `${APP}/recall/v2/card-inspector.tsx`,
    'checked={edits.prompt}',
    onWhen("edits.prompt ? undefined : 'person'"),
  ],
  [`${APP}/recall/v2/revisions-panel.tsx`, 'setConfirming(rev)', MARK],
  // PUT /api/tools/settings
  [
    `${APP}/settings/tools/tools-client.tsx`,
    'checked={settings.requireApproval}',
    onWhen("settings.requireApproval ? 'person' : undefined"),
  ],
  [
    `${APP}/settings/tools/tools-client.tsx`,
    'checked={settings.egressGate}',
    onWhen("settings.egressGate ? 'person' : undefined"),
  ],
  // POST /api/secrets/:id/reveal
  [`${APP}/secrets/secret-detail.tsx`, 'onClick={reveal}', MARK],
  [`${APP}/secrets/secret-detail.tsx`, 'onClick={startEdit}', MARK],
  // POST /api/network/deactivate
  [
    `${APP}/settings/(hub)/network/network-client.tsx`,
    "onClick={() =>\n                  run(() => apiSend<NetworkResult>('/api/network/deactivate'",
    MARK,
  ],
  // POST /api/messenger/c/:id/history/delete
  [`${APP}/chats/chat-inspector.tsx`, 'Delete the history for everyone?', MARK],
  // POST /api/auth/pair
  [`${APP}/settings/users/pair-phone-card.tsx`, 'onClick={() => void issue(false)}', MARK],
  // POST /api/access-keys, POST /api/auth/change-password
  ['client/web/components/api-access/api-access-client.tsx', '<SubmitButton', MARK],
  ['client/web/components/member/member-password-dialog.tsx', '<SubmitButton', MARK],
  // PUT /api/users/sso-setup, POST /api/users/sso-setup/scim-token
  [COMPANY, '<SubmitButton', MARK],
  [COMPANY, 'onClick={() => setAsking(true)}', MARK],
  // /api/auth/oidc: link, unlink, the link offer
  ['client/web/components/oidc/link-form.tsx', 'type="submit"', MARK],
  ['client/web/components/oidc/company-sign-in-section.tsx', 'setConfirming(true)', MARK],
  ['client/web/components/oidc/offer-card.tsx', 'setHidden(true)', MARK],
  // PATCH /api/apps/:id: dataReadOnly, trustTools, mcpAccess
  [
    'client/web/components/app-nav/app-informational-switch.tsx',
    'onCheckedChange={(v) => void change(v)}',
    onWhen("on ? 'person' : undefined"),
  ],
  [
    'client/web/components/app-nav/app-trust-tools-switch.tsx',
    'onCheckedChange={(v) => (v ? setConfirm(true)',
    onWhen("on ? undefined : 'person'"),
  ],
  [
    'client/web/components/share/grant-access-view.tsx',
    'onCheckedChange={on.onMcpAccess}',
    onWhen("view.app.mcpAccess ? undefined : 'person'"),
  ],
  // POST /api/telegram/pair: the confirm, not the look-up
  ['client/web/components/telegram/telegram-pair-form.tsx', 'onClick={confirm}', MARK],
  // The dev tool console: its call counts as a person's.
  ['client/web/components/dev-tools/request-builder.tsx', 'onClick={() => void send()}', MARK],
];

/** The same screens' other way: an agent may tighten, so these stay open. */
const TIGHTENS: readonly (readonly [string, string])[] = [
  [`${APP}/pending/pending-client.tsx`, "decide(row.id, 'reject')"],
  ['client/web/components/pending/questionnaire-card.tsx', "decide(row.id, 'reject')"],
  [`${APP}/recall/v2/map-workbench.tsx`, 'publish(false)'],
  [`${APP}/recall/v2/card-editor.tsx`, 'answerPrompt(false)'],
  ['client/web/components/telegram/telegram-pair-form.tsx', 'void lookUp()'],
];

describe("a person's own acts carry data-agent-risk", () => {
  it.each(PERSON_CONTROLS)('%s: %s', (file, needle, mark) => {
    const tags = tagsWith(file, needle);
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) expect(tag).toContain(mark);
  });

  it.each(TIGHTENS)('%s: %s stays open to an agent', (file, needle) => {
    const tags = tagsWith(file, needle);
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) expect(tag).not.toContain('data-agent-risk');
  });

  it('the mark answers needs_user', () => {
    const facts = { inHost: false, risk: 'person', inAlertDialog: false, secret: false };
    expect(elementRefusal(facts, 'click')).toBe('needs_user');
  });
});
