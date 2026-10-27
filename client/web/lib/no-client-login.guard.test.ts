import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * No client login and no sign-in by email code (workspaces W8): a login is
 * an admin or a member, and it signs in with its password. No source of the
 * app, the UI kit, the desktop shell or the e2e helpers names the code
 * routes or a 'client' login role in code. Comments may tell the history
 * (they are stripped before the scan); tests may feed an old brain's values
 * (they are not scanned). Paths are the repo's.
 */
const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const ROOTS = ['client/web/', 'packages/web-ui/src/', 'client/desktop/src/', 'e2e/'];
/** The list of gone routes names the code routes on purpose (lib/gone-routes.ts). */
const NAMES_ON_PURPOSE = ['client/web/lib/gone-routes.ts'];

const isTest = (name: string) => /\.(test|spec)\.(ts|tsx|mjs)$/.test(name);

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.(ts|tsx|mjs)$/.test(name) && !isTest(name)) {
      out.push(relative(REPO, path).split(sep).join('/'));
    }
  }
  return out;
}

const scanned = ROOTS.flatMap((r) => sources(join(REPO, r))).filter(
  (f) => !NAMES_ON_PURPOSE.includes(f),
);

/** The code of a file: block comments (JSX ones too) and line comments out. */
function codeOf(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

const NEEDLES: readonly (readonly [label: string, needle: RegExp])[] = [
  ['the email code routes (client-code)', /client-code/],
  ['the email code sign-in or its sender', /\bEmailCode\w*|\bemailCodes?\b|\bEMAIL_CODE\w*/],
  ["the 'client-login' refusal", /['"`]client-login['"`]/],
  [
    "a 'client' login role",
    /\brole\s*(?:===|!==|==|!=|:)\s*['"`]client['"`]|['"`]client['"`]\s*\||\|\s*['"`]client['"`]|case\s+['"`]client['"`]\s*:/,
  ],
  // The array form: a list of roles with 'client' in it (['client'],
  // ['member', 'client'] as const, z.enum([...])) or a lookup in one
  // (roles.includes('client'), ROLES.has('client')).
  [
    "a 'client' role in a list of roles",
    /[[,]\s*['"`]client['"`]\s*[,\]]|\.(?:includes|has|indexOf)\(\s*['"`]client['"`]\s*[,)]/,
  ],
  // The enum form: an enum member (Client = 'client') or a schema literal.
  [
    "a 'client' role in an enum or a schema",
    /\b(?:Client|CLIENT)\s*=\s*['"`]client['"`]|\bliteral\(\s*['"`]client['"`]\s*\)/,
  ],
];

describe('no client login and no email code sign-in (W8)', () => {
  it('scans the app, the UI kit, the desktop shell and the e2e helpers', () => {
    for (const f of [
      'client/web/app/login/login-client.tsx',
      'client/web/app/login/login-form.tsx',
      'client/web/app/login/page.tsx',
      'client/web/lib/workspaces.ts',
      'client/web/lib/contract/workspaces.ts',
      'client/web/lib/mcp-screen.ts',
      'client/web/lib/login-key.ts',
      'client/web/components/layout/shell-role.tsx',
      'client/web/app/(app)/settings/peers/peer-acts-as.ts',
      'client/web/app/(app)/settings/users/users-client.tsx',
      'packages/web-ui/src/session-switch.ts',
      'packages/web-ui/src/app-sandbox/access-log.tsx',
      'client/desktop/src/main/brain-fence.ts',
      'e2e/workspace/mock-workspace-api.ts',
      'e2e/workspace/shell-nav.ts',
    ]) {
      expect(scanned, f).toContain(f);
    }
    expect(scanned.some(isTest)).toBe(false);
  });

  it.each(NEEDLES)('no code names %s', (_label, needle) => {
    const hits = scanned.filter((f) => needle.test(codeOf(readFileSync(join(REPO, f), 'utf8'))));
    expect(hits).toEqual([]);
  });

  it('the needles catch what they are for, and a history comment is not code', () => {
    const caught = (src: string) => NEEDLES.some(([, re]) => re.test(codeOf(src)));
    expect(caught("const EMAIL_CODE_PATH = '/api/auth/client-code';")).toBe(true);
    expect(caught('`${base}/api/auth/client-code/verify`')).toBe(true);
    expect(caught("import { EmailCodeForm } from './email-code-form';")).toBe(true);
    expect(caught('const emailCodes = await loadEmailCodesEnabled();')).toBe(true);
    expect(caught("if (body.reason === 'client-login') return;")).toBe(true);
    expect(caught("if (role === 'client') return null;")).toBe(true);
    expect(caught("const r = { role: 'client' };")).toBe(true);
    expect(caught("type Role = 'admin' | 'member' | 'client';")).toBe(true);
    expect(caught("type Role = 'client' | 'member';")).toBe(true);
    expect(caught("    case 'client':")).toBe(true);
    // The union, array and enum forms.
    expect(caught("type Role = 'member' | 'client';")).toBe(true);
    expect(caught("role: 'admin' | 'member' | \"client\";")).toBe(true);
    expect(caught("const ROLES = ['client'];")).toBe(true);
    expect(caught("const ROLES = ['admin', 'member', 'client'] as const;")).toBe(true);
    expect(caught("const ROLES = ['client', 'member'];")).toBe(true);
    expect(caught("const ROLES = [\n  'admin',\n  'client',\n];")).toBe(true);
    expect(caught("const Role = z.enum(['admin', 'member', 'client']);")).toBe(true);
    expect(caught("if (roles.includes('client')) return;")).toBe(true);
    expect(caught("if (NON_PASSWORD.has('client')) return;")).toBe(true);
    expect(caught("enum Role { Admin = 'admin', Client = 'client' }")).toBe(true);
    expect(caught("const r = z.literal('client');")).toBe(true);
    // History in a comment, and words that are not the role.
    expect(caught('// The client login and /api/auth/client-code went in W8.')).toBe(false);
    expect(caught("/* role === 'client' was a role before W8 */")).toBe(false);
    expect(caught("{/* case 'client': */}")).toBe(false);
    expect(caught("const qc = new QueryClient(); const url = 'https://x.test/a';")).toBe(false);
    expect(caught("type WorkspaceErrorCode = 'self_demote' | 'client_login';")).toBe(false);
    expect(caught("const OLD_CLIENT_VIA = 'client';")).toBe(false);
    expect(caught("const ROLES = ['admin', 'member'] as const;")).toBe(false);
    expect(caught("const keys = ['clients', 'client_login', 'client-report'];")).toBe(false);
    expect(caught("if (name.includes('client-')) return;")).toBe(false);
    expect(caught("import { QueryClient, QueryClientProvider } from 'x';")).toBe(false);
    expect(caught("// const ROLES = ['admin', 'member', 'client'];")).toBe(false);
  });

  it('the email code sign-in and its sender are gone', () => {
    for (const gone of [
      'client/web/app/login/email-code-form.tsx',
      'client/web/lib/email-code.ts',
      'client/web/lib/email-code-sender.ts',
      'client/web/lib/email-code-availability.ts',
      'client/web/app/(app)/settings/users/email-code-sender.tsx',
      'client/web/lib/access-levels.ts',
      'e2e/workspace/client-shell.spec.ts',
    ]) {
      expect(existsSync(join(REPO, gone)), gone).toBe(false);
    }
  });
});
