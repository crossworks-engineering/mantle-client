/**
 * The Status screen's model: every sidecar the box can run, the health
 * level of each section, and the list of things that need attention. Pure:
 * it reads the answers the screen already fetched (GET /api/health,
 * /api/services, /api/updates, /api/backups, /api/box-status and the
 * provider alerts) and never fetches. No DOM here.
 *
 * The sidecar list is the brain's compose file (mantle docker-compose.yml,
 * docker-compose.core.yml), not the Services screen: that one lists only
 * what can be switched. A sidecar with a switch links to its card there; one
 * without is always on and says so.
 */
import type {
  OptionalServiceName,
  ServiceInfo,
  ServicesView,
  SystemHealth,
} from '@mantle/client-types';
import { serviceSwitchHref } from './services';

/** A section's or a sidecar's reading, worst last. `idle` is on purpose
 *  (switched off, not signed in): never a problem. */
export type Level = 'unknown' | 'idle' | 'ok' | 'warn' | 'crit';

const RANK: Record<Level, number> = { unknown: 0, idle: 1, ok: 2, warn: 3, crit: 4 };

/** The worse of the levels; `unknown` only when nothing is known. */
export function worst(...levels: Level[]): Level {
  let out: Level = 'unknown';
  for (const l of levels) if (RANK[l] > RANK[out]) out = l;
  return out;
}

/** 0 to 100 fill: ok below 75, warn from 75, crit from 90 (the vitals scheme). */
export function pctLevel(pct: number | null | undefined): Level {
  if (pct == null || !Number.isFinite(pct)) return 'unknown';
  return pct >= 90 ? 'crit' : pct >= 75 ? 'warn' : 'ok';
}

// ── The box status (GET /api/box-status) ────────────────────────────────

/**
 * The box_status collector's answer (mantle server/web/lib/box-status.ts,
 * schema 1): numbers and booleans only. Declared here until the pinned
 * contract package carries it. Absent on a brain before the route: the
 * screen then reads the same numbers from the other answers where it can.
 */
export type BoxStatus = {
  schema: 1;
  ts: string;
  build: { version: string; gitSha: string | null; buildTime: string | null };
  process: { uptimeSec: number; heapUsedBytes: number; rssBytes: number };
  host: {
    scope: 'container' | 'host';
    cpuLoadPct: number | null;
    loadAvg: [number, number, number];
    cores: number;
    mem: { usedBytes: number; totalBytes: number; usedPct: number } | null;
    disk: { usedBytes: number; totalBytes: number; freeBytes: number; usedPct: number } | null;
  };
  postgres: {
    up: boolean;
    dbSizeBytes: number | null;
    connections: number | null;
    cacheHitPct: number | null;
  };
  services: {
    objectStore: boolean | null;
    parser: { up: boolean; running: number | null; queued: number | null };
    browser: boolean | null;
    documents: boolean | null;
    embedder: boolean | null;
    sandboxes: boolean | null;
    network: boolean | null;
  };
  spend: {
    last24hMicroUsd: number;
    last7dMicroUsd: number;
    last30dMicroUsd: number;
    traces24h: number;
    turns24h: number;
    errors24h: number;
  } | null;
  capacity: {
    docs: number;
    chunkVectors: number;
    zone: 'green' | 'watch' | 'split';
    pctOfSplit: number;
  } | null;
  extraction: {
    running: number;
    waiting: number;
    retrying: number;
    doneLast10Min: number;
    deadLettered: number;
  } | null;
  logins: { admin: number; member: number; disabled: number; total: number } | null;
  degraded: string[];
};

/** One long-running container as the updater sidecar last saw it. */
export type BoxContainerState = {
  container: string;
  health: string;
  restarts: number;
  startedAt: string | null;
};

/**
 * GET /api/box-status (mantle 0.500.19+): the box status and every
 * long-running container by compose service name. Mirrors `BoxStatusView`
 * in @mantle/client-types; declared here until the pinned contract carries
 * it. `containers` is null where the brain cannot read the updater's file.
 */
export type BoxStatusView = {
  box: BoxStatus;
  containers: Record<string, BoxContainerState> | null;
  containersCheckedAt: string | null;
  core: boolean | null;
};

