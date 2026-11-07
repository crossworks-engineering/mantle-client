import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every control that switches, adds, signs out or forgets a login carries
 * `data-agent-risk`, so an agent driving the window cannot press it
 * (lib/agent-ui; the kit's login-change-guard is the second line).
 *
 * The scan: in every .tsx of the app and the kit, the functions that call a
 * login change (directly, or through another such function of the same
 * file) are found, and every JSX opening tag whose event handler or href
 * names one of them, or a sign-in-again / add-login path, must carry
 * `data-agent-risk`, itself or on the `asChild` parent it renders through.
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

const word = (names: Set<string>) => new RegExp(`\\b(${[...names].join('|')})\\b`);

/** The controls of one file that change the login, and whether each is marked. */
export function loginControls(src: string): { tag: string; marked: boolean }[] {
  if (!ACTIONS.some((a) => src.includes(a)) && !PATHS.test(src)) return [];
  // Functions that change the login, to a fixed point.
  const names = new Set(ACTIONS);
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
      if (!names.has(d.name) && word(names).test(d.body.slice(d.name.length))) {
        names.add(d.name);
        grew = true;
      }
    }
  }
  const out: { tag: string; marked: boolean }[] = [];
  for (const m of src.matchAll(/\b(on[A-Z]\w*|href)=(\{|")/g)) {
    const at = m.index!;
    const valueStart = at + m[0].length - 1;
    const value =
      m[2] === '{'
        ? src.slice(valueStart, closeOf(src, valueStart))
        : src.slice(valueStart, src.indexOf('"', valueStart + 1) + 1);
    if (!word(names).test(value) && !PATHS.test(value)) continue;
    const tag = tagAround(src, at);
    let marked = tag.text.includes('data-agent-risk');
    if (!marked) {
      // Rendered through an `asChild` parent that carries the mark.
      const parent = tagAround(src, tag.start - 1);
      marked = parent.text.includes('asChild') && parent.text.includes('data-agent-risk');
    }
    out.push({ tag: tag.text.split('\n')[0]!.trim(), marked });
  }
  return out;
}

describe('login controls carry data-agent-risk', () => {
  const found = DIRS.flatMap((d) => tsxFiles(join(REPO, d)))
    .filter((file) => !OUTSIDE_SHELL.test(relative(REPO, file)))
    .flatMap((file) =>
      loginControls(readFileSync(file, 'utf8')).map((c) => ({
        file: relative(REPO, file),
        ...c,
      })),
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
