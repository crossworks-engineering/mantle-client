/**
 * Optional services on the dashboard: sandboxes, the local embedder and (on
 * a core box) the PDF-export helper, each with a
 * switch an admin flips to start or stop it (mantle docs/services.md). The
 * brain serves the state and the plain-language description on
 * GET /api/services; POST /api/services/:name {enable} asks the box's
 * updater to switch one; GET /api/services/status is the progress poll.
 *
 * Off stops the service and keeps everything: sandboxes, their files and
 * apps, and app data. Pure helpers only: no DOM here.
 *
 * The types are the mantle contract (@mantle/client-types, since 0.239.3).
 */

import type {
  OptionalServiceName,
  ServiceInfo,
  ServiceRunPhase,
  ServiceRunStatus,
  ServiceState,
  ServicesView,
} from '@mantle/client-types';

export type {
  OptionalServiceName,
  ServiceDescription,
  ServiceInfo,
  ServiceRunPhase,
  ServiceRunPoll,
  ServiceRunStatus,
  ServiceState,
  ServicesView,
  ServiceSwitchResult,
} from '@mantle/client-types';

/** The one line each service card shows: the most important thing it
 *  enables. The details (what uses it, what stops while it is off, what it
 *  costs) are in the screen's help topic, mantle docs/guide/06-help/services.md.
 *  Not "mini apps": those run without sandboxes, and switching sandboxes off
 *  leaves them alone. The parser service, which reads every file, is core
 *  and has no switch; an older brain may still list `media`, which falls
 *  back to its own description. */
export const SERVICE_ENABLES: Partial<Record<ServiceName, string>> = {
  sandboxes: 'Lets the coder and app agents build, run and test code in isolated workspaces.',
  'local-embedder':
    'Lets the brain index and search your text on this box, with no online embedder.',
  helpers: 'Lets the brain make PDF exports of pages.',
};

/** Every service the brain can list. The union keeps this file compiling
 *  against client-types from before the two newer names (a no-op after). */
export type ServiceName = OptionalServiceName | 'local-embedder' | 'helpers';

/** The one-line warning the confirm dialog shows before a service goes off
 *  (the embedder while this brain embeds with it, the helpers), or null.
 *  Older brains send none. */
export function offWarning(svc: ServiceInfo): string | null {
  const d: ServiceInfo['description'] & { offWarning?: string | null } = svc.description;
  return d.offWarning ?? null;
}

const BUSY: readonly ServiceRunPhase[] = ['requested', 'pulling', 'starting', 'stopping'];

export function runBusy(run: ServiceRunStatus | null | undefined): boolean {
  return !!run && BUSY.includes(run.phase);
}

/** The run the UI should follow after it sent a request at `sentAt` (ms):
 *  the updater consumes the request a moment before it writes the new
 *  status, so a status that started before the request is the PREVIOUS run
 *  and reads as "waiting" instead. */
export function currentRun(
  run: ServiceRunStatus | null | undefined,
  sentAt: number | null,
): ServiceRunStatus | null {
  if (!run) return null;
  if (sentAt === null || run.phase === 'requested') return run;
  const started = run.startedAt ? Date.parse(run.startedAt) : NaN;
  // Second precision on the updater's clock: allow a little skew.
  if (Number.isFinite(started) && started >= sentAt - 5_000) return run;
  return { ...run, phase: 'requested', ok: null, error: null, finishedAt: null };
}

/** One line for the progress row. */
export function runLabel(run: ServiceRunStatus): string {
  switch (run.phase) {
    case 'requested':
      return 'Waiting for the updater to pick this up';
    case 'pulling':
      return 'Downloading. This takes 1 to 3 minutes.';
    case 'starting':
      return 'Starting and waiting for it to report healthy';
    case 'stopping':
      return 'Stopping. Your data is kept.';
    case 'done':
      return run.enable ? 'Switched on' : 'Switched off. Your data is kept.';
    case 'error':
      return run.error ?? 'It did not work. See the log.';
    default:
      return '';
  }
}

export function stateLabel(state: ServiceState): string {
  return state === 'up' ? 'Running' : state === 'down' ? 'Not answering' : 'Off';
}

function gb(bytes: number): string {
  const v = bytes / 1024 ** 3;
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} GB`;
}

/**
 * The short warning before a service goes on, or null when the box has room.
 * Shown, never a block: the admin decides. The longer story is in the help.
 */
export function memoryWarning(view: ServicesView, svc: ServiceInfo): string | null {
  const { box } = view;
  const total = box.memTotalBytes;
  const need = svc.description.memoryMaxMb * 1024 ** 2;
  const small = box.smallBox || (total !== null && need >= total / 2);
  if (!small) return null;
  const size = total !== null ? `This box has ${gb(total)} of memory` : 'This is a small box';
  const core = box.core ? ' (small core setup)' : '';
  // The brain's memory line can carry a bracketed aside; the warning drops it.
  const memory = svc.description.memory.replace(/\s*\([^)]*\)\s*$/, '');
  return (
    `${size}${core}. ${svc.description.title} can use ${memory}, so the brain can slow down. ` +
    'Switch it off again if it does.'
  );
}

/** Disk note for the confirm dialog, or null when there is room. */
export function diskWarning(view: ServicesView, svc: ServiceInfo): string | null {
  const free = view.box.diskFreeBytes;
  if (free === null) return null;
  const needBytes = (svc.description.downloadMb * 3 + 4096) * 1024 ** 2;
  return free < needBytes
    ? `Only ${gb(free)} of disk is free. The updater refuses below 4 GB free, so free some space first.`
    : null;
}
