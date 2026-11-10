/**
 * Agent UI, the pure half: what an agent may ask the app window to do, and
 * the rules that need no DOM (plan: dev-brain page 596dbe4d, phase 1).
 *
 * An agent (a scripted lesson first, an in-app agent later) drives the
 * user's own window while they watch: it reads the screen as a short list of
 * labelled controls, then navigates, clicks, types, selects, points and
 * waits. It acts only as the signed-in user, with that user's own rights,
 * through the same requests a click makes.
 */

/** A control, by a stable id (`data-agent`, a tour anchor, or `row:<id>` for
 *  a list row), by role and accessible name, or by a ref from the last
 *  screen read. Never a CSS path. */
export type AgentTarget = { id: string } | { role: string; name: string } | { ref: string };

/** One control on the screen, as `readScreen` reports it. */
export type ScreenEntry = {
  ref: string;
  id?: string;
  role: string;
  name: string;
  /** checked, selected, expanded, disabled, pressed, current. */
  state?: string[];
  /** A field's value (`[hidden]` for a secret field). */
  value?: string;
};

export type Screen = {
  route: string;
  title: string;
  entries: ScreenEntry[];
  /** More controls were on screen than `MAX_ENTRIES`. */
  truncated: boolean;
};

/** Why an action did not happen. */
export type AgentRefusal =
  /** No agent session is running (nothing was asked to drive the window). */
  | 'no_session'
  /** The user pressed Stop. */
  | 'stopped'
  /** The user clicked or typed: the agent waits until it is asked again. */
  | 'user_took_over'
  /** The target is not on the screen. */
  | 'not_found'
  /** Two or more controls match the role and name. */
  | 'ambiguous'
  /** The ref is from an older screen read. */
  | 'stale_ref'
  /** The user must do this one: a delete, send, share, publish or settings
   *  step, or a confirm in an alert dialog. */
  | 'needs_user'
  /** A password, a one-time code or another secret field. */
  | 'secret_field'
  /** The agent's own controls (the Stop bar, a confirm the host draws). */
  | 'host_control'
  /** Not a route the agent may open (a query, a hash, another origin). */
  | 'bad_route'
  /** A link that leaves the app, or goes to a route the agent may not open. */
  | 'unsafe_route'
  /** The field takes no typing, or the option was not found. */
  | 'unsupported'
  /** The screen did not settle in time. */
  | 'timeout'
  /** The user has not allowed agents in this window yet (an in-app agent). */
  | 'needs_consent'
  /** The call came past its `expiresAt`: the brain stopped waiting. */
  | 'window_gone';

export type AgentResult<T extends object = object> =
  ({ ok: true } & T) | { ok: false; error: AgentRefusal; message: string };

/** At most this many controls in a screen read. */
export const MAX_ENTRIES = 150;
/** A name or value longer than this is cut. */
export const MAX_TEXT = 80;
/** The longest wait an agent may ask for. */
export const MAX_WAIT_MS = 10_000;

export const REFUSAL_TEXT: Record<AgentRefusal, string> = {
  no_session: 'No agent session is running in this window.',
  stopped: 'The user stopped the agent.',
  user_took_over: 'The user took over. Ask before going on.',
  not_found: 'That control is not on the screen.',
  ambiguous: 'More than one control matches. Use its ref from the screen.',
  stale_ref: 'The screen changed since it was read. Read it again.',
  needs_user: 'The user has to do this step themselves.',
  secret_field: 'That is a secret field; the agent never reads or types in it.',
  host_control: "That is the agent's own control.",
  bad_route: 'That is not a route the agent may open.',
  unsafe_route: 'That link leaves the app or opens a route the agent may not open.',
  unsupported: 'That control cannot be used this way.',
  timeout: 'The screen did not settle in time.',
  needs_consent: 'The user has not allowed this window yet. Ask them, then try again.',
  window_gone: 'The call reached the window after it expired. Nothing was done.',
};

export function refuse(error: AgentRefusal, message = REFUSAL_TEXT[error]): AgentResult<never> {
  return { ok: false, error, message };
}

/** A target as the agent sent it, or null. */
export function parseTarget(raw: unknown): AgentTarget | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  const str = (v: unknown) => typeof v === 'string' && v.trim().length > 0 && v.length <= 200;
  if (str(t.id)) return { id: String(t.id) };
  if (str(t.ref)) return { ref: String(t.ref) };
  if (str(t.role) && str(t.name)) return { role: String(t.role), name: String(t.name) };
  return null;
}

/**
 * An app route the agent may open: an absolute path inside the app, with no
 * query and no hash (a route like `?lesson=` acts on load), no `//`, no
 * backslash, no control characters, and only a screen of the app shell
 * (`APP_SHELL_ROUTES`): never the sign-in, onboarding, pairing or invite
 * screens, the API, or a path the app does not know.
 */
