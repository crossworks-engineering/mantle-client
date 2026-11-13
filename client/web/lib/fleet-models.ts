/**
 * Set an agent's model on the fleet (Control Center phase 4;
 * docs/control-center.md in the mantle repo, "Set an agent's model on the
 * fleet"). POST /api/fleet/models { changes: [{ slug, model }], boxIds? }
 * queues the changes per box, in the box's one write job (fleet-writes.ts).
 * Pure, so it is unit-tested.
 */
import { FLEET_PATH, type FleetBox } from './fleet';
import type { FleetMatrixRow } from './fleet-matrix';
import type { FleetWriteAnswer, FleetWriteChange } from './fleet-writes';

export const FLEET_MODELS_PATH = `${FLEET_PATH}/models`;

/** A model id as the brain takes one (CONTROL_MODEL_ID in the mantle repo).
 *  A leading `~` (a "latest" alias) or `@` (a preset) is part of the id. */
export const MODEL_ID = /^(?=.{1,200}$)[~@]?[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/;

/** The shipped agents the matrix names on any box, each once, sorted. A
 *  person's own assistant and a custom agent have no slug there. */
export function shippedSlugs(rows: readonly FleetMatrixRow[]): string[] {
  const out = new Set<string>();
  for (const r of rows) for (const a of r.facts?.agents ?? []) if (a.slug) out.add(a.slug);
  return [...out].sort();
}

/** The agent's model on a box as the matrix last read it, or null when the
 *  box has no facts or no such agent. */
export function currentModel(row: FleetMatrixRow, slug: string): string | null {
  const agent = row.facts?.agents.find((a) => a.slug === slug);
  return agent ? agent.model : null;
}

// --- two boxes, side by side (the matrix's model compare) ------------------------

/** The most changes one models request takes (the route's cap). */
export const MAX_MODEL_CHANGES = 20;

/** The two boxes the compare opens on: the box this page runs on when it is
 *  a linked box too (`origin`, the page's own origin), else the first box;
 *  then the first other box. Null where there is none. */
export function defaultPair(
  rows: readonly Pick<FleetMatrixRow, 'id' | 'url'>[],
  origin: string | null,
): [string | null, string | null] {
  const self = origin ? rows.find((r) => sameOrigin(r.url, origin)) : undefined;
  const left = self ?? rows[0];
  const right = rows.find((r) => r.id !== left?.id);
  return [left?.id ?? null, right?.id ?? null];
}

function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

/** A model as one box runs it: the id (`''`: no model), null where the box
 *  has no facts or no such item, undefined where it is not known which one
 *  runs (a box before the workers' `default` flag, with two of a kind). */
export type BoxModel = string | null | undefined;

/** What one box runs for an item: its route (provider, and endpoint print:
 *  undefined from a box before the print) and model, or null and undefined
 *  as for BoxModel. */
export type BoxRun = { provider: string; endpoint?: string; model: string } | null | undefined;

const modelOf = (run: BoxRun): BoxModel => (run ? run.model : run);

/** One agent, or one worker kind, across the two boxes. */
export type CompareLine = {
  key: string;
  left: BoxModel;
  right: BoxModel;
  leftProvider: string | null;
  rightProvider: string | null;
  /** Endpoint prints; undefined where the box sends none (a release
   *  behind), null where it does not run the item. */
  leftEndpoint: string | null | undefined;
  rightEndpoint: string | null | undefined;
  /** Both boxes run it, with different models. */
  differs: boolean;
  /** Only one of the two boxes runs it. */
  oneSided: boolean;
};

/** An agent as a box runs it, by shipped slug. */
export function agentRun(row: FleetMatrixRow, slug: string): BoxRun {
  const agent = row.facts?.agents.find((a) => a.slug === slug);
  return agent ? { provider: agent.provider, endpoint: agent.endpoint, model: agent.model } : null;
}

export function compareLines(
  keys: readonly string[],
  left: FleetMatrixRow | undefined,
  right: FleetMatrixRow | undefined,
  read: (row: FleetMatrixRow, key: string) => BoxRun = agentRun,
): CompareLine[] {
  return keys.map((key) => {
    const lr = left ? read(left, key) : null;
    const rr = right ? read(right, key) : null;
    const l = modelOf(lr);
    const r = modelOf(rr);
    return {
      key,
      left: l,
      right: r,
      leftProvider: lr ? lr.provider : null,
      rightProvider: rr ? rr.provider : null,
      leftEndpoint: lr ? lr.endpoint : null,
      rightEndpoint: rr ? rr.endpoint : null,
      differs: typeof l === 'string' && typeof r === 'string' && l !== r,
      oneSided: (l === null) !== (r === null),
    };
  });
}

/** Whether a line's model can go from one side to the other: both boxes
 *  run it on the same route, the same provider and endpoint print (a model
 *  id means something on one route only; a box before the print cannot
 *  show it, so no copy), they differ, and the source model is one the
 *  brain takes. */
export function canCopy(line: CompareLine, from: 'left' | 'right'): boolean {
  const model = line[from];
  return line.differs && typeof model === 'string' && MODEL_ID.test(model) && sameRoute(line);
}

/** Both boxes run the item on one provider and one endpoint print. */
export function sameRoute(line: CompareLine): boolean {
  return (
    !!line.leftProvider &&
    line.leftProvider === line.rightProvider &&
    typeof line.leftEndpoint === 'string' &&
    line.leftEndpoint === line.rightEndpoint
  );
}

/** Every differing line of one side, as { key, provider, endpoint, model }, at most the
 *  route's cap. `may` leaves out lines that cannot be set (a worker kind
 *  the fleet does not set). */
export function copyAllLines(
  lines: readonly CompareLine[],
  from: 'left' | 'right',
  may: (key: string) => boolean = () => true,
): { key: string; provider: string; endpoint: string; model: string }[] {
  return lines
    .filter((l) => may(l.key) && canCopy(l, from))
    .map((l) => ({
      key: l.key,
      provider: l.leftProvider!,
      endpoint: l.leftEndpoint!,
      model: l[from] as string,
    }))
    .slice(0, MAX_MODEL_CHANGES);
}

// --- AI workers, by kind ---------------------------------------------------------

/** A worker kind the fleet does not set: a new embedding model would not
 *  match the stored vectors (the box refuses it too). */
export const WORKER_KIND_NOT_SET = 'embedding';

export function workerKindSettable(kind: string): boolean {
  return kind !== WORKER_KIND_NOT_SET;
}

/** The worker kinds the matrix names on any box, each once, sorted. */
export function workerKinds(rows: readonly FleetMatrixRow[]): string[] {
  const out = new Set<string>();
  for (const r of rows) for (const w of r.facts?.workers ?? []) if (w.kind) out.add(w.kind);
  return [...out].sort();
}

/** The worker that runs this kind on a box (`default`: the runtime's own
 *  pick, sent by the box). A box before the flag: its one worker of the
 *  kind, else not known. Null where the box has no facts or runs no worker
 *  of the kind. */
export function workerRun(row: FleetMatrixRow, kind: string): BoxRun {
  const all = (row.facts?.workers ?? []).filter((w) => w.kind === kind);
  if (all.length === 0) return null;
  const run = (w: (typeof all)[number]) => ({
    provider: w.provider,
    endpoint: w.endpoint,
    model: w.model,
  });
  const flagged = all.find((w) => w.default === true);
  if (flagged) return run(flagged);
  if (all.some((w) => w.default === false)) return null; // flags sent, none runs it
  return all.length === 1 ? run(all[0]!) : undefined;
}

/** The model of the worker that runs this kind on a box (workerRun). */
export function currentWorkerModel(row: FleetMatrixRow, kind: string): BoxModel {
  return modelOf(workerRun(row, kind));
}

// --- what waits, and the answers -------------------------------------------------

/** Matches the change that sets one agent's model, or one worker kind's. */
export const agentChange = (slug: string) => (c: FleetWriteChange) =>
  c.kind === 'agentModel' && c.slug === slug;
export const workerChange = (kind: string) => (c: FleetWriteChange) =>
  c.kind === 'workerModel' && c.worker === kind;

/** Whether a box still waits to send a change that `match` names. */
export function writeWaiting(
  box: FleetBox | undefined,
  match: (c: FleetWriteChange) => boolean,
): boolean {
  return (box?.writeJob?.changes ?? []).some(match);
}

/** The box's newest answer that `match` names, asked at or after `since`
 *  (ms), or null. */
export function writeAnswer(
  box: FleetBox | undefined,
  match: (c: FleetWriteChange) => boolean,
  since: number,
): FleetWriteAnswer | null {
  const answers = box?.writeResult?.results ?? [];
  for (let i = answers.length - 1; i >= 0; i--) {
    const a = answers[i]!;
    if (!match(a)) continue;
    const at = Date.parse(a.at);
    if (!Number.isNaN(at) && at >= since) return a;
  }
  return null;
}
