/**
 * Fleet Status (the Control Center's Status screen of each box; mantle
 * docs/control-center.md, "Fleet Status"). Each linked box is read with its
 * own `box_status` tool over the admin channel (lib/fleet-tool.ts), this box
 * with GET /api/box-status: the same schema 1 either way. The page then
 * feeds the Status screen's own board with it.
 *
 * A box's answer is data: `parseBoxStatus` keeps only the known fields of
 * schema 1, each as a number, a flag or a short fixed-pattern word, and a
 * field a box does not send (an older release) reads null or 0, so a card
 * shows a dash, never a crash. Pure, so it is unit-tested.
 */
import type { SystemHealth } from '@mantle/client-types';
import type { StatusData, StatusParts } from '@/components/status/use-status';
import { deriveStatus } from '@/components/status/use-status';
import { toolReasonText } from './fleet-tool';
import type { BoxContainerState, BoxStatus, BoxStatusView, Level } from './status';

/** The tool each box is asked. */
export const BOX_STATUS_TOOL = 'box_status';
/** The address of this box's own status. */
export const OWN_BOX_STATUS_PATH = '/api/box-status';
/** The id of this box (the Control Center itself) in the address. */
export const SELF = 'self';
/** A box read is given up after this long: it then shows as late. The
 *  Control Center itself answers `pending` after 25 seconds. */
export const BOX_READ_TIMEOUT_MS = 30_000;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const num0 = (v: unknown): number => num(v) ?? 0;
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
const word = (v: unknown, re: RegExp): string | null =>
  typeof v === 'string' && re.test(v) ? v : null;
function nums<K extends string>(v: unknown, keys: readonly K[]): Record<K, number> | null {
  const o = obj(v);
  return o ? (Object.fromEntries(keys.map((k) => [k, num0(o[k])])) as Record<K, number>) : null;
}

const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]{5,15}Z$/;
const VERSION = /^\d{1,5}\.\d{1,5}\.\d{1,5}(-(alpha|beta|rc)(\.\d{1,3})?)?$/;
const SHA = /^[0-9a-f]{7,40}$/;
const PROBE = /^[a-z][a-z.]{0,30}$/;

/**
 * A box status held to schema 1's shape, or null when it is not one (no
 * object, or `schema` is not 1).
 */
export function parseBoxStatus(value: unknown): BoxStatus | null {
  const v = obj(value);
  if (!v || v.schema !== 1) return null;
  const build = obj(v.build) ?? {};
  const proc = obj(v.process) ?? {};
  const host = obj(v.host) ?? {};
  const pg = obj(v.postgres) ?? {};
  const svc = obj(v.services) ?? {};
  const parser = obj(svc.parser) ?? {};
  const cap = obj(v.capacity);
  const zone =
    cap && (cap.zone === 'green' || cap.zone === 'watch' || cap.zone === 'split') ? cap.zone : null;
  const load = Array.isArray(host.loadAvg) ? host.loadAvg : [];
  const logins = obj(v.logins);
  return {
    schema: 1,
    ts: word(v.ts, ISO) ?? '',
    build: {
      version: word(build.version, VERSION) ?? '',
      gitSha: word(build.gitSha, SHA),
      buildTime: null,
    },
    process: {
      uptimeSec: num0(proc.uptimeSec),
      heapUsedBytes: num0(proc.heapUsedBytes),
      rssBytes: num0(proc.rssBytes),
    },
    host: {
      scope: host.scope === 'host' ? 'host' : 'container',
      cpuLoadPct: num(host.cpuLoadPct),
      loadAvg: [num0(load[0]), num0(load[1]), num0(load[2])],
      cores: num0(host.cores),
      mem: nums(host.mem, ['usedBytes', 'totalBytes', 'usedPct'] as const),
      disk: nums(host.disk, ['usedBytes', 'totalBytes', 'freeBytes', 'usedPct'] as const),
    },
    postgres: {
      up: bool(pg.up) ?? false,
      dbSizeBytes: num(pg.dbSizeBytes),
      connections: num(pg.connections),
      cacheHitPct: num(pg.cacheHitPct),
    },
    services: {
      objectStore: bool(svc.objectStore),
      parser: {
        up: bool(parser.up) ?? false,
        running: num(parser.running),
        queued: num(parser.queued),
      },
      browser: bool(svc.browser),
      documents: bool(svc.documents),
      embedder: bool(svc.embedder),
      sandboxes: bool(svc.sandboxes),
      network: bool(svc.network),
    },
    spend: nums(v.spend, [
      'last24hMicroUsd',
      'last7dMicroUsd',
      'last30dMicroUsd',
      'traces24h',
      'turns24h',
      'errors24h',
    ] as const),
    capacity:
      cap && zone
        ? {
            docs: num0(cap.docs),
            chunkVectors: num0(cap.chunkVectors),
            zone,
            pctOfSplit: num0(cap.pctOfSplit),
          }
        : null,
    extraction: nums(v.extraction, [
      'running',
      'waiting',
      'retrying',
      'doneLast10Min',
      'deadLettered',
    ] as const),
    logins: logins
      ? {
          admin: num0(logins.admin),
          member: num0(logins.member),
          disabled: num0(logins.disabled),
          total: num0(logins.total),
        }
      : null,
    degraded: Array.isArray(v.degraded)
      ? [...new Set(v.degraded.filter((d): d is string => word(d, PROBE) !== null))].slice(0, 30)
      : [],
  };
}

const CONTAINER = /^[a-z][a-z0-9_-]{0,63}$/;

/** GET /api/box-status (this box) held to its shape: the status and the
 *  containers the updater saw. Null when it is not one. */
