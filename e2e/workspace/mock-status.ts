/**
 * The Status screen's answers for the mock brain (mock-workspace-api.ts):
 * GET /api/health, /api/box-status, /api/services, /api/dashboard,
 * /api/updates, /api/backups and /api/embedding/recover, in the brain's
 * shapes. Every number is made up; nothing names a real box, host or login.
 *
 * `containers` is mutable so a spec can break one process and look for it
 * (a worker docker calls unhealthy, a sidecar that stopped).
 */

const DAY = 86_400_000;

function days(n: number, f: (i: number) => Record<string, unknown>) {
  const today = Date.parse('2026-11-04T00:00:00Z');
  return Array.from({ length: n }, (_, i) => ({
    day: new Date(today - (n - 1 - i) * DAY).toISOString().slice(0, 10),
    ...f(i),
  }));
}

export type MockContainer = {
  container: string;
  health: string;
  restarts: number;
  startedAt: string | null;
};

const STARTED = '2026-11-03T22:10:00Z';
const run = (health = 'healthy'): MockContainer => ({
  container: 'running',
  health,
  restarts: 0,
  startedAt: STARTED,
});
const absent = (): MockContainer => ({
  container: 'absent',
  health: 'none',
  restarts: 0,
  startedAt: null,
});

/** Every long-running container of a full box, all well, calls and the
 *  local embedder switched off. */
export function healthyContainers(): Record<string, MockContainer> {
  return {
    postgres: run(),
    objectstore: run(),
    parser: run(),
    browser: run(),
    gotenberg: run(),
    ollama: absent(),
    tailscale: run('none'),
    web: run(),
    caddy: run('none'),
    updater: run('none'),
    livekit: absent(),
    sandboxd: run(),
    autoheal: run(),
    api: run(),
    worker_email: run(),
    worker_telegram: run(),
    worker_microsoft: run(),
    worker_files: run(),
    worker_docs: run(),
    worker_events: run(),
    worker_calendar: run(),
    worker_maintenance: run(),
    worker_runs: run(),
    worker_push: run(),
    client_web: run('none'),
  };
}

export type MockStatus = { containers: Record<string, MockContainer> };

export function newMockStatus(): MockStatus {
  return { containers: healthyContainers() };
}

const GB = 1024 ** 3;

function health() {
  return {
    ts: new Date().toISOString(),
    scope: 'host',
    host: {
      cpuLoadPct: 23 + Math.random() * 14,
      mem: { usedBytes: 9.2 * GB, totalBytes: 16 * GB, usedPct: 57.5 + Math.random() * 3 },
      disk: { usedBytes: 61 * GB, totalBytes: 160 * GB, usedPct: 38.1, mount: '/data' },
      uptimeSec: 3 * 86_400 + 5 * 3600,
      heapUsedBytes: 182 * 1024 ** 2,
      rssBytes: 512 * 1024 ** 2,
      loadAvg: [1.12, 1.31, 1.4],
      cpuCores: 8,
    },
    postgres: {
      up: true,
      dbSizeBytes: 1.4 * GB,
      connections: 38,
      cacheHitPct: 99.6,
      topTables: [
        { name: 'chunks', bytes: 520 * 1024 ** 2 },
        { name: 'nodes', bytes: 310 * 1024 ** 2 },
        { name: 'traces', bytes: 190 * 1024 ** 2 },
        { name: 'facts', bytes: 96 * 1024 ** 2 },
        { name: 'edges', bytes: 61 * 1024 ** 2 },
        { name: 'entities', bytes: 33 * 1024 ** 2 },
      ],
      role: { mode: 'runtime', user: 'mantle_runtime' },
    },
    storage: { objectStoreUp: true, minioUp: true, attachmentBytes: 4.1 * GB, filesDisk: null },
    parser: { up: true, versions: { anydoc: '1.4.0' }, running: 1, queued: 2 },
    tika: { up: true, version: null },
    browser: { up: true, version: 'Chrome/141' },
    documents: { up: true, version: '8.39.0' },
    embedder: {
      up: true,
      provider: 'openrouter',
      model: 'text-embedding-3-small',
      detail: null,
      scope: 'remote',
    },
    sandboxes: { up: true, total: 3, running: 1, disk: null },
    media: {
      up: null,
      ytDlpVersion: null,
      ffmpegVersion: null,
      ezdwfVersion: null,
      dwg2dxfVersion: null,
      ezdxfVersion: null,
    },
    network: { up: null, detail: null },
    degraded: [],
  };
}

