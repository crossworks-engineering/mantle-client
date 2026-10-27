import { describe, expect, it } from 'vitest';
import {
  SERVICE_ENABLES,
  currentRun,
  diskWarning,
  memoryWarning,
  offWarning,
  runBusy,
  runLabel,
  stateLabel,
  type ServiceInfo,
  type ServiceRunStatus,
  type ServicesView,
} from './services';

const GB = 1024 ** 3;

function svc(over: Partial<ServiceInfo['description']> = {}): ServiceInfo {
  return {
    name: 'sandboxes',
    state: 'off',
    container: 'absent',
    health: 'none',
    description: {
      title: 'Sandboxes',
      what: 'w',
      usedBy: 'u',
      whenOff: 'o',
      keeps: 'k',
      downloadMb: 300,
      memory: 'up to 1 GB (3 GB is advised for large builds)',
      memoryMaxMb: 3072,
      note: null,
      ...over,
    },
  };
}

function view(box: Partial<ServicesView['box']> = {}): ServicesView {
  return {
    services: [svc()],
    switching: { available: true, reason: null },
    box: {
      memTotalBytes: 16 * GB,
      memAvailableBytes: 8 * GB,
      diskFreeBytes: 50 * GB,
      core: false,
      smallBox: false,
      ...box,
    },
    run: null,
  };
}

function run(over: Partial<ServiceRunStatus> = {}): ServiceRunStatus {
  return {
    phase: 'done',
    service: 'sandboxes',
    enable: true,
    startedAt: '2026-10-05T12:00:00Z',
    finishedAt: '2026-10-05T12:01:00Z',
    ok: true,
    error: null,
    ...over,
  };
}

describe('memoryWarning (shown, never a block)', () => {
  it('says nothing on a box with room', () => {
    expect(memoryWarning(view(), svc())).toBeNull();
  });

  it('warns a 4 GB box with its size and the service cost', () => {
    const w = memoryWarning(view({ memTotalBytes: 4 * GB, smallBox: true }), svc());
    expect(w).toContain('This box has 4 GB of memory');
    expect(w).toContain('Sandboxes can use up to 1 GB');
    expect(w).toContain('Switch it off again');
  });

  it('stays short: drops the bracketed aside from the memory line', () => {
    const w = memoryWarning(view({ memTotalBytes: 4 * GB, smallBox: true }), svc()) ?? '';
    expect(w).not.toContain('large builds');
    expect(w.length).toBeLessThan(140);
  });

  it('warns a core box whatever its memory, and says why', () => {
    expect(memoryWarning(view({ core: true, smallBox: true }), svc())).toContain(
      'small core setup',
    );
  });

  it('warns when the service could take more than half the memory', () => {
    expect(memoryWarning(view({ memTotalBytes: 6 * GB }), svc())).not.toBeNull();
  });

  it('never uses an en or em dash (house style)', () => {
    const w = memoryWarning(view({ memTotalBytes: 4 * GB, smallBox: true }), svc()) ?? '';
    expect(w).not.toMatch(/[–—]/);
  });
});

describe('diskWarning', () => {
  it('only when the disk is near the updater floor', () => {
    expect(diskWarning(view(), svc())).toBeNull();
    expect(diskWarning(view({ diskFreeBytes: 3 * GB }), svc())).toContain('3 GB of disk');
    expect(diskWarning(view({ diskFreeBytes: null }), svc())).toBeNull();
  });
});

describe('currentRun: the status before the updater picked the request up', () => {
  const sent = Date.parse('2026-10-05T12:10:00Z');

  it('a run that started before the request reads as waiting', () => {
    const r = currentRun(run({ phase: 'error', error: 'old failure' }), sent);
    expect(r).toMatchObject({ phase: 'requested', error: null, ok: null });
    expect(runBusy(r)).toBe(true);
  });

  it('a run that started after the request is the one to follow', () => {
    const r = currentRun(run({ phase: 'pulling', startedAt: '2026-10-05T12:10:02Z' }), sent);
    expect(r?.phase).toBe('pulling');
  });

  it('without a request in flight the run is shown as it is', () => {
    expect(currentRun(run(), null)?.phase).toBe('done');
    expect(currentRun(null, sent)).toBeNull();
  });
});

describe('labels', () => {
  it('a plain line per phase; off always says the data is kept', () => {
    expect(runLabel(run({ phase: 'pulling' }))).toMatch(/1 to 3 minutes/);
    expect(runLabel(run({ phase: 'stopping' }))).toMatch(/data is kept/);
    expect(runLabel(run({ phase: 'done', enable: false }))).toMatch(/data is kept/);
    expect(runLabel(run({ phase: 'done', enable: true }))).toBe('Switched on');
    expect(runLabel(run({ phase: 'error', error: 'not enough disk' }))).toBe('not enough disk');
  });

  it('states', () => {
    expect([stateLabel('off'), stateLabel('up'), stateLabel('down')]).toEqual([
      'Off',
      'Running',
      'Not answering',
    ]);
  });
});

describe("the screen is the settings area's", () => {
  it('a login without it is refused Settings > Services', async () => {
    const { mayOpenPath } = await import('./workspaces');
    expect(mayOpenPath([], '/settings/services')).toBe(false);
    expect(mayOpenPath(['settings'], '/settings/services')).toBe(true);
  });
});

describe('the one line per service card', () => {
  it('one short plain sentence per service, no en or em dash', () => {
    for (const line of Object.values(SERVICE_ENABLES) as string[]) {
      expect(line.startsWith('Lets ')).toBe(true);
      expect(line.endsWith('.')).toBe(true);
      expect(line.length).toBeLessThan(120);
      expect(line).not.toMatch(/[\u2013\u2014]/);
    }
    expect(Object.keys(SERVICE_ENABLES).sort()).toEqual(['helpers', 'local-embedder', 'sandboxes']);
  });
});

describe('offWarning', () => {
  it('reads the brain line, and is null from an older brain', () => {
    expect(offWarning(svc())).toBeNull();
    const withLine = svc({ offWarning: 'PDF export stops.' } as Partial<
      ServiceInfo['description']
    >);
    expect(offWarning(withLine)).toBe('PDF export stops.');
  });

  it('a warning for a two-container service stays short', () => {
    const w = memoryWarning(
      view({ memTotalBytes: 4 * GB, smallBox: true }),
      svc({ title: 'Helpers', memory: 'up to 3 GB (1.5 GB each)', memoryMaxMb: 3072 }),
    );
    expect(w).toContain('Helpers can use up to 3 GB, so');
  });
});
