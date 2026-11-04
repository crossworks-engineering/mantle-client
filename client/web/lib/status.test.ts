import { describe, expect, it } from 'vitest';
import type { ServicesView, SystemHealth } from '@mantle/client-types';
import {
  HISTORY_SAMPLES,
  PROCESSES,
  SIDECARS,
  containerLevel,
  overallText,
  processStates,
  pushSample,
  sectionLevel,
  sidecarState,
  sidecarStates,
  sidecarTally,
  statusIssues,
  type BoxContainerState,
  type SidecarDef,
} from './status';

const running = (health = 'healthy'): BoxContainerState => ({
  container: 'running',
  health,
  restarts: 0,
  startedAt: '2026-11-04T05:00:00Z',
});

function health(over: Partial<SystemHealth> = {}): SystemHealth {
  return {
    ts: '2026-11-04T06:00:00.000Z',
    scope: 'host',
    host: {
      cpuLoadPct: 20,
      mem: { usedBytes: 1, totalBytes: 2, usedPct: 50 },
      disk: { usedBytes: 1, totalBytes: 4, usedPct: 25, mount: '/' },
      uptimeSec: 100,
      heapUsedBytes: 1,
      rssBytes: 1,
      loadAvg: [0.1, 0.2, 0.3],
      cpuCores: 4,
    },
    postgres: { up: true, dbSizeBytes: 1, connections: 1, cacheHitPct: 99, topTables: [] },
    storage: { objectStoreUp: true, minioUp: true, attachmentBytes: 0, filesDisk: null },
    parser: { up: true, versions: {}, running: 0, queued: 0 },
    tika: { up: true, version: null },
    browser: { up: true, version: null },
    documents: { up: true, version: '8.39.0' },
    embedder: { up: null, provider: 'openrouter', model: 'm', detail: null, scope: 'remote' },
    sandboxes: { up: null, total: null, running: null, disk: null },
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
    ...over,
  } as SystemHealth;
}

function services(states: Record<string, 'up' | 'down' | 'off'>): ServicesView {
  return {
    services: Object.entries(states).map(([name, state]) => ({
      name: name as ServicesView['services'][number]['name'],
      state,
      container: null,
      health: null,
      description: {
        title: name,
        what: '',
        usedBy: '',
        whenOff: '',
        keeps: '',
        downloadMb: 1,
        memory: '',
        memoryMaxMb: 1,
        note: null,
      },
    })),
    switching: { available: true, reason: null },
    box: {
      memTotalBytes: null,
      memAvailableBytes: null,
      diskFreeBytes: null,
      core: false,
      smallBox: false,
    },
    run: null,
  };
}

const def = (id: string): SidecarDef => SIDECARS.find((s) => s.id === id)!;

describe('the sidecar catalogue', () => {
  it('names every compose sidecar once, Gotenberg and the newer ones included', () => {
    expect(SIDECARS.map((s) => s.id)).toEqual([
      'documents',
      'local-embedder',
      'sandboxes',
      'calls',
      'browser',
      'postgres',
      'objectstore',
      'parser',
      'tailscale',
      'caddy',
      'updater',
      'autoheal',
    ]);
    expect(def('documents').engine).toBe('Gotenberg');
    expect(new Set(SIDECARS.map((s) => s.container)).size).toBe(SIDECARS.length);
  });

  it('every line is plain: no en or em dash', () => {
    for (const s of [...SIDECARS, ...PROCESSES]) {
      expect(`${s.title} ${s.role}`).not.toMatch(/[–—]/);
    }
  });
});

describe('sidecarState', () => {
  it('a switchable one reads the Services view and links to its card', () => {
    const s = sidecarState(def('documents'), {
      health: health(),
      services: services({ documents: 'up' }),
      updaterUp: true,
    });
    expect(s).toMatchObject({ level: 'ok', label: 'Running', alwaysOn: false });
    expect(s.switchHref).toBe('/settings/services#service-documents');
    expect(s.detail).toBe('Version 8.39.0');
  });

  it('off on Services is idle, never a problem', () => {
    const s = sidecarState(def('calls'), {
      health: health(),
      services: services({ calls: 'off' }),
      updaterUp: true,
    });
    expect(s).toMatchObject({ level: 'idle', label: 'Off' });
  });

  it('the browser is always on where Services does not list the helpers', () => {
    const s = sidecarState(def('browser'), {
      health: health(),
      services: services({ documents: 'up' }),
      updaterUp: true,
    });
    expect(s).toMatchObject({ level: 'ok', alwaysOn: true, switchHref: null });
  });

  it('docker beats no probe, and an unhealthy container beats a good probe', () => {
    const caddy = sidecarState(def('caddy'), {
      health: health(),
      services: null,
      updaterUp: null,
      containers: { caddy: running('none') },
    });
    expect(caddy).toMatchObject({ level: 'ok', label: 'Running' });
    const pg = sidecarState(def('postgres'), {
      health: health(),
      services: null,
      updaterUp: null,
      containers: { postgres: { ...running('unhealthy'), restarts: 2 } },
    });
    expect(pg).toMatchObject({ level: 'crit', label: 'Unhealthy', restarts: 2 });
  });

  it('with nothing to read, an always-on one says it has no probe', () => {
    const s = sidecarState(def('autoheal'), { health: health(), services: null, updaterUp: null });
    expect(s).toMatchObject({ level: 'unknown', label: 'No probe' });
  });

  it('tailnet not signed in is idle, labelled so', () => {
    const s = sidecarState(def('tailscale'), { health: health(), services: null, updaterUp: null });
    expect(s).toMatchObject({ level: 'idle', label: 'Not connected' });
  });
});

