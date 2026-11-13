/**
 * The Control Center's Fleet routes on the in-memory brain, in the brain's
 * shapes (docs/control-center.md in the mantle repo). `null` in the state is
 * a box that is not a Control Center: every Fleet route answers 404.
 */

const AT = '2026-11-09T08:00:00.000Z';
const ADMIN = 'ada@example.invalid';

type Box = {
  id: string;
  url: string;
  label: string | null;
  ips?: string[];
  addedBy: string | null;
  createdAt: string;
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastReason: string | null;
  loginCount: number | null;
};

export const FLEET_BOX: Box = {
  id: 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1',
  url: 'https://box-a.example.invalid',
  label: 'Box A',
  ips: ['192.0.2.10', '192.0.2.11', '2001:db8::10'],
  addedBy: ADMIN,
  createdAt: AT,
  lastRunAt: AT,
  lastOkAt: AT,
  lastReason: null,
  loginCount: 4,
};

export const FLEET_BOX_B: Box = {
  ...FLEET_BOX,
  id: 'f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2',
  url: 'https://box-b.example.invalid',
  label: null,
  ips: [],
  lastOkAt: null,
  lastReason: 'sig',
  loginCount: null,
};

type Ban = {
  id: string;
  kind: 'disable' | 'archive';
  emails: string[];
  issuer: string | null;
  oid: string | null;
  reason: string | null;
  madeBy: string | null;
  madeAt: string;
  liftedBy: string | null;
  liftedAt: string | null;
  boxesMatched: number;
  loginsMatched: number;
  ownerIds: string[];
};
type Result = {
  banId: string;
  boxId: string;
  matched: number;
  ownerIds: string[];
  updatedAt: string;
};

export type MockFleet = {
  boxes: Box[];
  bans: Ban[];
  results: Result[];
  /** The preview's answer for each box, by email: matched logins, and how
   *  many of them are the box owner. */
  matches: Record<string, { matched: number; owners: number }>;
  /** Every ban body the brain was sent, previews included. */
  sent: { preview: boolean; body: Record<string, unknown> }[];
  lifted: string[];
  /** Phase 2: false is a brain before the key update, whose box rows have
   *  no keyPending or keyResult. */
  keysOn: boolean;
  /** Each box's key job and last answer, by box id (never the key). */
  keyState: Record<
    string,
    {
      keyPending: { service: string; by: string; at: string } | null;
      keyResult: KeyResult | null;
      reads: number;
    }
  >;
  /** What each box answers a key call, by box id; absent: ok. A read after
   *  the one that showed it waiting gives the answer, as a run would. */
  keyAnswers: Record<string, { ok: boolean; reason: string | null }>;
  /** Every key call body the brain was sent. */
  keySent: Record<string, unknown>[];
  /** Phase 3: false is a brain before the fleet matrix, whose box rows have
   *  no factsAt and which has no matrix route. */
  matrixOn: boolean;
  /** Each box's last good facts and the last read's reason, by box id. */
  facts: Record<string, { facts: Facts | null; factsReason: string | null }>;
  /** The `box` query of every matrix read ('' for the whole fleet). */
  matrixReads: string[];
  /** Phase 4: false is a brain before the fleet writes, whose box rows
   *  have no writeJob or writeResult, and which has no write routes. */
  writesOn: boolean;
  /** Each box's write job and last answers, by box id. */
  writeState: Record<
    string,
    { writeJob: { changes: Write[] } | null; writeResult: { results: WriteAnswer[] } | null }
  >;
  /** What each box answers, by box id, then by the change's key (an agent's
   *  slug, or the kind); absent: ok. */
  writeAnswers: Record<string, Record<string, { ok: boolean; reason: string | null }>>;
  /** Every write body the brain was sent, with its route. */
  writeSent: { path: string; body: Record<string, unknown> }[];
  /** The pools GET /api/model-pools lists. */
  pools: { id: string; label: string; description: string; group: string }[];
  /** The Default Model: false is a brain before it (its route 404s). */
  defaultModelOn: boolean;
  /** The stored provider and key id, or null. */
  defaultModel: { provider: string; keyId: string } | null;
  /** Every Default Model write body (null: a clear). */
  defaultModelSent: ({ provider: string; keyId: string } | null)[];
  /** The admin channel (POST /api/fleet/tool): false is a Control Center
   *  before it, whose route answers 404. */
  toolOn: boolean;
  /** A box that does not run tools, by box id: its reason (e.g. scope). */
  toolRefused: Record<string, string>;
  /** What workspace_user_set answers per change, by box id then
   *  `loginId:workspaceId`: a refusal reason; absent: the change is made. */
  memberRefusals: Record<string, Record<string, string>>;
  /** Every POST /api/fleet/tool body. */
  toolSent: Record<string, unknown>[];
  /** A box whose answers come late, by box id: how many asks a call stays
   *  pending first (each ask after the one that made it counts one). */
  toolDelay: Record<string, number>;
  /** users_list's page size (the tool's own is 150); small here so the
   *  screen reads more than one page. */
  usersPage: number;
  /** A box whose answer is too large (truncated), by box id. */
  toolTruncated: Record<string, boolean>;
  /** The calls made and not handed out yet, by call id. */
  toolCalls: Record<string, ToolCall>;
  /** Each box's people list, its last read's reason and its ban-list
   *  logins (only while the people list is null), by box id. */
  people: Record<
    string,
    { people: PeopleList | null; peopleReason: string | null; logins: BanLogin[] | null }
  >;
  /** Fleet sign-in (POST /api/fleet/sso): false is a Control Center before
   *  it, whose route answers 404. */
  ssoOn: boolean;
  /** Each box's sign-in status as the box would answer it, by box id;
   *  absent: the box does not answer (unreachable). */
  ssoStatus: Record<string, SsoStatus>;
  /** The Control Center's view of each box, by box id. */
  ssoView: Record<string, unknown>;
  /** Every POST /api/fleet/sso body (the password and secret included, so
   *  a spec can check what was sent). */
  ssoSent: Record<string, unknown>[];
};

