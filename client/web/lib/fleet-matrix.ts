/**
 * The fleet matrix (Control Center phase 3; docs/control-center.md in the
 * mantle repo, "The fleet matrix"): per linked box its last good facts. The
 * types mirror GET /api/fleet/matrix (`?box=<id>` for one box); dates arrive
 * as ISO strings. Numbers, settings and model ids only: never a name, a
 * prompt, a key or user data. Pure, so it is unit-tested.
 */
import { FLEET_PATH, FLEET_KEY, reasonText, type FleetBox } from './fleet';
import { pctLevel, worst, type BoxStatus, type Level } from './status';

export const FLEET_MATRIX_PATH = `${FLEET_PATH}/matrix`;
export const FLEET_MATRIX_KEY = [...FLEET_KEY, 'matrix'];

/** The control service reads each box every 5 minutes. Facts older than
 *  three runs read as stale. */
export const FACTS_STALE_MS = 15 * 60_000;

export type FleetFacts = {
  schema: 1;
  /** The box's own time of the answer. */
  at: string;
  /** box_status schema 1; null when the box could not collect it. */
  status: BoxStatus | null;
  signIn: 'off' | 'optional' | 'required';
  agents: {
    /** A slug the system ships, else null (a name someone gave it). */
    slug: string | null;
    role: string;
    provider: string;
    model: string;
    enabled: boolean;
    /** A person's own assistant. */
    assigned: boolean;
  }[];
  workers: { kind: string; provider: string; model: string; enabled: boolean }[];
  counts: { workspaces: number; apps: number };
  backup: { lastRunAt: string; ok: boolean; lastSuccessAt: string | null } | null;
};

/** One box's line. `facts`: the last good answer (null: none yet).
 *  `factsReason`: null after a good read, else its reason code. */
export type FleetMatrixRow = {
  id: string;
  url: string;
  label: string | null;
  lastOkAt: string | null;
  lastReason: string | null;
  facts: FleetFacts | null;
  factsReason: string | null;
};

/** Whether a brain offers the matrix: its box rows carry `factsAt`. A
 *  brain before phase 3 does not. */
export function fleetMatrixOffered(boxes: readonly FleetBox[]): boolean {
  return boxes.some((b) => b.factsAt !== undefined);
}

/** How current a box's facts are: none yet, fresh, or stale (old, or the
 *  last read failed: the old facts stay). */
export function factsAge(
  row: Pick<FleetMatrixRow, 'facts' | 'factsReason'>,
  now: number = Date.now(),
): 'none' | 'fresh' | 'stale' {
  if (!row.facts) return 'none';
  if (row.factsReason) return 'stale';
  const at = Date.parse(row.facts.at);
  return Number.isNaN(at) || now - at > FACTS_STALE_MS ? 'stale' : 'fresh';
}

/** Plain words for why the last read failed, or null. */
export function factsReasonText(code: string | null): string | null {
  if (code === null) return null;
  if (code === 'error') return 'The last read failed on this box.';
  if (code === 'not-https') return 'The box address is not HTTPS.';
  const text = reasonText(code);
  return text === 'The last run failed.' ? 'The last read failed.' : text;
}

/** One reading of a box's health, from its status numbers: down when its
 *  database is down, a warning for a probe that did not answer, a service
 *  that is down, or memory or disk from 75%. */
export function healthLevel(status: BoxStatus | null): Level {
  if (!status) return 'unknown';
  if (!status.postgres.up) return 'crit';
  const s = status.services;
  const serviceDown =
    !s.parser.up ||
    [s.objectStore, s.browser, s.documents, s.embedder, s.sandboxes, s.network].some(
      (v) => v === false,
    );
  return worst(
    'ok',
    pctLevel(status.host.mem?.usedPct),
    pctLevel(status.host.disk?.usedPct),
    serviceDown || status.degraded.length > 0 ? 'warn' : 'ok',
  );
}

export function healthLabel(level: Level): string {
  if (level === 'crit') return 'Down';
  if (level === 'warn') return 'Warning';
  if (level === 'ok') return 'Healthy';
  return 'Not known';
}

export function signInLabel(mode: FleetFacts['signIn']): string {
  return mode === 'required' ? 'Required' : mode === 'optional' ? 'Optional' : 'Off';
}

/** The backup's tone: none yet, ok, or failed. */
export function backupTone(backup: FleetFacts['backup']): 'none' | 'ok' | 'bad' {
  if (!backup) return 'none';
  return backup.ok ? 'ok' : 'bad';
}

/** An agent's name in the matrix: its shipped slug, else what it is. */
export function agentName(agent: FleetFacts['agents'][number]): string {
  if (agent.slug) return agent.slug;
  return agent.assigned ? 'Own assistant' : 'Custom agent';
}

/** The models a box runs, each once, with how many agents and workers use
 *  it: the line a box card shows. Most used first. */
export function modelsInUse(
  facts: Pick<FleetFacts, 'agents' | 'workers'>,
): { provider: string; model: string; uses: number }[] {
  const byKey = new Map<string, { provider: string; model: string; uses: number }>();
  for (const r of [...facts.agents, ...facts.workers]) {
    if (!r.enabled || !r.model) continue;
    const key = `${r.provider}\u0000${r.model}`;
    const hit = byKey.get(key);
    if (hit) hit.uses += 1;
    else byKey.set(key, { provider: r.provider, model: r.model, uses: 1 });
  }
  return [...byKey.values()].sort((a, b) => b.uses - a.uses || a.model.localeCompare(b.model));
}

/** "3 agents (1 off)". */
export function countText(n: number, off: number, word: string): string {
  const base = `${n} ${word}${n === 1 ? '' : 's'}`;
  return off > 0 ? `${base} (${off} off)` : base;
}
