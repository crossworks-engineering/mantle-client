import { describe, expect, it } from 'vitest';
import { ApiError } from '@mantle/web-ui/api-fetch';
import type { TreeItem } from '@mantle/web-ui/types/tree';
import {
  HISTORY_GONE,
  hasHistory,
  historyLoadError,
  historyMarkLabel,
  historyRows,
  restoreConfirm,
  treeItemVersions,
  versionActionError,
  type FileVersion,
} from './file-history';

const v = (seq: number, over: Partial<FileVersion> = {}): FileVersion => ({
  id: `s${seq}`,
  seq,
  trigger: 'replace',
  createdAt: `2026-11-1${seq}T10:00:00.000Z`,
  sizeBytes: 2048,
  sha256: null,
  filename: 'report.pdf',
  actor: 'owner',
  restoredFrom: null,
  ...over,
});

describe('historyRows', () => {
  const file = {
    id: 'f1',
    filename: 'report.pdf',
    sizeBytes: 1024,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    replacedAt: '2026-11-17T00:00:00.000Z',
  };

  it('puts the current file first, then the versions newest first', () => {
    const rows = historyRows(file, [v(1), v(3), v(2)]);
    expect(rows.map((r) => r.label)).toEqual(['Current', 'v3', 'v2', 'v1']);
    expect(rows[0]).toMatchObject({ version: null, size: '1.0 KB', at: file.replacedAt });
  });

  it('says who replaced a version, and when', () => {
    const [, row] = historyRows(file, [v(1, { actor: 'member' })]);
    expect(row).toMatchObject({ title: 'Replaced by a team member', at: v(1).createdAt });
    expect(row!.size).toBe('2.0 KB');
  });

  it('says a pre_restore version was kept by restoring another', () => {
    const [, row] = historyRows(file, [v(4, { trigger: 'pre_restore', restoredFrom: 2 })]);
    expect(row!.title).toBe('Kept by restoring v2');
  });

  it('names the former name only when it differs', () => {
    const rows = historyRows(file, [v(2, { filename: 'old-report.pdf' }), v(1)]);
    expect(rows[1]!.formerName).toBe('old-report.pdf');
    expect(rows[2]!.formerName).toBeNull();
  });

  it('falls back to the dates the row has for the current file', () => {
    const rows = historyRows({ id: 'f1', filename: 'a.txt', updatedAt: 'u' }, []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ at: 'u', size: null });
  });

  it('keeps an unknown actor as the brain said it', () => {
    expect(historyRows(file, [v(1, { actor: 'robot' })])[1]!.title).toBe('Replaced by robot');
  });
});

describe('history mark', () => {
  it('shows for one or more versions only; none from an older brain', () => {
    expect(hasHistory(2)).toBe(true);
    expect(hasHistory(0)).toBe(false);
    expect(hasHistory(undefined)).toBe(false);
  });
  it('reads the count off a tree row', () => {
    expect(treeItemVersions({ id: 'a', versions: 3 } as unknown as TreeItem)).toBe(3);
    expect(treeItemVersions({ id: 'a' } as unknown as TreeItem)).toBeUndefined();
  });
  it('says the count in its tooltip', () => {
    expect(historyMarkLabel(1)).toBe('1 earlier version');
    expect(historyMarkLabel(4)).toBe('4 earlier versions');
  });
});

describe('history errors', () => {
  it('a 404 on the list means a brain without history', () => {
    expect(historyLoadError(new ApiError('not found', 404))).toBe(HISTORY_GONE);
  });
  it('a 403 on restore says the login may look but not restore', () => {
    expect(versionActionError(new ApiError('forbidden', 403), 'restore')).toBe(
      'You can see this history but cannot restore.',
    );
  });
  it('409 and 410 say the bytes are missing', () => {
    for (const status of [409, 410]) {
      expect(versionActionError(new ApiError('x', status), 'restore')).toBe(
        'The bytes of this version are missing on the server.',
      );
    }
  });
  it('asks before a restore', () => {
    const c = restoreConfirm(3);
    expect(`${c.title} ${c.body}`).toBe(
      'Restore v3? The current version is kept as a new version.',
    );
  });
});