export function safeAgentRoute(path: unknown): string | null {
  if (typeof path !== 'string' || path.length === 0 || path.length > 300) return null;
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  if (/[?#\\]/.test(path)) return null;
  if ([...path].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)) return null;
  // A path that changes when the browser resolves it (`/x/../login`)
  // could reach a refused screen: only a path already in its own form.
  let resolved: string;
  try {
    resolved = new URL(path, 'http://app.invalid').pathname;
  } catch {
    return null;
  }
  if (resolved !== path) return null;
  // Read decoded, as the router does: `/%6Cogin` is `/login`.
  const decoded = decodePath(path);
  if (decoded === null || decoded.startsWith('//') || /[?#\\]/.test(decoded)) return null;
  if (/^\/(login|logout|auth|invite|api)(\/|$)/i.test(decoded)) return null;
  if (decoded.split('/').some((seg) => seg === '.' || seg === '..')) return null;
  const first = decoded.split('/')[1] ?? '';
  if (first !== '' && !APP_SHELL_ROUTES.has(first)) return null;
  return path;
}

/** The top-level screens rendered inside the app shell: the folders of
 *  `client/web/app/(app)` (a test holds the two in step). The root `/` is
 *  the Desk. */
export const APP_SHELL_ROUTES: ReadonlySet<string> = new Set([
  'admin',
  'apps',
  'assistant',
  'changelog',
  'chats',
  'contacts',
  'dashboard',
  'debug',
  'dev-tools',
  'docs',
  'draw',
  'events',
  'files',
  'formulas',
  'heartbeats',
  'inbox',
  'journal',
  'models',
  'n',
  'nodes',
  'notes',
  'pages',
  'pending',
  'present',
  'recall',
  'runners',
  'runs',
  'sandboxes',
  'secrets',
  'settings',
  'status',
  'studio',
  'tables',
  'tasks',
  'traces',
]);

/**
 * Whether the agent may follow a link: its href, resolved against the page,
 * must stay on the app's origin and land on a path `safeAgentRoute` takes.
 * A `javascript:`, `mailto:` or other-origin link is refused, and so is one
 * to the sign-in screens or the API. A link with no href (a role=link that
 * acts by script) acts as the user's own press would.
 */
export function linkRefusal(href: string | null, pageUrl: string): AgentRefusal | null {
  if (href === null) return null;
  let url: URL;
  let page: URL;
  try {
    page = new URL(pageUrl);
    url = new URL(href, page);
  } catch {
    return 'unsafe_route';
  }
  if (url.origin !== page.origin) return 'unsafe_route';
  // A query acts on load (`?lesson=`, a filter, a create): refused unless it
  // is one the app lets a link carry. Today that is only a lesson's offer,
  // which plays nothing until the user presses Start (a host control).
  if (url.search && !LINK_QUERY_OK.test(url.search)) return 'unsafe_route';
  return safeAgentRoute(url.pathname) ? null : 'unsafe_route';
}

/** The one query a link the agent follows may carry: a lesson's offer. */
const LINK_QUERY_OK = /^\?lesson=[0-9a-f-]{36}$/i;

/** A path with its percent-encoding undone, until it no longer changes
 *  (`%2573` is `%73` is `s`), or null when it does not decode. */
export function decodePath(path: string): string | null {
  let out = path;
  for (let i = 0; i < 5; i += 1) {
    let next: string;
    try {
      next = decodeURIComponent(out);
    } catch {
      return null;
    }
    if (next === out) return out;
    out = next;
  }
  return out;
}

/** What an element is, as the guard reads it. */
export type ElementFacts = {
  /** Inside the agent's own controls (`data-agent-host`). */
  inHost: boolean;
  /** Its own or an ancestor's `data-agent-risk`. */
  risk: string | null;
  /** Inside an `alertdialog` (a confirm), whatever it is. */
  inAlertDialog: boolean;
  /** A password, one-time code or `data-secret` field. */
  secret: boolean;
};

/** Why the agent may not act on an element, or null. Typing into a secret
 *  field is refused; clicking one (to focus it) is not. */
export function elementRefusal(
  facts: ElementFacts,
  action: 'click' | 'type' | 'select',
): AgentRefusal | null {
  if (facts.inHost) return 'host_control';
  if (facts.secret && action === 'type') return 'secret_field';
  if (facts.risk || facts.inAlertDialog) return 'needs_user';
  return null;
}

/** A name or value cut for a screen read. */
export function cutText(s: string, max = MAX_TEXT): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Whether `name` names a control called `want`: the same words, any case;
 *  else the control's name starts with them. */
export function nameMatches(name: string, want: string): 'exact' | 'prefix' | null {
  const a = name.trim().toLowerCase();
  const b = want.trim().toLowerCase();
  if (!b) return null;
  if (a === b) return 'exact';
  return a.startsWith(b) ? 'prefix' : null;
}

/**
 * The entry of one of `roles` that `name` names. Every exact name, in any
 * of the roles, comes before any name that only starts with `name`; within
 * that, the earliest role that has one. Two of them in that role is
 * `ambiguous`.
 */
export function pickByName<E extends { name: string; role: string }>(
  entries: readonly E[],
  roles: readonly string[],
  name: string,
): E | { error: 'not_found' | 'ambiguous' } {
  for (const kind of ['exact', 'prefix'] as const) {
    for (const role of roles) {
      const pool = entries.filter((e) => e.role === role && nameMatches(e.name, name) === kind);
      if (pool.length === 1) return pool[0]!;
      if (pool.length > 1) return { error: 'ambiguous' };
    }
  }
  return { error: 'not_found' };
}