type SsoStatus = {
  mode: 'off' | 'setup' | 'optional' | 'required';
  modeFrom?: 'env' | 'row' | 'none';
  tenant: string | null;
  issuer: string;
  issuerFrom: 'env' | 'row' | 'none';
  clientId: string;
  clientIdFrom: 'env' | 'row' | 'none';
  secret: 'env' | 'row' | 'none';
  secretSetAt: string | null;
  redirectUri: string;
  missing: string[];
  linked: number | null;
  active: number | null;
};

/** The password the mock takes on a Fleet sign-in save. */
export const SSO_PASSWORD = 'the right password';

/** Box A in setup mode with nothing set yet; box B does not answer. */
export function withSso(f: MockFleet): MockFleet {
  f.ssoOn = true;
  f.ssoStatus[FLEET_BOX.id] = {
    mode: 'setup',
    modeFrom: 'row',
    tenant: null,
    issuer: '',
    issuerFrom: 'none',
    clientId: '',
    clientIdFrom: 'env',
    secret: 'none',
    secretSetAt: null,
    redirectUri: 'https://box-a.example.invalid/api/auth/oidc/callback',
    missing: [],
    linked: 0,
    active: 0,
  };
  return f;
}

export type PeopleLogin = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  owner: boolean;
  disabled: boolean;
  archived: boolean;
  lastSignInAt: string | null;
  createdAt: string | null;
  workspaces: { id: string; moderator: boolean }[];
};
export type PeopleList = {
  schema: 1;
  at: string;
  workspaces: { id: string; name: string; admin: boolean }[];
  logins: PeopleLogin[];
};
type BanLogin = {
  id: string;
  email: string;
  owner: boolean;
  disabled: boolean;
  archived: boolean;
  marked: boolean;
};

type ToolCall = {
  id: string;
  boxId: string;
  name: string;
  wait: number;
  answer: { ok: boolean; reason: string | null; output?: unknown; truncated?: true };
};

/** The brain's provider keys the Default Model card offers (never a key:
 *  the masked hint only). */
export const MOCK_DM_CHOICES = [
  {
    provider: 'openrouter',
    providerName: 'OpenRouter',
    keys: [
      { id: 'k-or-1', name: 'openrouter', label: 'default', masked: 'sk-o\u2026abcd' },
      { id: 'k-or-2', name: 'openrouter/work', label: 'work', masked: 'sk-o\u2026wxyz' },
    ],
  },
  {
    provider: 'anthropic',
    providerName: 'Anthropic',
    keys: [{ id: 'k-an-1', name: 'anthropic', label: 'default', masked: 'sk-a\u20261234' }],
  },
];

/** The catalog GET /api/models answers for the Default Model. */
export const MOCK_DM_MODELS = [
  {
    id: 'vendor/catalog-model',
    name: 'Catalog Model',
    contextTokens: 128000,
    inputPricePerM: 3,
    outputPricePerM: 15,
    raw: null,
  },
  {
    id: 'vendor/cheap-model',
    name: 'Cheap Model',
    inputPricePerM: 0.1,
    outputPricePerM: 0.4,
    raw: null,
  },
];

function defaultModelView(f: MockFleet) {
  const d = f.defaultModel;
  const choice = d ? MOCK_DM_CHOICES.find((c) => c.provider === d.provider) : undefined;
  const key = d ? (choice?.keys.find((k) => k.id === d.keyId) ?? null) : null;
  return {
    provider: d?.provider ?? null,
    providerName: d ? (choice?.providerName ?? d.provider) : null,
    key,
    problem: d && !key ? 'key-missing' : null,
    choices: MOCK_DM_CHOICES,
  };
}

type Write = Record<string, unknown> & { kind: string; by: string; at: string; reads?: number };
type WriteAnswer = Write & { ok: boolean; was: string | null; reason: string | null; done: string };