export function parseBoxStatusView(value: unknown): BoxStatusView | null {
  const v = obj(value);
  const box = parseBoxStatus(v?.box);
  if (!v || !box) return null;
  const raw = obj(v.containers);
  let containers: Record<string, BoxContainerState> | null = null;
  if (raw) {
    containers = {};
    for (const [name, c] of Object.entries(raw).slice(0, 40)) {
      const o = obj(c);
      if (!o || !CONTAINER.test(name)) continue;
      containers[name] = {
        container: word(o.container, /^[a-z]{1,20}$/) ?? 'unknown',
        health: word(o.health, /^[a-z]{1,20}$/) ?? 'unknown',
        restarts: num0(o.restarts),
        startedAt: word(o.startedAt, ISO),
      };
    }
  }
  return {
    box,
    containers,
    containersCheckedAt: word(v.containersCheckedAt, ISO),
    core: bool(v.core),
  };
}

/**
 * The board's `health` from a box status: the same numbers, under the
 * names of GET /api/health. What box_status does not carry (the largest
 * tables, the readers' versions, the embedder's provider) is empty or null.
 */
export function healthOfBox(b: BoxStatus): SystemHealth {
  const s = b.services;
  return {
    ts: b.ts,
    scope: b.host.scope,
    host: {
      cpuLoadPct: b.host.cpuLoadPct,
      mem: b.host.mem,
      disk: b.host.disk ? { ...b.host.disk, mount: '' } : null,
      uptimeSec: b.process.uptimeSec,
      heapUsedBytes: b.process.heapUsedBytes,
      rssBytes: b.process.rssBytes,
      loadAvg: [...b.host.loadAvg],
      cpuCores: b.host.cores,
    },
    postgres: { ...b.postgres, topTables: [] },
    storage: {
      objectStoreUp: s.objectStore,
      minioUp: s.objectStore,
      attachmentBytes: null,
      filesDisk: null,
    },
    parser: { up: s.parser.up, versions: {}, running: s.parser.running, queued: s.parser.queued },
    tika: { up: s.parser.up, version: null },
    browser: { up: s.browser, version: null },
    documents: { up: s.documents, version: null },
    embedder: { up: s.embedder, provider: null, model: null, detail: null, scope: null },
    sandboxes: { up: s.sandboxes, total: null, running: null, disk: null },
    media: {
      up: null,
      ytDlpVersion: null,
      ffmpegVersion: null,
      ezdwfVersion: null,
      dwg2dxfVersion: null,
      ezdxfVersion: null,
    },
    network: { up: s.network, detail: null },
    degraded: b.degraded,
  } as SystemHealth;
}

/** One box's reading on the screen. */
export type BoxRead =
  | { state: 'loading' }
  | { state: 'ok'; view: BoxStatusView; at: number }
  | { state: 'failed'; reason: string };

const none = <T>(): {
  data: T | undefined;
  isError: boolean;
  isPending: boolean;
  isSuccess: boolean;
} => ({ data: undefined, isError: false, isPending: false, isSuccess: false });
const got = <T>(data: T | undefined) => ({
  data,
  isError: false,
  isPending: false,
  isSuccess: data !== undefined,
});

/**
 * The Status screen's data for one box's reading: its box status as
 * `health` and `box`, nothing for what box_status does not carry, marked
 * `remote`. With no reading (null), every section is unknown.
 */
export function remoteStatus(view: BoxStatusView | null): StatusData {
  const parts: StatusParts = {
    health: view ? got(healthOfBox(view.box)) : none(),
    box: view ? got(view) : none(),
    services: none(),
    dashboard: none(),
    updates: none(),
    backups: none(),
    alerts: [],
    alertsLoaded: false,
    version: { data: view?.box.build.version ? { version: view.box.build.version } : undefined },
    history: [],
    remote: true,
  };
  return { ...parts, ...deriveStatus(parts) };
}

/** The small health mark beside a box's name, and its words. */
export function boxMark(read: BoxRead | undefined): { level: Level; text: string } {
  if (!read || read.state === 'loading') return { level: 'unknown', text: 'Reading' };
  if (read.state === 'failed') return { level: 'warn', text: boxReasonShort(read.reason) };
  const status = remoteStatus(read.view);
  const level = status.level('overview');
  const issues = status.issues.length;
  if (level === 'ok') return { level, text: 'All normal' };
  if (level === 'unknown') return { level, text: 'No reading' };
  return { level, text: issues === 1 ? '1 thing to look at' : `${issues} things to look at` };
}

/** A failed read in two or three words, for the box column. */
export function boxReasonShort(reason: string): string {
  switch (reason) {
    case 'scope':
      return 'Refuses calls';
    case 'tool':
      return 'Release behind';
    case 'pending':
    case 'timeout':
      return 'Late';
    case 'bad-reply':
      return 'Unreadable reply';
    default:
      return 'No answer';
  }
}

/** A failed read in full words, for the detail. The admin channel's own
 *  words (lib/fleet-tool.ts), but for a box that has closed the channel. */
export function boxReasonText(reason: string): string {
  if (reason === 'scope') {
    return 'This box refuses calls from the Control Center (MANTLE_CONTROL_CENTER_SCOPE=none in its .env). It shows no status here.';
  }
  return toolReasonText(reason, BOX_STATUS_TOOL);
}

/** The box's version as the column shows it, or null when not known. */
export function boxVersion(read: BoxRead | undefined): string | null {
  return read?.state === 'ok' && read.view.box.build.version
    ? `v${read.view.box.build.version}`
    : null;
}