/** A container's reading: absent is `idle` (this box does not run it);
 *  a word the updater could not vouch for (`unknown`) is not known. */
export function containerLevel(c: BoxContainerState | null | undefined): Level {
  if (!c || c.container === 'unknown') return 'unknown';
  if (c.container === 'absent') return 'idle';
  if (c.container === 'running') {
    if (c.health === 'unhealthy') return 'crit';
    if (c.health === 'starting') return 'warn';
    if (c.health === 'unknown') return 'unknown';
    return 'ok';
  }
  if (c.container === 'restarting' || c.container === 'created') return 'warn';
  return 'crit';
}

/** "Running", "Unhealthy", "Starting", "Restarting", "Stopped", "Not on this box". */
export function containerLabel(c: BoxContainerState): string {
  if (c.container === 'unknown') return 'Not reported';
  if (c.container === 'absent') return 'Not on this box';
  if (c.container === 'running') {
    return c.health === 'unhealthy'
      ? 'Unhealthy'
      : c.health === 'starting'
        ? 'Starting'
        : c.health === 'unknown'
          ? 'Not reported'
          : 'Running';
  }
  if (c.container === 'restarting') return 'Restarting';
  if (c.container === 'created') return 'Created';
  return 'Stopped';
}

/** How long after the stack a container must start to count as restarted. */
const RESTART_GAP_MS = 2 * 60_000;
/** How long a restart stays on the board. */
const RESTART_SHOWN_MS = 30 * 60_000;

/**
 * Minutes since a container restarted on its own, or null. docker's restart
 * count misses autoheal's restarts (`docker restart` keeps the container),
 * so the signal is its start time: running, started recently, and well
 * after the web container (a roll or a reboot starts them all together, and
 * that is not a restart).
 */
export function restartedMinutesAgo(
  c: BoxContainerState | null | undefined,
  baseline: string | null | undefined,
  now: number = Date.now(),
): number | null {
  if (!c || c.container !== 'running' || !c.startedAt || !baseline) return null;
  const started = Date.parse(c.startedAt);
  const base = Date.parse(baseline);
  if (!Number.isFinite(started) || !Number.isFinite(base)) return null;
  if (started - base < RESTART_GAP_MS || now - started > RESTART_SHOWN_MS) return null;
  return Math.max(0, Math.round((now - started) / 60_000));
}

/** The level and label of a container, a recent restart included. */
function readContainer(
  c: BoxContainerState,
  baseline: string | null | undefined,
  now: number,
): { level: Level; label: string } {
  const level = containerLevel(c);
  const ago = level === 'ok' ? restartedMinutesAgo(c, baseline, now) : null;
  if (ago !== null) {
    return { level: 'warn', label: ago === 0 ? 'Restarted just now' : `Restarted ${ago} min ago` };
  }
  return { level, label: containerLabel(c) };
}

// ── Sidecars ────────────────────────────────────────────────────────────

export type SidecarId =
  | 'documents'
  | 'browser'
  | 'local-embedder'
  | 'sandboxes'
  | 'calls'
  | 'objectstore'
  | 'parser'
  | 'postgres'
  | 'tailscale'
  | 'caddy'
  | 'updater'
  | 'autoheal';

export type SidecarDef = {
  id: SidecarId;
  title: string;
  /** What runs in the container (its image). */
  engine: string;
  /** One line on what it does for the brain. */
  role: string;
  /** Its switch on Settings > Services, or null: always on. `browser` is
   *  switchable only on a core box, where Services lists it as `helpers`. */
  service: OptionalServiceName | null;
  /** Its compose service, the key in /api/box-status `containers`. */
  container: string;
};

/** Every sidecar in the brain's compose files, switchable ones first. The
 *  app's own containers (web, api, migrate and the workers) are the brain
 *  itself, not sidecars; the workers have their own section. */
