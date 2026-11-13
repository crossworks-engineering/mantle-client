import { describe, expect, it } from 'vitest';
import { mayOpenPath } from './workspaces';
import { countText, olderText, readsText } from './pipelines';

describe('Settings > Pipelines words', () => {
  it('a count the brain did not make is a dash', () => {
    expect(countText(null)).toBe('-');
    expect(countText(0)).toBe('0');
    expect(countText(1234)).toBe('1,234');
  });

  it('the older line says how many files an older version read, or nothing', () => {
    expect(olderText(1)).toBe('1 file was read by an older version');
    expect(olderText(12)).toBe('12 files were read by an older version');
    expect(olderText(0)).toBeNull();
    expect(olderText(null)).toBeNull();
  });

  it('the extensions read as one short line', () => {
    expect(readsText(['xlsx', 'xls', 'csv'])).toBe('.xlsx, .xls, .csv');
  });
});

describe("the screen is the settings area's", () => {
  it('a login without it is refused Settings > Pipelines', () => {
    expect(mayOpenPath([], '/settings/pipelines')).toBe(false);
    expect(mayOpenPath(['connectors', 'users'], '/settings/pipelines')).toBe(false);
    expect(mayOpenPath(['settings'], '/settings/pipelines')).toBe(true);
  });
});