type Facts = Record<string, unknown> & { at: string };

/** Box A's facts: a healthy box, read just now. */
export function boxAFacts(at: string): Facts {
  return {
    schema: 1,
    at,
    status: {
      schema: 1,
      ts: at,
      build: { version: '0.500.42', gitSha: null, buildTime: null },
      process: { uptimeSec: 100, heapUsedBytes: 1, rssBytes: 1 },
      host: {
        scope: 'host',
        cpuLoadPct: 12,
        loadAvg: [0.1, 0.1, 0.1],
        cores: 4,
        mem: { usedBytes: 4, totalBytes: 10, usedPct: 40 },
        disk: { usedBytes: 3, totalBytes: 10, freeBytes: 7, usedPct: 30 },
      },
      postgres: { up: true, dbSizeBytes: 1, connections: 5, cacheHitPct: 99 },
      services: {
        objectStore: true,
        parser: { up: true, running: 0, queued: 0 },
        browser: null,
        documents: true,
        embedder: null,
        sandboxes: true,
        network: true,
      },
      spend: {
        last24hMicroUsd: 1_250_000,
        last7dMicroUsd: 8_000_000,
        last30dMicroUsd: 31_500_000,
        traces24h: 40,
        turns24h: 12,
        errors24h: 0,
      },
      capacity: null,
      extraction: null,
      logins: { admin: 1, member: 3, disabled: 0, total: 4 },
      degraded: [],
    },
    signIn: 'required',
    agents: [
      {
        slug: 'coder',
        role: 'agent',
        provider: 'openrouter',
        model: 'model-a',
        enabled: true,
        assigned: false,
      },
      {
        slug: null,
        role: 'assistant',
        provider: 'openrouter',
        model: 'model-a',
        enabled: true,
        assigned: true,
      },
      {
        slug: null,
        role: 'agent',
        provider: 'openai',
        model: 'model-b',
        enabled: false,
        assigned: false,
      },
    ],
    workers: [{ kind: 'extraction', provider: 'openrouter', model: 'model-c', enabled: true }],
    counts: { workspaces: 3, apps: 2 },
    backup: { lastRunAt: at, ok: true, lastSuccessAt: at },
  };
}

/** Turns the matrix on: Box A read just now, Box B's last read failed
 *  (`sig`) and its old facts stay, with a failed backup. */
export function withMatrix(f: MockFleet): MockFleet {
  const old = boxAFacts(AT);
  f.matrixOn = true;
  f.facts = {
    [FLEET_BOX.id]: { facts: boxAFacts(new Date().toISOString()), factsReason: null },
    [FLEET_BOX_B.id]: {
      facts: {
        ...old,
        signIn: 'off',
        backup: { lastRunAt: AT, ok: false, lastSuccessAt: null },
        status: {
          ...(old.status as object),
          postgres: { up: false, dbSizeBytes: null, connections: null, cacheHitPct: null },
        },
      },
      factsReason: 'sig',
    },
  };
  return f;
}

type KeyResult = { service: string; ok: boolean; reason: string | null; by: string; at: string };

export const newMockFleet = (): MockFleet => ({
  boxes: [{ ...FLEET_BOX }, { ...FLEET_BOX_B }],
  bans: [],
  results: [],
  matches: {},
  sent: [],
  lifted: [],
  keysOn: false,
  keyState: {},
  keyAnswers: {},
  keySent: [],
  matrixOn: false,
  facts: {},
  matrixReads: [],
  writesOn: false,
  writeState: {},
  writeAnswers: {},
  writeSent: [],
  pools: [
    { id: 'agents', label: 'Agents', description: 'Every agent.', group: 'agents' },
    { id: 'vision', label: 'Read images', description: 'The vision worker.', group: 'workers' },
  ],
  defaultModelOn: false,
  defaultModel: null,
  defaultModelSent: [],
  toolOn: false,
  toolRefused: {},
  memberRefusals: {},
  toolSent: [],
  toolDelay: {},
  toolTruncated: {},
  usersPage: 150,
  toolCalls: {},
  people: {},
  ssoOn: false,
  ssoStatus: {},
  ssoView: {},
  ssoSent: [],
});

/** The ids of the Fleet users data: logins and workspaces on each box. */
export const PEOPLE = {
  a: {
    admin: 'a0000000-0000-4000-8000-00000000000a',
    projects: 'a0000000-0000-4000-8000-0000000000a1',
    ops: 'a0000000-0000-4000-8000-0000000000a2',
    field: 'a0000000-0000-4000-8000-0000000000a3',
    owner: 'a1000000-0000-4000-8000-000000000001',
    ann: 'a1000000-0000-4000-8000-000000000002',
    bob: 'a1000000-0000-4000-8000-000000000003',
    carol: 'a1000000-0000-4000-8000-000000000004',
    dan: 'a1000000-0000-4000-8000-000000000005',
  },
  b: {
    admin: 'b0000000-0000-4000-8000-00000000000b',
    projects: 'b0000000-0000-4000-8000-0000000000b1',
    ops: 'b0000000-0000-4000-8000-0000000000b2',
    ann: 'b1000000-0000-4000-8000-000000000002',
    erin: 'b1000000-0000-4000-8000-000000000006',
  },
} as const;