function boxStatus(status: MockStatus) {
  return {
    box: {
      schema: 1,
      ts: new Date().toISOString(),
      build: { version: '0.500.19', gitSha: 'abcdef1', buildTime: '2026-11-04T06:00:00Z' },
      process: {
        uptimeSec: 3 * 86_400 + 5 * 3600,
        heapUsedBytes: 182 * 1024 ** 2,
        rssBytes: 512 * 1024 ** 2,
      },
      host: {
        scope: 'host',
        cpuLoadPct: 31,
        loadAvg: [1.12, 1.31, 1.4],
        cores: 8,
        mem: { usedBytes: 9.2 * GB, totalBytes: 16 * GB, usedPct: 57.5 },
        disk: { usedBytes: 61 * GB, totalBytes: 160 * GB, freeBytes: 99 * GB, usedPct: 38.1 },
      },
      postgres: { up: true, dbSizeBytes: 1.4 * GB, connections: 38, cacheHitPct: 99.6 },
      services: {
        objectStore: true,
        parser: { up: true, running: 1, queued: 2 },
        browser: true,
        documents: true,
        embedder: null,
        sandboxes: true,
        network: null,
      },
      spend: {
        last24hMicroUsd: 1_840_000,
        last7dMicroUsd: 11_200_000,
        last30dMicroUsd: 46_900_000,
        traces24h: 812,
        turns24h: 64,
        errors24h: 9,
      },
      capacity: { docs: 4120, chunkVectors: 38_400, zone: 'green', pctOfSplit: 21 },
      extraction: { running: 2, waiting: 14, retrying: 1, doneLast10Min: 37, deadLettered: 0 },
      logins: { admin: 2, member: 5, disabled: 1, total: 8 },
      degraded: [],
    },
    containers: status.containers,
    containersCheckedAt: new Date().toISOString(),
    core: false,
  };
}

const describe = (title: string, downloadMb: number, memoryMaxMb: number) => ({
  title,
  what: `${title} for the brain.`,
  usedBy: 'The brain.',
  whenOff: 'It stops.',
  keeps: 'Everything.',
  downloadMb,
  memory: `up to ${memoryMaxMb} MB`,
  memoryMaxMb,
  note: null,
  offWarning: null,
});

function services(status: MockStatus) {
  const svc = (name: string, title: string, container: string, mb: number) => {
    const c = status.containers[container];
    const on = c && c.container !== 'absent';
    return {
      name,
      state: !on ? 'off' : c.container === 'running' && c.health !== 'unhealthy' ? 'up' : 'down',
      container: c?.container ?? null,
      health: c?.health ?? null,
      description: describe(title, mb, 1024),
    };
  };
  return {
    services: [
      svc('sandboxes', 'Sandboxes', 'sandboxd', 430),
      svc('local-embedder', 'Local embedder', 'ollama', 3900),
      svc('calls', 'Calls', 'livekit', 45),
      svc('documents', 'Documents', 'gotenberg', 710),
    ],
    switching: { available: true, reason: null },
    box: {
      memTotalBytes: 16 * GB,
      memAvailableBytes: 6 * GB,
      diskFreeBytes: 99 * GB,
      core: false,
      smallBox: false,
    },
    run: null,
  };
}

