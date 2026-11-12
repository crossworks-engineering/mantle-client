/**
 * Set an agent's model on the fleet (Control Center phase 4;
 * docs/control-center.md in the mantle repo, "Set an agent's model on the
 * fleet"). POST /api/fleet/models { changes: [{ slug, model }], boxIds? }
 * queues the changes per box, in the box's one write job (fleet-writes.ts).
 * Pure, so it is unit-tested.
 */
import { FLEET_PATH, type FleetBox } from './fleet';
import type { FleetMatrixRow } from './fleet-matrix';
import type { FleetWriteAnswer } from './fleet-writes';

export const FLEET_MODELS_PATH = `${FLEET_PATH}/models`;

/** A model id as the brain takes one (CONTROL_MODEL_ID in the mantle repo). */
export const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;

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

/** One agent across the two boxes. A model is null where the box has no
 *  facts or no such agent, `''` where the agent has no model. */
export type CompareLine = {
  slug: string;
  left: string | null;
  right: string | null;
  /** Both boxes run the agent, with different models. */
  differs: boolean;
  /** Only one of the two boxes runs it. */
  oneSided: boolean;
};

export function compareLines(
  slugs: readonly string[],
  left: FleetMatrixRow | undefined,
  right: FleetMatrixRow | undefined,
): CompareLine[] {
  return slugs.map((slug) => {
    const l = left ? currentModel(left, slug) : null;
    const r = right ? currentModel(right, slug) : null;
    return {
      slug,
      left: l,
      right: r,
      differs: l !== null && r !== null && l !== r,
      oneSided: (l === null) !== (r === null),
    };
  });
}

/** Whether a line's model can go from one side to the other: both boxes
 *  run the agent, they differ, and the source model is one the brain
 *  takes. */
export function canCopy(line: CompareLine, from: 'left' | 'right'): boolean {
  const model = line[from];
  return line.differs && model !== null && MODEL_ID.test(model);
}

/** The changes that bring every differing line of one side onto the other,
 *  at most the route's cap. */
export function copyAllChanges(
  lines: readonly CompareLine[],
  from: 'left' | 'right',
): { slug: string; model: string }[] {
  return lines
    .filter((l) => canCopy(l, from))
    .map((l) => ({ slug: l.slug, model: l[from]! }))
    .slice(0, MAX_MODEL_CHANGES);
}

/** Whether a box still waits to send an agentModel change for this agent. */
export function modelWaiting(box: FleetBox | undefined, slug: string): boolean {
  return (box?.writeJob?.changes ?? []).some((c) => c.kind === 'agentModel' && c.slug === slug);
}

/** The box's newest answer for this agent's model asked at or after
 *  `since` (ms), or null. */
export function modelAnswer(
  box: FleetBox | undefined,
  slug: string,
  since: number,
): FleetWriteAnswer | null {
  const answers = box?.writeResult?.results ?? [];
  for (let i = answers.length - 1; i >= 0; i--) {
    const a = answers[i]!;
    if (a.kind !== 'agentModel' || a.slug !== slug) continue;
    const at = Date.parse(a.at);
    if (!Number.isNaN(at) && at >= since) return a;
  }
  return null;
}