const RECENT = () => new Date(Date.now() - 2 * 86_400_000).toISOString();
const login = (p: Partial<PeopleLogin> & { id: string; email: string }): PeopleLogin => ({
  name: null,
  role: 'member',
  owner: false,
  disabled: false,
  archived: false,
  lastSignInAt: RECENT(),
  createdAt: AT,
  workspaces: [],
  ...p,
});

/**
 * Turns Fleet users on (and the fleet writes it needs). Box A: its owner,
 * Ann (an Admin, also on Box B), Bob (the one Moderator of Projects), Carol
 * (disabled, in no workspace, banned) and Dan (never signed in). Box B: Ann
 * and Erin. Box B names its Projects workspace in lower case.
 */
export function withPeople(f: MockFleet): MockFleet {
  const a = PEOPLE.a;
  const b = PEOPLE.b;
  const at = new Date().toISOString();
  f.toolOn = true;
  // Box A's five logins come in three pages.
  f.usersPage = 2;
  f.people = {
    [FLEET_BOX.id]: {
      peopleReason: null,
      logins: null,
      people: {
        schema: 1,
        at,
        workspaces: [
          { id: a.admin, name: 'Admin', admin: true },
          { id: a.projects, name: 'Projects', admin: false },
          { id: a.ops, name: 'Ops', admin: false },
          { id: a.field, name: 'Field', admin: false },
        ],
        logins: [
          login({
            id: a.owner,
            email: 'owner@example.com',
            name: 'Box Owner',
            role: 'admin',
            owner: true,
            workspaces: [{ id: a.admin, moderator: true }],
          }),
          login({
            id: a.ann,
            email: 'ann@example.com',
            name: 'Ann Admin',
            role: 'admin',
            workspaces: [
              { id: a.admin, moderator: true },
              { id: a.projects, moderator: false },
              { id: a.field, moderator: false },
            ],
          }),
          login({
            id: a.bob,
            email: 'bob@example.com',
            name: 'Bob Builder',
            workspaces: [{ id: a.projects, moderator: true }],
          }),
          login({
            id: a.carol,
            email: 'carol@example.com',
            name: 'Carol Gone',
            disabled: true,
          }),
          login({
            id: a.dan,
            email: 'dan@example.com',
            name: 'Dan New',
            lastSignInAt: null,
            workspaces: [{ id: a.ops, moderator: false }],
          }),
        ],
      },
    },
    [FLEET_BOX_B.id]: {
      peopleReason: null,
      logins: null,
      people: {
        schema: 1,
        at,
        workspaces: [
          { id: b.admin, name: 'Admin', admin: true },
          { id: b.projects, name: 'projects', admin: false },
          { id: b.ops, name: 'Ops', admin: false },
        ],
        logins: [
          login({
            id: b.ann,
            email: 'ann@example.com',
            name: 'Ann Admin',
            workspaces: [{ id: b.ops, moderator: false }],
          }),
          login({
            id: b.erin,
            email: 'erin@example.com',
            name: 'Erin Field',
            workspaces: [{ id: b.projects, moderator: true }],
          }),
        ],
      },
    },
  };
  // Carol is banned: an active ban holds her email.
  f.bans.push({
    id: 'e0e0e0e0-0000-4000-8000-0000000000c0',
    kind: 'disable',
    emails: ['carol@example.com'],
    issuer: null,
    oid: null,
    reason: 'Left',
    madeBy: ADMIN,
    madeAt: AT,
    liftedBy: null,
    liftedAt: null,
    boxesMatched: 1,
    loginsMatched: 1,
    ownerIds: [],
  });
  return f;
}

/** What a login is in a workspace now: none, user or moderator. */
function memberWas(f: MockFleet, boxId: string, loginId: string, workspaceId: string) {
  const l = f.people[boxId]?.people?.logins.find((x) => x.id === loginId);
  const m = l?.workspaces.find((w) => w.id === workspaceId);
  return { login: l, was: m ? (m.moderator ? 'moderator' : 'user') : 'none' };
}

/** A workspace change made on the box: its people list then shows it. */
function applyMember(
  f: MockFleet,
  boxId: string,
  c: { loginId: unknown; workspaceId: unknown; role: unknown },
) {
  const list = f.people[boxId]?.people;
  const l = list?.logins.find((x) => x.id === c.loginId);
  if (!list || !l) return;
  l.workspaces = l.workspaces.filter((w) => w.id !== c.workspaceId);
  if (c.role !== 'none')
    l.workspaces.push({ id: String(c.workspaceId), moderator: c.role === 'moderator' });
  list.at = new Date().toISOString();
}

type Agent = { slug: string | null; model: string };