export const SIDECARS: readonly SidecarDef[] = [
  {
    id: 'documents',
    title: 'Documents',
    engine: 'Gotenberg',
    role: 'Office to PDF, page printing and the PDF tools.',
    service: 'documents',
    container: 'gotenberg',
  },
  {
    id: 'local-embedder',
    title: 'Local embedder',
    engine: 'Ollama',
    role: 'Search vectors made on this box.',
    service: 'local-embedder',
    container: 'ollama',
  },
  {
    id: 'sandboxes',
    title: 'Sandboxes',
    engine: 'sandboxd',
    role: 'Isolated workspaces where agents run code.',
    service: 'sandboxes',
    container: 'sandboxd',
  },
  {
    id: 'calls',
    title: 'Calls',
    engine: 'LiveKit',
    role: 'Voice calls between the people of this brain.',
    service: 'calls',
    container: 'livekit',
  },
  {
    id: 'browser',
    title: 'Browser',
    engine: 'browserless',
    role: 'Headless Chromium for PDF export and web pages.',
    service: 'helpers',
    container: 'browser',
  },
  {
    id: 'postgres',
    title: 'Database',
    engine: 'Postgres + pgvector',
    role: 'Every record, vector and setting.',
    service: null,
    container: 'postgres',
  },
  {
    id: 'objectstore',
    title: 'Object store',
    engine: 'RustFS',
    role: 'File bodies, images and attachments.',
    service: null,
    container: 'objectstore',
  },
  {
    id: 'parser',
    title: 'Parser',
    engine: 'mantle-parser',
    role: 'Reads every file the brain receives.',
    service: null,
    container: 'parser',
  },
  {
    id: 'tailscale',
    title: 'Tailnet',
    engine: 'Tailscale',
    role: 'Private network to peers and your devices.',
    service: null,
    container: 'tailscale',
  },
  {
    id: 'caddy',
    title: 'Front door',
    engine: 'Caddy',
    role: 'TLS and routing for every request.',
    service: null,
    container: 'caddy',
  },
  {
    id: 'updater',
    title: 'Updater',
    engine: 'docker CLI',
    role: 'Rolls updates and switches services.',
    service: null,
    container: 'updater',
  },
  {
    id: 'autoheal',
    title: 'Autoheal',
    engine: 'autoheal',
    role: 'Restarts a worker whose health check fails.',
    service: null,
    container: 'autoheal',
  },
];

export type SidecarState = SidecarDef & {
  level: Level;
  /** Short reading: Running, Not answering, Off, Not connected, No probe. */
  label: string;
  /** Extra numbers worth a line (jobs, sandboxes running). */
  detail: string | null;
  /** The link to its switch, or null when it is always on here. */
  switchHref: string | null;
  /** Always on (no switch on this box). */
  alwaysOn: boolean;
  /** docker's restart count and last start, when the updater reports them. */
  restarts: number | null;
  startedAt: string | null;
};

export type SidecarInputs = {
  health: SystemHealth | null;
  services: ServicesView | null;
  /** /api/updates `available`: the updater sidecar answers. */
  updaterUp: boolean | null;
  /** /api/box-status `containers`, null from a brain before it. */
  containers?: Record<string, BoxContainerState> | null;
  /** For the restart signal; Date.now() when absent. */
  now?: number;
};

function fromBool(up: boolean | null | undefined, offWhenNull = false): Level {
  if (up === true) return 'ok';
  if (up === false) return 'crit';
  return offWhenNull ? 'idle' : 'unknown';
}

const LABEL: Record<Level, string> = {
  ok: 'Running',
  crit: 'Not answering',
  warn: 'Degraded',
  idle: 'Off',
  unknown: 'No probe',
};

function fromService(svc: ServiceInfo): Level {
  return svc.state === 'up' ? 'ok' : svc.state === 'down' ? 'crit' : 'idle';
}

