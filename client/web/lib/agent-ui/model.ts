/**
 * Agent UI, the pure half: what an agent may ask the app window to do, and
 * the rules that need no DOM (plan: dev-brain page 596dbe4d, phase 1).
 *
 * An agent (a scripted lesson first, an in-app agent later) drives the
 * user's own window while they watch: it reads the screen as a short list of
 * labelled controls, then navigates, clicks, types, selects, points and
 * waits. It acts only as the signed-in user, through the same requests a
 * click makes, and a request that deletes, sends, shares, publishes or
 * changes settings waits for the user's own yes (`riskOfRequest`).
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
 * acts by script) is left to the request guard.
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

export type RequestRisk =
  | 'delete'
  | 'send'
  | 'share'
  | 'publish'
  | 'settings'
  | 'workspace_target'
  | 'move'
  | 'copy'
  | 'admin_only'
  | 'discard'
  /** The brain refused it as the agent's (403 agent_refused); the held
   *  request carries the brain's `reason`. */
  | 'refused';

/** Words for a held request, by its risk: "<agent> wants to ...". */
export const RISK_TEXT: Record<RequestRisk, string> = {
  delete: 'delete something',
  send: 'send something',
  share: 'change who can see something',
  publish: 'publish something',
  settings: 'change a setting',
  workspace_target: 'put something in a workspace',
  move: 'move something to another place',
  copy: 'make a copy of something',
  admin_only: 'change something only an Admin user may change',
  discard: 'throw away a draft',
  refused: 'do something only you may do',
};

/** The brain's reasons for an agent_refused (its 403's `reason`), in the
 *  same plain words. A reason not named here reads as `refused`. */
const REASON_TEXT: Record<string, string> = {
  delete: RISK_TEXT.delete,
  settings: RISK_TEXT.settings,
  admin_only: RISK_TEXT.admin_only,
  listed: 'send, share or publish something',
  tree_move: RISK_TEXT.move,
  move: RISK_TEXT.move,
  copy: RISK_TEXT.copy,
  workspace_target: RISK_TEXT.workspace_target,
  publish: RISK_TEXT.publish,
  sharing_field: RISK_TEXT.share,
  declared_read: 'run something the brain keeps for you',
  body_unchecked: 'send something the brain could not check',
};

/** What a held request asks, in plain words: by the brain's reason when
 *  the brain refused it, else by its risk. */
export function heldText(risk: RequestRisk, reason: string | null = null): string {
  if (risk === 'refused' && reason && Object.hasOwn(REASON_TEXT, reason)) {
    return REASON_TEXT[reason]!;
  }
  return RISK_TEXT[risk];
}

const RISKY_PATHS: readonly [RegExp, RequestRisk][] = [
  // A new turn or a thread continued: the agent typing into the chat and
  // sending (its own answer and a cancel are let through by the hands).
  [/^\/api\/assistant\/(turn|threads\/[^/]+\/continue)$/, 'send'],
  // The journal and contacts are Admin users' (the brain's admin_only).
  [/^\/api\/(journal|contacts)(\/|$)/, 'admin_only'],
  [/\/restore$/, 'publish'],
  // Throwing a draft away (Revert the draft to the last commit) loses work.
  [/^\/api\/(pages|tables|draws)\/[^/]+\/discard-draft$/, 'discard'],
  [/^\/api\/(recall\/maps|entities\/merge)(\/|$)/, 'publish'],
  [/^\/api\/apps\/[^/]+\/tool-broker$/, 'settings'],
  [
    /^\/api\/(pending|mcp-settings|model-pools|heartbeats|tools|dev-tools|connectors|assistants|integrations|services|maintenance|debug)(\/|$)/,
    'settings',
  ],
  // Admin areas the brain also refuses (fix round contract, section 2).
  [
    /^\/api\/(network|peers|mcp-connectors|external-access|model-combos|updates|tool-groups|gateway-services)(\/|$)/,
    'settings',
  ],
  [/^\/api\/studio\/reset(\/|$)/, 'settings'],
  [/\/(trash|purge|empty)(\/|$)/, 'delete'],
  [/\/(send|reply|forward|messages|messenger|email|emails|mail|telegram|notify)(\/|$)/, 'send'],
  [/\/(share|shares|grants|access|members|invites|visibility|unshare)(\/|$)/, 'share'],
  // A copy lands where the agent says, and is read where its copy is
  // (fix round 2, section 2): a duplicate or copy route of any kind.
  [/\/(duplicate|copy|copies|copy-to)(\/|$)/, 'copy'],
  [/\/(move|moves)(\/|$)/, 'move'],
  [/\/(publish|unpublish|commit|release|deploy)(\/|$)/, 'publish'],
  [
    /\/(settings|profile|keys|api-keys|access-keys|tokens|auth|logins|users|workspaces|agents|models|backups|config|secrets)(\/|$)/,
    'settings',
  ],
];

/** Body fields, at any depth, that change who reads something (the brain's
 *  sharing_field list), compared lower case. */
const SHARING_FIELDS = new Set([
  'share',
  'shares',
  'shared',
  'sharing',
  'visibility',
  'published',
  'publish',
  'public',
  'ispublic',
  'access',
  'members',
  'owner',
]);

/** Body fields that put something in another place (the brain's `move`). */
const MOVE_FIELDS = new Set(['move', 'copy_to', 'parentid', 'parent_id', 'folderid', 'folder_id']);

/** Every key of a JSON body, at any depth, lower case; null when it is not
 *  JSON. A form's (FormData, URLSearchParams) top-level keys. */