/** The control service's run: a change a box showed waiting once is
 *  answered at the next read, in order, and an agent model then shows in
 *  the facts. */
function runWriteJobs(f: MockFleet) {
  for (const [boxId, w] of Object.entries(f.writeState)) {
    const changes = w.writeJob?.changes ?? [];
    if (changes.length === 0) continue;
    const due = changes.filter((c) => (c.reads = (c.reads ?? 0) + 1) >= 2);
    if (due.length === 0) continue;
    const agents = (f.facts[boxId]?.facts?.agents ?? []) as Agent[];
    const answers = due.map((c): WriteAnswer => {
      const { reads, ...change } = c;
      void reads;
      const key = c.kind === 'agentModel' ? String(c.slug) : c.kind;
      const row = c.kind === 'agentModel' ? agents.find((a) => a.slug === c.slug) : undefined;
      const a =
        f.writeAnswers[boxId]?.[key] ??
        (c.kind !== 'agentModel' || row
          ? { ok: true, reason: null }
          : { ok: false, reason: 'agent' });
      let was: string | null = null;
      if (c.kind === 'agentModel') {
        was = row ? row.model : null;
        if (a.ok && row) row.model = String(c.model);
      } else if (c.kind === 'updateNotice') was = 'off';
      else if (a.ok) was = 'added';
      return { ...change, ok: a.ok, was, reason: a.reason, done: new Date().toISOString() };
    });
    const rest = changes.slice(due.length);
    w.writeJob = rest.length ? { changes: rest } : null;
    w.writeResult = { results: [...(w.writeResult?.results ?? []), ...answers].slice(-40) };
  }
}

/** Queues the changes for the boxes asked (all when none), as
 *  queueControlWrites does: a box that would hold more than 40 is left out. */
function queueWrites(f: MockFleet, path: string, body: Record<string, unknown>, changes: Write[]) {
  f.writeSent.push({ path, body });
  const wanted = (body.boxIds as string[] | undefined) ?? f.boxes.map((b) => b.id);
  const queued: string[] = [];
  for (const b of f.boxes) {
    if (!wanted.includes(b.id)) continue;
    const w = (f.writeState[b.id] ??= { writeJob: null, writeResult: null });
    const waiting = w.writeJob?.changes ?? [];
    if (waiting.length + changes.length > 40) continue;
    w.writeJob = { changes: [...waiting, ...changes.map((c) => ({ ...c }))] };
    queued.push(b.id);
  }
  return { status: 200, body: { changes, queued: queued.length, boxIds: queued } };
}

/** The control service's run: a box that showed its key job once answers. */
function runKeyJobs(f: MockFleet) {
  for (const [boxId, k] of Object.entries(f.keyState)) {
    if (!k.keyPending) continue;
    k.reads += 1;
    if (k.reads < 2) continue;
    const a = f.keyAnswers[boxId] ?? { ok: true, reason: null };
    k.keyResult = {
      service: k.keyPending.service,
      ok: a.ok,
      reason: a.reason,
      by: k.keyPending.by,
      at: new Date().toISOString(),
    };
    k.keyPending = null;
  }
}

