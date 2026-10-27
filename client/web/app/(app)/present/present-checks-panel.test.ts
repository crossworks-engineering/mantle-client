/**
 * The image check panel's summary line (present-checks-panel.tsx): the
 * counts the brain sends, in words, only the parts there are.
 */
import { describe, expect, it } from 'vitest';
import { countsLine, presentChecksKey } from './present-checks-panel';

describe('the image check panel', () => {
  it('says the counts in words, the parts there are', () => {
    expect(countsLine({ checked: 12, no: 1, unsure: 2 })).toBe(
      '12 checked by image · 1 image says no · 2 unsure',
    );
    expect(countsLine({ checked: 3, no: 0, unsure: 0 })).toBe('3 checked by image');
    expect(countsLine({ checked: 0, no: 0, unsure: 0 })).toBe('no image checks yet');
  });

  it('keys the overview under its canvas, so a canvas refresh reads it again', () => {
    expect(presentChecksKey('c1')).toEqual(['presents', 'c1', 'checks']);
  });
});
