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
};

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
});

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
  if (path === '/api/fleet' && method === 'GET') {
    runKeyJobs(f);
    return { status: 200, body: overview(f) };
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