function dashboard() {
  const bucket = (key: string, count: number) => ({ key, count });
  return {
    brain: {
      nodesTotal: 18_240,
      nodesByType: [
        bucket('file', 7200),
        bucket('note', 4100),
        bucket('page', 2900),
        bucket('email', 4040),
      ],
      factsTotal: 52_100,
      factsByKind: [bucket('claim', 30_000), bucket('preference', 22_100)],
      entitiesTotal: 6_310,
      entitiesByKind: [bucket('person', 2100), bucket('org', 1400), bucket('project', 2810)],
      edgesTotal: 41_800,
      edgesByRelation: [bucket('mentions', 30_000), bucket('related', 11_800)],
    },
    vectors: {
      nodesIndexed: 17_980,
      nodesTotal: 18_240,
      factsIndexed: 51_900,
      factsTotal: 52_100,
      entitiesIndexed: 6_310,
      entitiesTotal: 6_310,
      vectorsTotal: 114_400,
      embeddingCacheRows: 9_800,
    },
    ingest: days(30, (i) => {
      const total = 20 + Math.round(30 * Math.abs(Math.sin(i / 3)));
      return { total, byType: { file: Math.round(total * 0.6), note: Math.round(total * 0.4) } };
    }),
    spend30: days(30, (i) => ({
      costMicroUsd: 900_000 + Math.round(900_000 * Math.abs(Math.sin(i / 4))),
      tokensIn: 200_000,
      tokensOut: 40_000,
      cacheReadTokens: 50_000,
      runs: 30,
    })),
    email: { total: 12_400, unread: 120, withAttachments: 2_100, byAccount: [], latestSync: [] },
    telegram: { messagesTotal: 830, unprocessed: 0, chatsByStatus: [bucket('paired', 2)] },
    heartbeats: {
      byStatus: [bucket('active', 4), bucket('paused', 1)],
      recentFiresByDisposition: [bucket('sent', 22), bucket('skipped', 5)],
    },
    pendingTools: 3,
    errs: [],
    fails: [],
    integrity: { duplicateEdgeGroups: 0, redundantEdgeRows: 0 },
    capacity: {
      docs: { count: 4120, watch: 10_000, split: 20_000, zone: 'green' },
      chunkVectors: { count: 38_400, watch: 100_000, split: 250_000, zone: 'green' },
      zone: 'green',
      pctOfSplit: 21,
      retrieval: { at: '2026-11-02T03:00:00Z', cases: 40, recallAt10: 0.93, mrr: 0.81 },
    },
  };
}

function updates() {
  return {
    check: {
      currentVersion: '0.500.19',
      latest: {
        tag: 'v0.500.19',
        version: '0.500.19',
        name: 'v0.500.19',
        url: '',
        publishedAt: '2026-11-04T06:00:00Z',
        body: '',
      },
      updateAvailable: false,
      checkedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
      error: null,
    },
    available: true,
    status: { phase: 'idle', target: '', startedAt: null, finishedAt: null, ok: null, error: null },
    compose: null,
    build: { version: '0.500.19', sha: 'abcdef1', time: '2026-11-04T06:00:00Z' },
  };
}

function backups() {
  const last = new Date(Date.now() - 7 * 3600_000).toISOString();
  return {
    config: { enabled: true, frequency: 'daily', hour: 2, keep: 7 },
    status: {
      lastRunAt: last,
      ok: true,
      bytes: 812 * 1024 ** 2,
      durationMs: 41_000,
      trigger: 'schedule',
      lastSuccessAt: last,
    },
    dumps: [],
    resolvedDir: '',
    timezone: 'UTC',
  };
}

/** The Status screen's routes; null for any other path. */
export function statusAnswer(path: string, status: MockStatus): unknown {
  switch (path) {
    case '/api/health':
      return health();
    case '/api/box-status':
      return boxStatus(status);
    case '/api/services':
      return services(status);
    case '/api/dashboard':
      return dashboard();
    case '/api/updates':
      return updates();
    case '/api/backups':
      return backups();
    case '/api/embedding/recover':
      return { alerts: [], otherAlerts: [] };
    default:
      return null;
  }
}
