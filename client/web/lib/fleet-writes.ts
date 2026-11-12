/**
 * The fleet writes of Control Center phase 4 (docs/control-center.md in the
 * mantle repo, "Fleet writes"): an agent's model, a model pool entry, the
 * update notice, a worker group and a worker's model. One job per box holds them all: the box
 * rows of GET /api/fleet carry `writeJob` (the changes that wait, in the
 * order asked) and `writeResult` (the last 40 answers, newest last). Agent
 * models go to POST /api/fleet/models, the rest (worker models too) to POST
 * /api/fleet/settings.
 * Pure, so it is unit-tested.
 */
import { FLEET_PATH, reasonText, type FleetBox } from './fleet';

export const FLEET_SETTINGS_PATH = `${FLEET_PATH}/settings`;

/** A slug as a worker, a group or a pool has one (CONTROL_SLUG). */
export const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** A display name: a pool entry's name and vendor, a group's name (CONTROL_LABEL). */
export const LABEL = /^[\p{L}\p{N}][\p{L}\p{N} ._:/()+&'-]{0,119}$/u;
/** A provider id, as a pool entry's route names one (CONTROL_PROVIDER). */
export const PROVIDER = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** The most routes one pool entry has, and the most members one group has. */
export const MAX_ROUTES = 8;
export const MAX_MEMBERS = 10;

export type FleetWriteChange =
  | { kind: 'agentModel'; slug: string; model: string }
  | {
      kind: 'poolEntry';
      pool: string;
      name: string;
      vendor?: string;
      routes: { provider: string; model: string }[];
    }
  | { kind: 'updateNotice'; on: boolean }
  | { kind: 'workerGroup'; slug: string; name?: string; members: string[]; enabled?: boolean }
  /** The model of the default AI worker of a shipped kind (`worker`). */
  | { kind: 'workerModel'; worker: string; model: string };

/** Who asked a change, and when (its hour runs from here). */
export type FleetWriteStamp = { by: string; at: string };

export type FleetWriteJob = { changes: (FleetWriteChange & FleetWriteStamp)[] };

/** A box's answer to one change: ok and what it had (`was`), or a reason.
 *  `done` is when. */
export type FleetWriteAnswer = FleetWriteChange &
  FleetWriteStamp & { ok: boolean; was: string | null; reason: string | null; done: string };

export type FleetWriteResult = { results: FleetWriteAnswer[] };

/** Whether a brain offers the fleet writes: its box rows carry the write
 *  job field. A brain before them does not. */
export function fleetWritesOffered(boxes: readonly FleetBox[]): boolean {
  return boxes.some((b) => b.writeJob !== undefined);
}

/** Whether any box still has changes waiting: the screen reads again soon. */
export function writeUpdatePending(boxes: readonly FleetBox[] | undefined): boolean {
  return (boxes ?? []).some((b) => (b.writeJob?.changes.length ?? 0) > 0);
}

/** A short name for one change. */
export function changeLabel(c: FleetWriteChange): string {
  switch (c.kind) {
    case 'agentModel':
      return `${c.slug} to ${c.model}`;
    case 'poolEntry':
      return `Pool entry ${c.name} in ${c.pool}`;
    case 'updateNotice':
      return `Update notice ${c.on ? 'on' : 'off'}`;
    case 'workerGroup':
      return `Worker group ${c.slug}`;
    case 'workerModel':
      return `${c.worker} worker to ${c.model}`;
  }
}

const NOTHING = ' Nothing was set.';

/** Plain words for one answer. */
export function answerText(a: FleetWriteAnswer): { tone: 'ok' | 'bad'; text: string } {
  if (a.ok) return { tone: 'ok', text: okText(a) };
  const keeps = a.was ? ` It keeps ${a.was}.` : NOTHING;
  const bad = (text: string) => ({ tone: 'bad' as const, text });
  switch (a.reason) {
    case 'agent':
      return bad(`This box has no shipped agent with this name.${NOTHING}`);
    case 'policy':
      return bad(`The model policy of this box does not allow it.${keeps}`);
    case 'pool':
      return bad(`This box has no pool with this id.${NOTHING}`);
    case 'fit':
      return bad(
        `A route does not pass the model policy of this box, or does not fit the pool.${NOTHING}`,
      );
    case 'members':
      return bad(`A member is not an enabled worker on this box.${NOTHING}`);
    case 'worker':
      return bad(
        `This box has no default worker of this kind, or it cannot be set here.${NOTHING}`,
      );
    case 'model':
      return bad(`The provider does not list this model for this kind of worker.${keeps}`);
    case 'expired':
      return bad(`Not sent within an hour, so it was dropped.${NOTHING}`);
    case 'unreachable':
      return bad('The box did not answer. Not confirmed: the box may still have made the change.');
    case 'bad-call':
      return bad(`The box is a release behind and does not know this change.${NOTHING}`);
    case 'http-429':
      return bad(`Too many changes at once.${NOTHING} Send it again.`);
    case 'refused':
      return bad(`The box refused it.${NOTHING}`);
    case 'error':
      return bad(`The call failed.${NOTHING}`);
    default:
      return bad(`${reasonText(a.reason) ?? 'The call failed.'}${NOTHING}`);
  }
}

function okText(a: FleetWriteAnswer): string {
  switch (a.kind) {
    case 'agentModel':
    case 'workerModel':
      if (a.was === a.model) return 'No change: it was set already.';
      return a.was ? `Set. It was ${a.was}.` : 'Set.';
    case 'poolEntry':
      return a.was === 'updated'
        ? 'Updated: the entry was there.'
        : 'Added at the end of the pool.';
    case 'updateNotice': {
      const now = a.on ? 'on' : 'off';
      if (a.was === now) return `No change: it was ${now} already.`;
      return a.on ? 'On. Logins wait on this box.' : 'Off. Logins work again.';
    }
    case 'workerGroup':
      return a.was === 'updated' ? 'Updated: the group was there.' : 'Made.';
  }
}

/** The toast after a send. A box with 40 changes waiting is not queued. */
export function sentText(asked: number, queued: number): string {
  const boxes = (n: number) => (n === 1 ? '1 box' : `${n} boxes`);
  const sent = `Sent to ${boxes(queued)}. Each box makes the change at its next run.`;
  const left = asked - queued;
  if (left <= 0) return sent;
  return `${sent} ${boxes(left)} not queued: 40 changes wait there already. Send again later.`;
}

/** The slugs typed in one box: split on commas and spaces, lowercase, each
 *  once. */
export function parseSlugs(text: string): string[] {
  const out = text
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  return [...new Set(out)];
}
