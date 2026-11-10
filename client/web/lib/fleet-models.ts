/**
 * Set an agent's model on the fleet (Control Center phase 4;
 * docs/control-center.md in the mantle repo, "Set an agent's model on the
 * fleet"). POST /api/fleet/models { changes: [{ slug, model }], boxIds? }
 * queues the changes per box, in the box's one write job (fleet-writes.ts).
 * Pure, so it is unit-tested.
 */
import { FLEET_PATH } from './fleet';
import type { FleetMatrixRow } from './fleet-matrix';

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
