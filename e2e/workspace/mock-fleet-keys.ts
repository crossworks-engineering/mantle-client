/**
 * Key status on the fleet on the in-memory brain (mantle
 * docs/control-center.md, "Key status on the fleet"): GET /api/fleet/keys
 * and POST /api/fleet/keys/test, in the brain's shapes. The state hangs off
 * the fleet object, so mock-fleet.ts keeps its own shape. Off (the default)
 * is a Control Center a release behind: both routes answer 404.
 */
import type { FleetKeyBox, FleetKeyLine } from '@mantle/client-types';
import { FLEET_BOX, FLEET_BOX_B, type MockFleet } from './mock-fleet';

export type KeyStatusState = {
  on: boolean;
  /** GET's boxes, in its order: `self` first, then the linked boxes. */
  boxes: FleetKeyBox[];
  /** What a box answers Test now, by id; absent: `ok`. */
  testAnswers: Record<string, string>;
  /** What GET shows for a box once a `pending` test has run there. */
  afterPending: Record<string, FleetKeyBox>;
  /** The next POST answers 429 (too many presses). */
  limited: boolean;
  /** Every POST /api/fleet/keys/test body. */
  sent: Record<string, unknown>[];
  /** GETs answered. */
  reads: number;
};

const states = new WeakMap<MockFleet, KeyStatusState>();

/** The key status state of `f` (made on first use, off). */
export function keyStatusState(f: MockFleet): KeyStatusState {
  let s = states.get(f);
  if (!s) {
    s = {
      on: false,
      boxes: [],
      testAnswers: {},
      afterPending: {},
      limited: false,
      sent: [],
      reads: 0,
    };
    states.set(f, s);
  }
  return s;
}

/** An ISO time `min` minutes ago. */
export const minAgo = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

/** The prints (made-up, the brain's shape: head, the mark, last 4). */
export const PRINT_NEW = 'sk-or-v1-abc…wxyz';
export const PRINT_OLD = 'sk-or-v1-def…qrst';

export const keyLine = (over: Partial<FleetKeyLine> = {}): FleetKeyLine => ({
  service: 'openrouter',
  setAt: minAgo(60),
  print: PRINT_NEW,
  testable: true,
  test: { ok: true, at: minAgo(5) },
  state: 'works',
  ...over,
});

export const keyBox = (over: Partial<FleetKeyBox> & Pick<FleetKeyBox, 'id'>): FleetKeyBox => ({
  url: null,
  label: null,
  at: minAgo(2),
  reason: null,
  keys: [],
  keysReason: null,
  lastSet: null,
  ...over,
});

export const SELF_BOX = () =>
  keyBox({
    id: 'self',
    keys: [
      keyLine(),
      keyLine({
        service: 'anthropic',
        print: 'sk-ant-api03…mnop',
        setAt: minAgo(30),
        test: { ok: true, at: minAgo(600) },
        state: 'stale',
      }),
    ],
  });

/** The five states on three boxes: this box (works, stale), Box A
 *  (failed with an older key, never tested, no test; its last read failed),
 *  Box B a release behind. */
export function withKeyStatus(f: MockFleet): MockFleet {
  const s = keyStatusState(f);
  s.on = true;
  s.boxes = [
    SELF_BOX(),
    keyBox({
      id: FLEET_BOX.id,
      url: FLEET_BOX.url,
      label: FLEET_BOX.label,
      at: minAgo(45),
      reason: 'unreachable',
      keys: [
        keyLine({
          setAt: minAgo(60 * 24 * 9),
          print: PRINT_OLD,
          test: { ok: false, at: minAgo(20) },
          state: 'failed',
        }),
        keyLine({ service: 'elevenlabs', print: null, test: null, state: 'not-tested' }),
        keyLine({
          service: 'firecrawl',
          print: 'fc-12345678…9876',
          testable: false,
          test: null,
          state: 'no-test',
        }),
      ],
      lastSet: {
        service: 'openrouter',
        ok: false,
        reason: 'failed',
        by: 'ada@example.invalid',
        at: minAgo(20),
      },
    }),
    keyBox({
      id: FLEET_BOX_B.id,
      url: FLEET_BOX_B.url,
      label: FLEET_BOX_B.label,
      at: null,
      keys: null,
      keysReason: 'old-box',
    }),
  ];
  return f;
}

/** A box after a good test: each testable line tested now. */
function testedNow(b: FleetKeyBox): FleetKeyBox {
  const at = new Date().toISOString();
  return {
    ...b,
    at,
    reason: null,
    keys:
      b.keys?.map((l) =>
        l.testable
          ? {
              ...l,
              test: { ok: l.state !== 'failed', at },
              state: l.state === 'failed' ? 'failed' : 'works',
            }
          : l,
      ) ?? b.keys,
  };
}

export function keyStatusAnswer(
  f: MockFleet,
  path: string,
  method: string,
  body: Record<string, unknown>,
): { status: number; body: unknown } {
  const s = keyStatusState(f);
  if (!s.on) return { status: 404, body: { error: 'not found' } };
  if (path === '/api/fleet/keys' && method === 'GET') {
    s.reads += 1;
    return { status: 200, body: { boxes: s.boxes } };
  }
  if (path !== '/api/fleet/keys/test' || method !== 'POST') {
    return { status: 405, body: { error: 'method' } };
  }
  s.sent.push(body);
  if (s.limited) {
    s.limited = false;
    return { status: 429, body: { error: 'Too many requests.' } };
  }
  const asked = (body.boxIds as string[] | undefined) ?? s.boxes.map((b) => b.id);
  const out: (FleetKeyBox & { tested: string })[] = [];
  s.boxes = s.boxes.map((b) => {
    if (!asked.includes(b.id)) return b;
    const tested = s.testAnswers[b.id] ?? 'ok';
    if (tested === 'ok') {
      const fresh = testedNow(b);
      out.push({ ...fresh, tested });
      return fresh;
    }
    // The box's last kept lines; a pending one has its run later.
    out.push({ ...b, tested });
    return tested === 'pending' ? (s.afterPending[b.id] ?? b) : b;
  });
  return { status: 200, body: { boxes: out } };
}