function bodyKeys(body: unknown): string[] | null {
  if (body === undefined || body === null) return [];
  if (typeof body === 'string') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return null;
    }
    const keys: string[] = [];
    const stack: unknown[] = [parsed];
    while (stack.length) {
      const v = stack.pop();
      if (Array.isArray(v)) stack.push(...v);
      else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          keys.push(k.toLowerCase());
          stack.push(x);
        }
      }
    }
    return keys;
  }
  const isForm =
    (typeof FormData !== 'undefined' && body instanceof FormData) ||
    (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams);
  if (isForm) return [...(body as FormData | URLSearchParams).keys()].map((k) => k.toLowerCase());
  return [];
}

/**
 * Whether a request the page makes while an agent drives it needs the
 * user's yes first, kept in step with what the brain refuses as the
 * agent's (lib/auth/agent-call.ts there), so the question comes before
 * the request. Reads are never held. A DELETE always is; any other write
 * is held when its path names sending, sharing, publishing, a copy, a move
 * or a setting, when it names a workspace (`?ws=`), or when its body
 * carries a sharing or a move field. Erring wide is the point: an unneeded
 * question costs a click, a missed one could cost the user's data.
 */
export function riskOfRequest(method: string, url: string, body?: unknown): RequestRisk | null {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return null;
  if (m === 'DELETE') return 'delete';
  let parsed: URL;
  try {
    parsed = new URL(url, 'http://app.invalid');
  } catch {
    return 'settings';
  }
  // Matched decoded: `/api/%73hares` is `/api/shares` to the brain. A path
  // that does not decode (a stray `%`) is held: it is no route the app makes.
  const decoded = decodePath(parsed.pathname);
  if (decoded === null) return 'settings';
  const path = decoded.toLowerCase();
  for (const [re, risk] of RISKY_PATHS) if (re.test(path)) return risk;
  // A write aimed at a workspace (the brain's workspace_target).
  if ([...parsed.searchParams.keys()].some((k) => k.toLowerCase() === 'ws')) {
    return 'workspace_target';
  }
  // A field of an ordinary edit that shares it or puts it elsewhere (a
  // page's visibility, an item's folder).
  const keys = bodyKeys(body);
  if (keys === null) {
    const text = String(body).toLowerCase();
    if (
      /"(share|shares|shared|sharing|visibility|published|publish|public|ispublic|access|members|owner)"\s*:/.test(
        text,
      )
    )
      return 'share';
    if (/"(move|copy_to|parentid|parent_id|folderid|folder_id)"\s*:/.test(text)) return 'move';
    return null;
  }
  if (keys.some((k) => SHARING_FIELDS.has(k))) return 'share';
  if (keys.some((k) => MOVE_FIELDS.has(k))) return 'move';
  // An app's trust: what it may reach (its MCP access, its data, its
  // tools). The brain keeps these for Admin users (admin_only).
  if (/^\/api\/apps\/[^/]+$/.test(path) && keys.some((k) => APP_TRUST_FIELDS.has(k))) {
    return 'admin_only';
  }
  return null;
}

/** The fields of an app's PATCH that change what it may reach. */
const APP_TRUST_FIELDS = new Set(['mcpaccess', 'datareadonly', 'trusttools']);

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

/** The header that names the agent's call (or a lesson) on a request it
 *  set off; the brain refuses a risky one (fix round contract, section 2).
 *  This constant, AGENT_REFUSED_ERROR and the `unsafe_route` refusal equal
 *  the brain's `@mantle/client-types/agent-ui` (AGENT_CALL_HEADER,
 *  AGENT_REFUSED_ERROR, AGENT_UI_ERRORS); the contract package this client
 *  pins (0.500.30) has no agent-ui module yet, so they are kept here until
 *  it does. */
export const AGENT_CALL_HEADER = 'x-mantle-agent-call';

/** The `error` of the brain's 403 for a tagged risky write. */
export const AGENT_REFUSED_ERROR = 'agent_refused';

/**
 * Background bookkeeping a screen sends on its own while the agent only
 * opens or reads it: not the agent's write, so it is never tagged (the
 * brain would refuse a tagged one and the user would be asked about it).
 * Each must be something no user sees as an action:
 *  - `POST /api/apps/:id/frame-ticket`: a short-lived ticket to show an
 *    app's frame, minted when an app is shown;
 *  - `POST /api/presents/:id/frame-ticket`: the same for a canvas (a page's
 *    canvas embed, a presentation);
 *  - `POST /api/tree/items/:id/opened`: the Recent and Most used counter an
 *    item's open bumps.
 * Only the exact path, POST, decoded; anything below or beside it is not.
 */
export function isBookkeepingRequest(method: string, url: string): boolean {
  if (method.toUpperCase() !== 'POST') return false;
  let path: string | null;
  try {
    path = decodePath(new URL(url, 'http://app.invalid').pathname);
  } catch {
    return false;
  }
  if (!path) return false;
  return (
    /^\/api\/(apps|presents)\/[^/]+\/frame-ticket$/.test(path) ||
    /^\/api\/tree\/items\/[^/]+\/opened$/.test(path)
  );
}

/** A lesson's tag for that header: `lesson:<uuid>`. */
export function lessonCallTag(uuid: string): string {
  return `lesson:${uuid}`;
}

/** Whether a response is the brain refusing an agent's request
 *  (403 `{ error: "agent_refused" }`). */
export function isAgentRefusal(status: number, body: unknown): boolean {
  return (
    status === 403 &&
    !!body &&
    typeof body === 'object' &&
    (body as { error?: unknown }).error === AGENT_REFUSED_ERROR
  );
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
