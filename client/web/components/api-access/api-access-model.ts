/**
 * The pure half of Settings > API access (brain migration 0232): labels,
 * the create body, the order of the list, and the example commands shown
 * with a new key. No React, so api-access-model.test.ts can pin it.
 */
import type {
  AccessKeyAccess,
  AccessKeyArea,
  AccessKeyCreateInput,
  AccessKeyView,
} from '@mantle/client-types';

/** `app_data` (brain team apps Phase 1): the data of mini apps an admin
 *  opened to MCP. Named here before the contract pin lists it, so the
 *  screen labels it on a brain that sends it. */
export const AREA_LABEL: Record<AccessKeyArea | 'app_data', string> = {
  // Search reads every kind of item, email and journal included.
  search: 'Search (every kind)',
  pages: 'Pages',
  notes: 'Notes',
  tasks: 'Tasks',
  tables: 'Tables',
  files: 'Files',
  calendar: 'Calendar',
  contacts: 'Contacts',
  journal: 'Journal',
  apps: 'Apps',
  app_data: 'App data (MCP)',
};

export const ACCESS_LABEL: Record<AccessKeyAccess, string> = {
  read: 'Read only',
  read_write: 'Read and write',
};

/** The usual expiry steps, in days. */
export const EXPIRY_STEPS = [30, 90, 365] as const;

/** An expiry choice: a number of days as text, or `never`. */
export type ExpiryChoice = string;

/** What a choice says on the screen. */
export function expiryLabel(choice: ExpiryChoice): string {
  if (choice === 'never') return 'Never';
  const days = Number(choice);
  if (days === 365) return '1 year';
  return days === 1 ? '1 day' : `${days} days`;
}

/** The expiry choices a login may pick: they follow the brain's
 *  `maxExpiryDays` (workspaces W8: the keys area decides, never the role).
 *  Null (a login in the Admin workspace with its keys area): every step and
 *  "never". Else the steps up to the maximum, and the maximum itself when it
 *  is not one of them. */
export function expiryChoicesFor(maxDays: number | null): ExpiryChoice[] {
  if (maxDays === null) return [...EXPIRY_STEPS.map(String), 'never'];
  const max = Math.max(1, Math.floor(maxDays));
  const steps: ExpiryChoice[] = EXPIRY_STEPS.filter((d) => d <= max).map(String);
  if (!steps.includes(String(max))) steps.push(String(max));
  return steps;
}

/** The expiry a new key starts on: the brain's default when it is one of
 *  the choices this login may pick, else the longest it may pick. */
export function defaultExpiryChoice(
  defaultDays: number,
  maxDays: number | null = null,
): ExpiryChoice {
  const choices = expiryChoicesFor(maxDays);
  const v = String(defaultDays);
  if (choices.includes(v)) return v;
  const numeric = choices.filter((c) => c !== 'never');
  return numeric[numeric.length - 1] ?? '30';
}

export type CreateForm = {
  name: string;
  access: AccessKeyAccess;
  allAreas: boolean;
  areas: AccessKeyArea[];
  expiry: ExpiryChoice;
  /** Comma or space separated tool slugs (a login with the keys area). */
  riskyTools: string;
  /** The caller's password: every login re-types it (W8). */
  password: string;
};

/** What the brain says about the caller (GET /api/access-keys). Only the
 *  longest expiry: every login re-types its password since W8 (the brain
 *  sends `needsPassword: true` for older apps), and the longest expiry is
 *  null exactly for a login with the keys area, the one that may name
 *  risky tools. */
export type CreateRules = {
  maxExpiryDays: number | null;
};

/** Whether the dialog offers risky tools: a login in the Admin workspace
 *  with its keys area, the one the brain gives no longest expiry (a brain
 *  before W8 gave an admin none, so the rule holds there too). */
export function offersRiskyTools(rules: CreateRules): boolean {
  return rules.maxExpiryDays === null;
}

