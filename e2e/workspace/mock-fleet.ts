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
  /** Phase 2 (ASSUMED shape, docs in client/web/lib/fleet.ts): null is a
   *  brain before the key update, which sends no keyUpdates. */
  keyUpdates: KeyUpdate[] | null;
  /** What each box answers a key call, by box id; absent: ok. A read after
   *  the one that showed `pending` gives the answer, as a run would. */
  keyAnswers: Record<string, { state: 'ok' | 'failed'; reason: string | null }>;
  /** Every key call body the brain was sent. */
  keySent: Record<string, unknown>[];
};

type KeyUpdate = {
  id: string;
  service: string;
  madeBy: string | null;
  madeAt: string;
  boxes: { boxId: string; state: string; reason: string | null; doneAt: string | null }[];
  /** Reads since it was made (not sent). */
  reads?: number;
};

export const newMockFleet = (): MockFleet => ({
  boxes: [{ ...FLEET_BOX }, { ...FLEET_BOX_B }],
  bans: [],
  results: [],
  matches: {},
  sent: [],
  lifted: [],
  keyUpdates: null,
  keyAnswers: {},
  keySent: [],
});

/** The control service's run: a box that showed `pending` once answers. */
function runKeyUpdates(f: MockFleet) {
  for (const u of f.keyUpdates ?? []) {
    u.reads = (u.reads ?? 0) + 1;
    if (u.reads < 2) continue;
    for (const b of u.boxes) {
      if (b.state !== 'pending') continue;
      const a = f.keyAnswers[b.boxId] ?? { state: 'ok', reason: null };
      b.state = a.state;
      b.reason = a.reason;
      b.doneAt = new Date().toISOString();
    }
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
    boxes: f.boxes,
    bans: f.bans,
    results: f.results,
    ...(f.keyUpdates
      ? { keyUpdates: f.keyUpdates.map(({ reads: _reads, ...u }) => u).reverse() }
      : {}),
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
): { status: number; body: unknown } | null {
  if (!path.startsWith('/api/fleet')) return null;
  if (!f) return { status: 404, body: { error: 'not found' } };
  if (path === '/api/fleet' && method === 'GET') {
    runKeyUpdates(f);
    return { status: 200, body: overview(f) };
  }
  if (path === '/api/fleet/keys' && method === 'POST') {
    if (!f.keyUpdates) return { status: 404, body: { error: 'not found' } };
    f.keySent.push(body);
    const boxIds = (body.boxIds as string[] | undefined) ?? [];
    if (!body.service || !body.value || boxIds.length === 0) {
      return { status: 400, body: { error: 'Pick a provider, a key and at least one box.' } };
    }
    const update: KeyUpdate = {
      id: uuid(),
      service: String(body.service),
      madeBy: ADMIN,
      madeAt: new Date().toISOString(),
      boxes: boxIds.map((boxId) => ({ boxId, state: 'pending', reason: null, doneAt: null })),
      reads: 0,
    };
    f.keyUpdates.push(update);
    return { status: 201, body: { update: { id: update.id } } };
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