function overview(f: MockFleet) {
  return {
    service: {
      publicKey: 'ed25519:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      fingerprint: 'SHA256:mock-fingerprint',
      lastTickAt: new Date().toISOString(),
    },
    envLines: [
      'MANTLE_CONTROL_CENTER=https://cc.example.invalid',
      'MANTLE_CONTROL_CENTER_KEY=ed25519:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    ],
    boxes: f.boxes.map((b) => ({
      ...b,
      ...(f.keysOn
        ? {
            keyPending: f.keyState[b.id]?.keyPending ?? null,
            keyResult: f.keyState[b.id]?.keyResult ?? null,
          }
        : {}),
      ...(f.matrixOn ? { factsAt: f.facts[b.id]?.facts?.at ?? null } : {}),
      ...(f.writesOn
        ? {
            writeJob: f.writeState[b.id]?.writeJob
              ? {
                  changes: f.writeState[b.id]!.writeJob!.changes.map(({ reads, ...c }) => {
                    void reads;
                    return c;
                  }),
                }
              : null,
            writeResult: f.writeState[b.id]?.writeResult ?? null,
          }
        : {}),
    })),
    bans: f.bans,
    results: f.results,
  };
}

let next = 0;
const uuid = () => {
  next += 1;
  return `e0e0e0e0-0000-4000-8000-${String(next).padStart(12, '0')}`;
};

export function fleetAnswer(
  f: MockFleet | null,
  path: string,
  method: string,
  body: Record<string, unknown>,
  query: URLSearchParams = new URLSearchParams(),
): { status: number; body: unknown } | null {
  // The pools the pool entry form offers (the brain's own list).
  if (path === '/api/model-pools' && method === 'GET' && f?.writesOn) {
    return { status: 200, body: { pools: f.pools, entries: [] } };
  }
  // The Default Model's catalog (the Models screen's route).
  if (path === '/api/models' && method === 'GET' && f?.defaultModelOn) {
    return { status: 200, body: { models: MOCK_DM_MODELS } };
  }
  if (!path.startsWith('/api/fleet')) return null;
  if (!f) return { status: 404, body: { error: 'not found' } };
  if (path === '/api/fleet/matrix' && method === 'GET') {
    if (!f.matrixOn) return { status: 404, body: { error: 'not found' } };
    const one = query.get('box');
    f.matrixReads.push(one ?? '');
    const boxes = f.boxes
      .filter((b) => one === null || b.id === one)
      .map((b) => ({
        id: b.id,
        url: b.url,
        label: b.label,
        lastOkAt: b.lastOkAt,
        lastReason: b.lastReason,
        facts: f.facts[b.id]?.facts ?? null,
        factsReason: f.facts[b.id]?.factsReason ?? null,
      }));
    return { status: 200, body: { boxes } };
  }
  if (path === '/api/fleet/sso' && method === 'POST') return ssoAnswer(f, body);
  if (path === '/api/fleet/tool' && method === 'POST') {
    if (!f.toolOn) return { status: 404, body: { error: 'not found' } };
    f.toolSent.push(body);
    // The route's reply: the answers that came (each handed out once), the
    // calls still on their way, and ids no box holds.
    const reply = (ids: string[]) => {
      const answers: unknown[] = [];
      const pending: string[] = [];
      const gone: string[] = [];
      for (const id of ids) {
        const c = f.toolCalls[id];
        if (!c) {
          gone.push(id);
          continue;
        }
        if (c.wait > 0) {
          pending.push(id);
          continue;
        }
        delete f.toolCalls[id];
        answers.push({
          id,
          boxId: c.boxId,
          kind: 'tool',
          name: c.name,
          by: ADMIN,
          at: AT,
          sentAt: AT,
          done: new Date().toISOString(),
          ...c.answer,
        });
      }
      return { status: 200, body: { answers, pending, gone } };
    };
    if (Array.isArray(body.callIds)) {
      const ids = body.callIds as string[];
      for (const id of ids) {
        const c = f.toolCalls[id];
        if (c && c.wait > 0) c.wait -= 1;
      }
      return reply(ids);
    }
    const boxIds = (body.boxIds as string[] | undefined) ?? [];
    const name = String(body.name ?? '');
    const args = (body.args as Record<string, unknown> | undefined) ?? {};
    const linked = boxIds.filter((id) => f.boxes.some((b) => b.id === id));
    if (linked.length === 0) {
      return { status: 400, body: { error: 'No call was queued.' } };
    }
    const made = linked.map((boxId) => {
      const id = uuid();
      f.toolCalls[id] = {
        id,
        boxId,
        name,
        wait: f.toolDelay[boxId] ?? 0,
        answer: runTool(f, boxId, name, args),
      };
      return id;
    });
    return reply(made);
  }
  if (path === '/api/fleet' && method === 'GET') {
    runKeyJobs(f);
    runWriteJobs(f);
    return { status: 200, body: overview(f) };
  }
  if (path === '/api/fleet/default-model') {
    if (!f.defaultModelOn) return { status: 404, body: { error: 'not found' } };
    if (method === 'PUT') {
      const next = { provider: String(body.provider), keyId: String(body.keyId) };
      f.defaultModelSent.push(next);
      f.defaultModel = next;
    } else if (method === 'DELETE') {
      f.defaultModelSent.push(null);
      f.defaultModel = null;
    }
    return { status: 200, body: defaultModelView(f) };
  }
  if (path === '/api/fleet/models' && method === 'POST') {
    if (!f.writesOn) return { status: 404, body: { error: 'not found' } };
    const changes = (body.changes as { slug: string; model: string }[] | undefined) ?? [];
    if (changes.length === 0) {
      f.writeSent.push({ path, body });
      return { status: 400, body: { error: 'Give 1 to 20 changes.' } };
    }
    const at = new Date().toISOString();
    const stamped = changes.map((c) => ({ kind: 'agentModel', ...c, by: ADMIN, at }));
    return queueWrites(f, path, body, stamped);
  }
  if (path === '/api/fleet/settings' && method === 'POST') {
    if (!f.writesOn) return { status: 404, body: { error: 'not found' } };
    const changes = (body.changes as Record<string, unknown>[] | undefined) ?? [];
    if (changes.length === 0 || changes.some((c) => typeof c.kind !== 'string')) {
      f.writeSent.push({ path, body });
      return { status: 400, body: { error: 'Give 1 to 20 changes.' } };
    }
    const at = new Date().toISOString();
    const stamped = changes.map((c) => ({ ...c, kind: String(c.kind), by: ADMIN, at }));
    return queueWrites(f, path, body, stamped);
  }
  if (path === '/api/fleet/keys' && method === 'POST') {
    if (!f.keysOn) return { status: 404, body: { error: 'not found' } };
    f.keySent.push(body);
    if (!body.service || !body.value) {
      return { status: 400, body: { error: 'value must be the key, 1 to 8192 characters.' } };
    }
    // No boxIds: every linked box, as the brain's route does.
    const wanted = (body.boxIds as string[] | undefined) ?? f.boxes.map((b) => b.id);
    const queued = f.boxes.filter((b) => wanted.includes(b.id)).map((b) => b.id);
    const at = new Date().toISOString();
    for (const id of queued) {
      f.keyState[id] = {
        keyPending: { service: String(body.service), by: ADMIN, at },
        keyResult: f.keyState[id]?.keyResult ?? null,
        reads: 0,
      };
    }
    return {
      status: 200,
      body: { service: body.service, queued: queued.length, boxIds: queued },
    };
  }
  if (path === '/api/fleet/boxes' && method === 'POST') {
    const url = String(body.url ?? '');
    if (!url.startsWith('https://')) {
      return { status: 400, body: { error: 'The box URL must start with https://.' } };
    }
    const box = {
      ...FLEET_BOX,
      id: uuid(),
      url,
      label: (body.label as string | null) ?? null,
      ips: [],
      lastRunAt: null,
      lastOkAt: null,
      loginCount: null,
    };
    f.boxes.push(box);
    return { status: 201, body: { box } };
  }
  const box = /^\/api\/fleet\/boxes\/([^/]+)$/.exec(path);
  if (box && method === 'DELETE') {
    const before = f.boxes.length;
    f.boxes = f.boxes.filter((b) => b.id !== box[1]);
    if (f.boxes.length === before) return { status: 404, body: { error: 'Box not found.' } };
    return { status: 200, body: { ok: true } };
  }
  if (path === '/api/fleet/bans' && method === 'POST') {
    const preview = body.preview === true;
    const rest = { ...body };
    delete rest.preview;
    f.sent.push({ preview, body: rest });
    const emails = (rest.emails as string[] | undefined) ?? [];
    if (emails.length === 0 && !rest.oid) {
      return {
        status: 400,
        body: { error: 'A ban needs an email, or a sign-in issuer and object id.' },
      };
    }
    const hit = emails.map((e) => f.matches[e]).find(Boolean) ?? { matched: 0, owners: 0 };
    if (preview) {
      return {
        status: 200,
        body: {
          preview: {
            boxes: f.boxes.map((b) => ({
              boxId: b.id,
              url: b.url,
              label: b.label,
              matched: b.loginCount === null ? null : hit.matched,
              owners: b.loginCount === null ? 0 : hit.owners,
            })),
            unknown: f.boxes.filter((b) => b.loginCount === null).length,
          },
        },
      };
    }
    const ban: Ban = {
      id: uuid(),
      kind: (rest.kind as Ban['kind']) ?? 'disable',
      emails,
      issuer: (rest.issuer as string | null) ?? null,
      oid: (rest.oid as string | null) ?? null,
      reason: (rest.reason as string | null) ?? null,
      madeBy: ADMIN,
      madeAt: new Date().toISOString(),
      liftedBy: null,
      liftedAt: null,
      boxesMatched: hit.matched > 0 ? 1 : 0,
      loginsMatched: hit.matched,
      ownerIds: hit.owners > 0 ? ['owner-id'] : [],
    };
    f.bans.push(ban);
    if (hit.matched > 0) {
      f.results.push({
        banId: ban.id,
        boxId: f.boxes[0]!.id,
        matched: hit.matched,
        ownerIds: ban.ownerIds,
        updatedAt: ban.madeAt,
      });
    }
    return { status: 201, body: { ban } };
  }
  const lift = /^\/api\/fleet\/bans\/([^/]+)\/lift$/.exec(path);
  if (lift && method === 'POST') {
    const ban = f.bans.find((b) => b.id === lift[1] && !b.liftedAt);
    if (!ban) return { status: 404, body: { error: 'No active ban with that id.' } };
    ban.liftedAt = new Date().toISOString();
    ban.liftedBy = ADMIN;
    f.lifted.push(ban.id);
    return { status: 200, body: { ban } };
  }
  return null;
}

/** What a box's own tool answers (users_list, workspace_user_set). */
function runTool(
  f: MockFleet,
  boxId: string,
  name: string,
  args: Record<string, unknown>,
): ToolCall['answer'] {
  const refused = f.toolRefused[boxId];
  if (refused) return { ok: false, reason: refused };
  if (f.toolTruncated[boxId])
    return { ok: true, reason: null, output: '{"logins":[', truncated: true };
  if (name === 'users_list') {
    const people = f.people[boxId]?.people;
    if (!people) return { ok: false, reason: 'error' };
    // The tool's own paging: { offset, limit } in, { total, offset, next } out.
    const limit = Math.min(Number(args.limit ?? 150) || 150, 150, f.usersPage);
    const offset = Math.max(0, Number(args.offset ?? 0) || 0);
    const end = offset + limit;
    return {
      ok: true,
      reason: null,
      output: {
        ...people,
        at: new Date().toISOString(),
        logins: people.logins.slice(offset, end),
        total: people.logins.length,
        offset,
        next: end < people.logins.length ? end : null,
      },
    };
  }
  if (name === 'workspace_user_set') {
    const changes = (args.changes as Record<string, unknown>[] | undefined) ?? [];
    if (changes.length < 1 || changes.length > 20) return { ok: false, reason: 'refused' };
    const results = changes.map((c) => {
      const loginId = String(c.loginId);
      const workspaceId = String(c.workspaceId);
      const { login: l, was } = memberWas(f, boxId, loginId, workspaceId);
      const reason = f.memberRefusals[boxId]?.[`${loginId}:${workspaceId}`] ?? (l ? null : 'login');
      if (reason) return { loginId, workspaceId, ok: false, reason };
      applyMember(f, boxId, c as { loginId: unknown; workspaceId: unknown; role: unknown });
      return { loginId, workspaceId, ok: true, was };
    });
    return { ok: true, reason: null, output: { results } };
  }
  return { ok: false, reason: 'tool' };
}

/** POST /api/fleet/sso: every ask is answered at once (nothing pending). */
function ssoAnswer(f: MockFleet, body: Record<string, unknown>): { status: number; body: unknown } {
  if (!f.ssoOn) return { status: 404, body: { error: 'not found' } };
  f.ssoSent.push(body);
  if (body.do === 'list') {
    return {
      status: 200,
      body: {
        boxes: f.boxes.map((b) => ({
          id: b.id,
          url: b.url,
          label: b.label,
          lastOkAt: b.lastOkAt,
          lastReason: b.lastReason,
          version: b.id === FLEET_BOX.id ? '0.601.0' : null,
          ssoView: f.ssoView[b.id] ?? null,
        })),
      },
    };
  }
  if ((body.do === 'set' || body.do === 'mode') && body.password !== SSO_PASSWORD) {
    return { status: 403, body: { code: 'password', error: 'That password is not right.' } };
  }
  const at = new Date().toISOString();
  const one = body.do === 'set' || body.do === 'mode';
  const boxIds = one ? [String(body.boxId)] : ((body.boxIds as string[]) ?? []);
  const name =
    body.do === 'set'
      ? 'sso_set'
      : body.do === 'mode'
        ? 'sso_mode'
        : body.do === 'test'
          ? 'sso_test'
          : 'sso_status';
  const answers = boxIds.map((boxId) => {
    const prev = (f.ssoView[boxId] ?? null) as Record<string, unknown> | null;
    const status = f.ssoStatus[boxId];
    const base = { id: uuid(), boxId, kind: 'sso', name, by: ADMIN, at, done: at };
    if (!status) {
      f.ssoView[boxId] = {
        ...(prev ?? { test: null, set: null }),
        at,
        reason: 'unreachable',
        status: prev?.status ?? null,
      };
      return { ...base, ok: false, reason: 'unreachable' };
    }
    if (body.do === 'mode') {
      // The box's rule: no .env mode line, and one step up only.
      const order = ['off', 'setup', 'optional', 'required'];
      const from = status.mode;
      const reason =
        status.modeFrom === 'env'
          ? 'env-wins'
          : order.indexOf(String(body.mode)) !== order.indexOf(from) + 1
            ? 'mode'
            : null;
      if (!reason) {
        status.mode = body.mode as SsoStatus['mode'];
        status.modeFrom = 'row';
      }
      f.ssoView[boxId] = {
        ...(prev ?? { test: null, set: null }),
        at,
        reason: null,
        status: { ...status },
        mode: { to: body.mode, from, ok: !reason, reason, by: ADMIN, at },
      };
      return {
        ...base,
        ok: !reason,
        reason,
        output: { ok: !reason, ...(reason ? { reason } : {}), from, status: { ...status } },
      };
    }
    let test: string | undefined;
    if (body.do === 'test') test = status.secret === 'none' ? 'no-secret' : 'ok';
    const fields: string[] = [];
    if (body.do === 'set') {
      if (typeof body.tenant === 'string') {
        status.tenant = body.tenant;
        status.issuerFrom = 'row';
        fields.push('tenant');
      }
      if (typeof body.secret === 'string') {
        status.secret = 'row';
        status.secretSetAt = at;
        fields.push('secret');
      }
    }
    f.ssoView[boxId] = {
      ...(prev ?? {}),
      at,
      reason: null,
      status: { ...status },
      test: test ? { code: test, at, by: ADMIN } : ((prev?.test as unknown) ?? null),
      set:
        body.do === 'set'
          ? { fields, ok: true, reason: null, by: ADMIN, at }
          : ((prev?.set as unknown) ?? null),
    };
    return {
      ...base,
      ok: true,
      reason: null,
      output: { ok: true, ...(test ? { test } : {}), status: { ...status } },
    };
  });
  return { status: 200, body: { answers, pending: [], gone: [] } };
}