describe('sidecarTally', () => {
  it('counts the ones switched on, and of those the ones that answer', () => {
    const list = sidecarStates({
      health: health({ documents: { up: false, version: null } }),
      services: services({
        documents: 'down',
        calls: 'off',
        sandboxes: 'up',
        'local-embedder': 'off',
      }),
      updaterUp: true,
    });
    const t = sidecarTally(list);
    expect(t.down).toBe(1);
    expect(t.on).toBe(list.filter((s) => s.level !== 'idle').length);
  });
});

describe('containerLevel and processStates', () => {
  it('reads docker words', () => {
    expect(containerLevel(running())).toBe('ok');
    expect(containerLevel(running('none'))).toBe('ok');
    expect(containerLevel(running('starting'))).toBe('warn');
    expect(containerLevel(running('unhealthy'))).toBe('crit');
    expect(containerLevel({ ...running(), container: 'restarting' })).toBe('warn');
    expect(containerLevel({ ...running(), container: 'exited' })).toBe('crit');
    expect(containerLevel({ ...running(), container: 'absent' })).toBe('idle');
    expect(containerLevel(null)).toBe('unknown');
  });

  it('every process, unknown where docker reports nothing', () => {
    const list = processStates({ worker_email: running('unhealthy') });
    expect(list).toHaveLength(PROCESSES.length);
    expect(list.find((p) => p.id === 'worker_email')).toMatchObject({
      level: 'crit',
      label: 'Unhealthy',
    });
    expect(list.find((p) => p.id === 'api')).toMatchObject({
      level: 'unknown',
      label: 'Not reported',
    });
  });
});

describe('statusIssues', () => {
  const base = {
    box: null,
    sidecars: [],
    capacityZone: 'green' as const,
    providerAlerts: [],
    updateAvailable: false,
    backup: null,
    backupsEnabled: null,
    contractMismatch: false,
  };

  it('nothing wrong: none, and the headline says so', () => {
    const issues = statusIssues({ ...base, health: health() });
    expect(issues).toEqual([]);
    expect(overallText(issues)).toBe('All systems normal');
    expect(sectionLevel(issues, 'compute')).toBe('ok');
  });

  it('collects every kind, worst first, each under its section', () => {
    const issues = statusIssues({
      ...base,
      health: health({
        host: { ...health().host, disk: { usedBytes: 1, totalBytes: 1, usedPct: 93, mount: '/' } },
      }),
      sidecars: sidecarStates({
        health: health(),
        services: services({ documents: 'down' }),
        updaterUp: true,
      }),
      processes: processStates({ worker_runs: running('starting') }),
      capacityZone: 'watch',
      providerAlerts: [{ subject: 'embedding', reason: 'r', permanent: false }],
      updateAvailable: true,
      backup: { ok: false, lastRunAt: '2026-11-04T01:00:00Z' },
      backupsEnabled: true,
      now: new Date('2026-11-04T06:00:00Z'),
    });
    expect(issues[0]?.level).toBe('crit');
    expect(issues.map((i) => i.text)).toEqual(
      expect.arrayContaining([
        'Disk at 93%',
        'Documents is not answering',
        'The Runs process is starting',
        'Brain capacity is in the watch zone',
        'Embeddings are failing',
        'The last backup failed',
        'An update is available',
      ]),
    );
    expect(sectionLevel(issues, 'sidecars')).toBe('crit');
    expect(sectionLevel(issues, 'brain')).toBe('warn');
    expect(overallText(issues)).toMatch(/^3 problems, 4 to watch$/);
    for (const i of issues) expect(i.text).not.toMatch(/[–—]/);
  });

  it('a backup two days old is to watch', () => {
    const issues = statusIssues({
      ...base,
      health: health(),
      backup: {
        ok: true,
        lastRunAt: '2026-11-01T01:00:00Z',
        lastSuccessAt: '2026-11-01T01:00:00Z',
      },
      backupsEnabled: true,
      now: new Date('2026-11-04T06:00:00Z'),
    });
    expect(issues).toEqual([
      { level: 'warn', section: 'version', text: 'No good backup in two days' },
    ]);
  });
});

describe('pushSample', () => {
  it('keeps the newest, replaces a repeat of the last timestamp', () => {
    let list = [] as ReturnType<typeof pushSample>;
    for (let i = 0; i < HISTORY_SAMPLES + 5; i++) {
      list = pushSample(list, { t: i, cpu: i, mem: null, disk: null });
    }
    expect(list).toHaveLength(HISTORY_SAMPLES);
    expect(list[0]?.t).toBe(5);
    list = pushSample(list, { t: HISTORY_SAMPLES + 4, cpu: -1, mem: null, disk: null });
    expect(list).toHaveLength(HISTORY_SAMPLES);
    expect(list[list.length - 1]?.cpu).toBe(-1);
  });
});