/** One sidecar's reading from whatever the brain answered. */
export function sidecarState(def: SidecarDef, inp: SidecarInputs): SidecarState {
  const { health, services } = inp;
  const svc = def.service ? services?.services.find((s) => s.name === def.service) : undefined;
  let level: Level;
  let detail: string | null = null;
  let label: string | null = null;

  if (svc) {
    level = fromService(svc);
  } else {
    switch (def.id) {
      case 'documents':
        level = fromBool(health?.documents?.up, true);
        break;
      case 'local-embedder':
        level =
          health?.embedder.scope === 'local'
            ? fromBool(health.embedder.up)
            : services
              ? 'idle'
              : 'unknown';
        break;
      case 'sandboxes':
        level = fromBool(health?.sandboxes.up, true);
        break;
      case 'browser':
        level = fromBool(health?.browser.up);
        break;
      case 'postgres':
        level = health ? fromBool(health.postgres.up) : 'unknown';
        break;
      case 'objectstore':
        level = fromBool(health?.storage.objectStoreUp ?? health?.storage.minioUp);
        break;
      case 'parser':
        level = health?.parser ? fromBool(health.parser.up) : 'unknown';
        break;
      case 'tailscale':
        level = health ? fromBool(health.network.up, true) : 'unknown';
        if (level === 'idle') label = 'Not connected';
        break;
      case 'updater':
        level = fromBool(inp.updaterUp);
        break;
      default:
        level = 'unknown';
    }
  }

  // What docker says beats no probe, and a container docker calls unhealthy
  // or stopped is a problem whatever the app's own probe last saw. An
  // absent container on a switched-off service is just off.
  const c = inp.containers?.[def.container];
  const read = c ? readContainer(c, inp.containers?.web?.startedAt, inp.now ?? Date.now()) : null;
  if (c && read && read.level !== 'unknown') {
    if (level === 'unknown' || (read.level === 'idle' && level !== 'crit')) {
      level = read.level;
      label = read.level === 'idle' ? (svc ? 'Off' : 'Not on this box') : read.label;
    } else if (read.level === 'crit' || read.level === 'warn') {
      level = worst(level, read.level);
      label = read.label;
    }
  }

  if (def.id === 'parser' && health?.parser?.up && health.parser.running != null) {
    detail = `${health.parser.running} running, ${health.parser.queued ?? 0} queued`;
  }
  if (def.id === 'sandboxes' && health?.sandboxes.up) {
    detail = `${health.sandboxes.running ?? 0} of ${health.sandboxes.total ?? 0} sandboxes running`;
  }
  if (def.id === 'local-embedder' && health?.embedder.scope === 'local' && health.embedder.model) {
    detail = health.embedder.model;
  }
  if (def.id === 'documents' && health?.documents?.version) {
    detail = `Version ${health.documents.version}`;
  }
  if (def.id === 'browser' && health?.browser.version && !detail) {
    detail = health.browser.version;
  }

  return {
    ...def,
    level,
    label: label ?? LABEL[level],
    detail,
    switchHref: svc ? serviceSwitchHref(svc.name) : null,
    alwaysOn: !svc,
    restarts: c && c.container !== 'absent' ? c.restarts : null,
    startedAt: c?.startedAt ?? null,
  };
}

/** Every sidecar, in the catalogue's order. */
export function sidecarStates(inp: SidecarInputs): SidecarState[] {
  return SIDECARS.map((d) => sidecarState(d, inp));
}

/** "6 of 9 running": the sidecars that are on, and how many of those answer.
 *  Those without a probe count as on but not as answering. */
export function sidecarTally(list: SidecarState[]): { on: number; up: number; down: number } {
  const on = list.filter((s) => s.level !== 'idle');
  return {
    on: on.length,
    up: on.filter((s) => s.level === 'ok').length,
    down: on.filter((s) => s.level === 'crit' || s.level === 'warn').length,
  };
}

// ── The brain's own processes ──────────────────────────────────────────

export type ProcessDef = { id: string; title: string; role: string };

/** The brain's long-running processes (compose services on the server
 *  image, plus the client stack's web container), in the order a reader
 *  thinks of them. Each worker writes a heartbeat its health check reads;
 *  autoheal restarts one that stops beating. */
export const PROCESSES: readonly ProcessDef[] = [
  { id: 'web', title: 'Web', role: 'The HTTP API and the MCP endpoint' },
  { id: 'api', title: 'Agent runtime', role: 'Durable agent turns, responders and ticks' },
  { id: 'worker_runs', title: 'Runs', role: 'The runner queue and its sweeps' },
  { id: 'worker_files', title: 'Files', role: 'Mirrors edits made to the files folder' },
  { id: 'worker_docs', title: 'Documentation', role: 'Indexes the enabled documentation' },
  { id: 'worker_events', title: 'Reminders', role: 'Fires event reminders' },
  { id: 'worker_maintenance', title: 'Maintenance', role: 'The nightly upkeep sweeps' },
  { id: 'worker_email', title: 'Email', role: 'Mail sync' },
  { id: 'worker_calendar', title: 'Calendar', role: 'Calendar sync' },
  { id: 'worker_microsoft', title: 'Microsoft', role: 'OneDrive and SharePoint sync' },
  { id: 'worker_telegram', title: 'Telegram', role: 'Polls Telegram for messages' },
  { id: 'worker_push', title: 'Push', role: 'Notifications to phones' },
  { id: 'client_web', title: 'Interface', role: 'Serves this interface' },
  {
    id: 'client_caddy',
    title: 'Interface front door',
    role: 'TLS for the interface on its own box',
  },
];