/** The POST body for a form, or the problem to show. */
export function createBody(
  form: CreateForm,
  rules: CreateRules,
  /** How the person confirms: the password typed here, or a fresh company
   *  sign-in (a linked login), whose proof goes in when it is back. */
  confirm: 'password' | 'company' = 'password',
):
  | { body: AccessKeyCreateInput }
  | { error: string; field: 'name' | 'areas' | 'riskyTools' | 'expiry' | 'password' } {
  const name = form.name.trim();
  if (!name) return { error: 'Name the key, for example "Backup script".', field: 'name' };
  if (name.length > 100) return { error: 'Use 100 characters or fewer.', field: 'name' };
  if (!form.allAreas && form.areas.length === 0) {
    return { error: 'Pick at least one area, or allow all areas.', field: 'areas' };
  }
  const risky = offersRiskyTools(rules)
    ? form.riskyTools
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  if (risky.some((s) => !/^[a-z0-9_]{1,64}$/.test(s))) {
    return { error: 'Tool names use a to z, 0 to 9 and _ only.', field: 'riskyTools' };
  }
  if (!expiryChoicesFor(rules.maxExpiryDays).includes(form.expiry)) {
    return { error: `Your keys can last at most ${rules.maxExpiryDays} days.`, field: 'expiry' };
  }
  if (confirm === 'password' && !form.password) {
    return { error: 'Type your password to make a key.', field: 'password' };
  }
  return {
    body: {
      name,
      access: form.access,
      areas: form.allAreas ? null : [...new Set(form.areas)],
      expiresInDays: form.expiry === 'never' ? null : Number(form.expiry),
      ...(risky.length ? { riskyTools: [...new Set(risky)] } : {}),
      ...(confirm === 'password' ? { password: form.password } : {}),
    },
  };
}

const KEY_DRAFT = 'mantle.oidc.key-draft';

/**
 * A fresh company sign-in leaves this page and comes back: the form waits in
 * this tab, with no password in it.
 */
export function saveKeyDraft(form: CreateForm): void {
  try {
    window.sessionStorage.setItem(KEY_DRAFT, JSON.stringify({ ...form, password: '' }));
  } catch {
    /* the person fills the form in again */
  }
}

/** The person left the dialog: nothing may come back to it. */
export function clearKeyDraft(): void {
  try {
    window.sessionStorage.removeItem(KEY_DRAFT);
  } catch {
    /* nothing kept to clear */
  }
}

/** The form that waited, read once. */
export function takeKeyDraft(): CreateForm | null {
  try {
    const raw = window.sessionStorage.getItem(KEY_DRAFT);
    if (!raw) return null;
    window.sessionStorage.removeItem(KEY_DRAFT);
    return { ...(JSON.parse(raw) as CreateForm), password: '' };
  } catch {
    return null;
  }
}

/** What a key may do, in one line. */
export function scopeLine(key: Pick<AccessKeyView, 'access' | 'areas'>): string {
  const areas = key.areas ? key.areas.map((a) => AREA_LABEL[a]).join(', ') : 'All areas';
  return `${ACCESS_LABEL[key.access]} · ${areas}`;
}

/** Live keys first, then ended ones; newest first inside each. */
export function sortKeys(keys: readonly AccessKeyView[]): AccessKeyView[] {
  const rank = (k: AccessKeyView) => (k.status === 'active' ? 0 : 1);
  return [...keys].sort(
    (a, b) => rank(a) - rank(b) || Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

/** The commands shown with a new key: put it in a variable once (so the
 *  secret is not on every command line, or in the shell history of each),
 *  a first API call, and adding the brain to Claude Code over MCP. `origin`
 *  is the brain's origin. */
export function exampleCommands(
  origin: string,
  secret: string,
): { env: string; http: string; mcp: string } {
  return {
    env: `export MANTLE_KEY='${secret}'`,
    http: `curl -s ${origin}/api/v1/whoami \\\n  -H "Authorization: Bearer $MANTLE_KEY"`,
    mcp: `claude mcp add --transport http mantle ${origin}/api/mcp \\\n  --header "Authorization: Bearer $MANTLE_KEY"`,
  };
}
