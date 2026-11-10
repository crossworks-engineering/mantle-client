/**
 * Set an agent's model on the fleet (Control Center phase 4;
 * docs/control-center.md in the mantle repo, "Set an agent's model on the
 * fleet"). POST /api/fleet/models { changes: [{ slug, model }], boxIds? }
 * queues the changes per box; the box rows of GET /api/fleet then carry
 * `modelJob` (waiting) and `modelResult` (each change's answer). Pure, so
 * it is unit-tested.
 */
import { FLEET_PATH, reasonText, type FleetBox } from './fleet';
import type { FleetMatrixRow } from './fleet-matrix';

export const FLEET_MODELS_PATH = `${FLEET_PATH}/models`;

/** A model id as the brain takes one (CONTROL_MODEL_ID in the mantle repo). */
export const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;

export type FleetModelJob = {
  changes: { slug: string; model: string }[];
  by: string;
  at: string;
};

export type FleetModelResult = {
  results: {
    slug: string;
    model: string;
    ok: boolean;
    /** The model the box had (ok), or has (refused). Null: not known. */
    was: string | null;
    reason: string | null;
  }[];
  by: string;
  at: string;
};

/** Whether a brain offers the model update: its box rows carry the phase 4
 *  fields. A brain before phase 4 does not. */
export function fleetModelsOffered(boxes: readonly FleetBox[]): boolean {
  return boxes.some((b) => b.modelJob !== undefined);
}

/** Whether any box still waits on a model job: the screen reads again soon. */
export function modelUpdatePending(boxes: readonly FleetBox[] | undefined): boolean {
  return (boxes ?? []).some((b) => !!b.modelJob);
}

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

/** Plain words for one change's answer. */
export function modelChangeText(r: FleetModelResult['results'][number]): {
  tone: 'ok' | 'bad';
  text: string;
} {
  if (r.ok) {
    if (r.was === r.model) return { tone: 'ok', text: 'No change: it was set already.' };
    return { tone: 'ok', text: r.was ? `Set. It was ${r.was}.` : 'Set.' };
  }
  const keeps = r.was ? ` It keeps ${r.was}.` : ' Nothing was set.';
  switch (r.reason) {
    case 'agent':
      return {
        tone: 'bad',
        text: 'This box has no shipped agent with this name. Nothing was set.',
      };
    case 'policy':
      return { tone: 'bad', text: `The model policy of this box does not allow it.${keeps}` };
    case 'expired':
      return { tone: 'bad', text: 'Not sent within an hour, so it was dropped. Nothing was set.' };
    case 'error':
      return { tone: 'bad', text: 'The call failed. Nothing was set.' };
    default:
      return {
        tone: 'bad',
        text: `${reasonText(r.reason) ?? 'The call failed.'} Nothing was set.`,
      };
  }
}