export type ProcessState = ProcessDef & {
  level: Level;
  label: string;
  restarts: number | null;
  startedAt: string | null;
};

/** Every process with what docker reports, or `unknown` where it reports
 *  nothing (no updater, or one before the containers field). */
export function processStates(
  containers: Record<string, BoxContainerState> | null | undefined,
  now: number = Date.now(),
): ProcessState[] {
  const baseline = containers?.web?.startedAt;
  return PROCESSES.map((p) => {
    const c = containers?.[p.id];
    const read = c ? readContainer(c, baseline, now) : null;
    return {
      ...p,
      level: read?.level ?? 'unknown',
      label: read?.label ?? 'Not reported',
      restarts: c && c.container !== 'absent' ? c.restarts : null,
      startedAt: c?.startedAt ?? null,
    };
  });
}

// ── What needs attention ────────────────────────────────────────────────

export type Issue = { level: 'warn' | 'crit'; section: SectionId; text: string };

export type SectionId =
  'overview' | 'compute' | 'brain' | 'spend' | 'queues' | 'sidecars' | 'providers' | 'version';

export type IssueInputs = {
  health: SystemHealth | null;
  box: BoxStatus | null;
  sidecars: SidecarState[];
  processes?: ProcessState[];
  capacityZone: 'green' | 'watch' | 'split' | null;
  providerAlerts: { subject: string; reason: string; permanent: boolean }[];
  updateAvailable: boolean;
  backup: { ok: boolean; lastRunAt: string; lastSuccessAt?: string } | null;
  backupsEnabled: boolean | null;
  contractMismatch: boolean;
  now?: Date;
};

const DAY_MS = 86_400_000;

