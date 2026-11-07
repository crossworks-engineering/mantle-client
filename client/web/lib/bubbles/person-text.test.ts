import { describe, expect, it } from 'vitest';
import { BUBBLE_TEXT_MAX, clampText, personText } from './person-text';

describe('personText', () => {
  it('shows a short message in full, with its line breaks', () => {
    expect(personText('  Hello\nThere  ')).toEqual({
      text: 'Hello\nThere',
      cut: false,
      note: null,
    });
  });

  it('cuts a long one-line message and says so', () => {
    const out = personText('word '.repeat(100));
    expect(out.cut).toBe(true);
    expect(out.note).toBe('sent a long message');
    expect(out.text.length).toBeLessThanOrEqual(120);
    expect(out.text.endsWith('…')).toBe(true);
  });

  it('cuts many short lines and counts them', () => {
    const out = personText(['first', 'b', 'c', 'd', 'e', 'f', 'g'].join('\n'));
    expect(out).toEqual({ text: 'first', cut: true, note: 'sent a long message, 7 lines' });
  });

  it('takes the first line with words as the cut', () => {
    const out = personText(`\n\n   \nThe point\n${'x'.repeat(BUBBLE_TEXT_MAX)}`);
    expect(out.text).toBe('The point');
  });

  it('holds the limit exactly', () => {
    expect(personText('x'.repeat(BUBBLE_TEXT_MAX)).cut).toBe(false);
    expect(personText('x'.repeat(BUBBLE_TEXT_MAX + 1)).cut).toBe(true);
  });
});

describe('clampText', () => {
  it('leaves a short text alone', () => {
    expect(clampText('short', 10)).toBe('short');
  });

  it('cuts at a word near the end', () => {
    expect(clampText('one two three four', 12)).toBe('one two…');
  });

  it('cuts a text with no space at the limit', () => {
    expect(clampText('x'.repeat(20), 10)).toBe(`${'x'.repeat(9)}…`);
  });
});