/** Every problem the screen knows of, worst first. Empty: all is well. */
export function statusIssues(inp: IssueInputs): Issue[] {
  const out: Issue[] = [];
  const h = inp.health?.host;
  const add = (level: Level, section: SectionId, text: string) => {
    if (level === 'warn' || level === 'crit') out.push({ level, section, text });
  };
  if (h) {
    add(pctLevel(h.cpuLoadPct), 'compute', `CPU at ${Math.round(h.cpuLoadPct ?? 0)}%`);
    add(pctLevel(h.mem?.usedPct), 'compute', `Memory at ${Math.round(h.mem?.usedPct ?? 0)}%`);
    add(pctLevel(h.disk?.usedPct), 'compute', `Disk at ${Math.round(h.disk?.usedPct ?? 0)}%`);
  }
  for (const s of inp.sidecars) {
    if (s.level === 'crit') {
      const what = s.label === 'Not answering' ? 'is not answering' : `is ${s.label.toLowerCase()}`;
      out.push({ level: 'crit', section: 'sidecars', text: `${s.title} ${what}` });
    } else if (s.level === 'warn') {
      const what = s.label.startsWith('Restarted')
        ? s.label.toLowerCase()
        : `is ${s.label.toLowerCase()}`;
      out.push({ level: 'warn', section: 'sidecars', text: `${s.title} ${what}` });
    }
  }
  for (const p of inp.processes ?? []) {
    if (p.level !== 'crit' && p.level !== 'warn') continue;
    const what = p.label.startsWith('Restarted')
      ? p.label.toLowerCase()
      : `is ${p.label.toLowerCase()}`;
    out.push({ level: p.level, section: 'queues', text: `The ${p.title} process ${what}` });
  }
  if (inp.capacityZone === 'watch') {
    out.push({ level: 'warn', section: 'brain', text: 'Brain capacity is in the watch zone' });
  } else if (inp.capacityZone === 'split') {
    out.push({
      level: 'crit',
      section: 'brain',
      text: 'Brain capacity has reached the split zone',
    });
  }
  for (const a of inp.providerAlerts) {
    out.push({
      level: a.permanent ? 'crit' : 'warn',
      section: 'providers',
      text: a.subject === 'embedding' ? 'Embeddings are failing' : 'Extraction is failing',
    });
  }
  const ex = inp.box?.extraction;
  if (ex && ex.deadLettered > 0) {
    out.push({
      level: 'warn',
      section: 'queues',
      text: `${ex.deadLettered} extraction job${ex.deadLettered === 1 ? '' : 's'} gave up`,
    });
  }
  if (inp.box?.spend && inp.box.spend.errors24h > 0 && inp.box.spend.traces24h > 0) {
    const rate = inp.box.spend.errors24h / inp.box.spend.traces24h;
    if (rate >= 0.1) {
      out.push({
        level: 'warn',
        section: 'queues',
        text: `${Math.round(rate * 100)}% of model calls failed in the last day`,
      });
    }
  }
  if (inp.backupsEnabled && inp.backup) {
    const now = (inp.now ?? new Date()).getTime();
    const good = Date.parse(
      inp.backup.lastSuccessAt ?? (inp.backup.ok ? inp.backup.lastRunAt : ''),
    );
    if (!inp.backup.ok)
      out.push({ level: 'crit', section: 'version', text: 'The last backup failed' });
    else if (Number.isFinite(good) && now - good > 2 * DAY_MS) {
      out.push({ level: 'warn', section: 'version', text: 'No good backup in two days' });
    }
  }
  if (inp.contractMismatch) {
    out.push({
      level: 'warn',
      section: 'version',
      text: 'The interface and the brain speak different contracts',
    });
  }
  if (inp.updateAvailable) {
    out.push({ level: 'warn', section: 'version', text: 'An update is available' });
  }
  const degraded = (inp.health?.degraded ?? []).filter((d) => d !== 'embedder');
  if (degraded.length > 0) {
    out.push({
      level: 'warn',
      section: 'overview',
      text: `${degraded.length} probe${degraded.length === 1 ? '' : 's'} did not answer in time`,
    });
  }
  return out.sort((a, b) => RANK[b.level] - RANK[a.level]);
}

/** A section's level from the issues that name it (ok when none). */
export function sectionLevel(issues: Issue[], section: SectionId, known = true): Level {
  if (!known) return 'unknown';
  return worst('ok', ...issues.filter((i) => i.section === section).map((i) => i.level));
}

/** The headline over the whole screen. */
export function overallText(issues: Issue[]): string {
  const crit = issues.filter((i) => i.level === 'crit').length;
  const warn = issues.length - crit;
  if (issues.length === 0) return 'All systems normal';
  if (crit > 0) return `${crit} problem${crit === 1 ? '' : 's'}${warn ? `, ${warn} to watch` : ''}`;
  return `${warn} thing${warn === 1 ? '' : 's'} to watch`;
}

// ── Live history ────────────────────────────────────────────────────────

/** One /api/health poll, kept for the sparklines. */
export type VitalsSample = {
  t: number;
  cpu: number | null;
  mem: number | null;
  disk: number | null;
};

/** How many polls the sparklines keep: ten minutes at one every 10 s. */
export const HISTORY_SAMPLES = 60;

/** Append a sample, dropping the oldest past `max`; a repeat of the last
 *  timestamp replaces it (a refetch of the same answer). */
export function pushSample(
  list: VitalsSample[],
  s: VitalsSample,
  max = HISTORY_SAMPLES,
): VitalsSample[] {
  const last = list[list.length - 1];
  const next = last && last.t === s.t ? [...list.slice(0, -1), s] : [...list, s];
  return next.length > max ? next.slice(next.length - max) : next;
}

export function sampleOf(h: SystemHealth): VitalsSample {
  return {
    t: Date.parse(h.ts) || Date.now(),
    cpu: h.host.cpuLoadPct,
    mem: h.host.mem?.usedPct ?? null,
    disk: h.host.disk?.usedPct ?? null,
  };
}
