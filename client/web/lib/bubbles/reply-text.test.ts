import { describe, expect, it } from 'vitest';
import { BUBBLE_TEXT_MAX } from './person-text';
import { replyText } from './reply-text';

const LONG = 'The details go on for a long time here. '.repeat(20);

describe('replyText', () => {
  it('shows a short reply in full, with its marks gone', () => {
    expect(replyText('I **finished** the [report](page:abc).')).toEqual({
      text: 'I finished the report.',
      cut: false,
      note: null,
    });
  });

  it('takes the first sentence of a long reply', () => {
    const out = replyText(`I have finished the report for you. ${LONG}`);
    expect(out).toEqual({
      text: 'I have finished the report for you.',
      cut: true,
      note: null,
    });
  });

  it('skips a heading, a table, a fence and a callout line before the sentence', () => {
    const reply = [
      '# The report',
      '',
      '| a | b |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      '```',
      'not this one',
      '```',
      '',
      ':::info',
      'The report is **ready** now. It has more.',
      ':::',
      '',
      LONG,
    ].join('\n');
    expect(replyText(reply).text).toBe('The report is ready now.');
  });

  it('does not stop at a very short first sentence', () => {
    const out = replyText(`Done. I have finished the report for you. ${LONG}`);
    expect(out.text).toBe('Done. I have finished the report for you.');
  });

  it('clamps a long line with no sentence end', () => {
    const out = replyText('word '.repeat(200));
    expect(out.cut).toBe(true);
    expect(out.text.length).toBeLessThanOrEqual(BUBBLE_TEXT_MAX);
    expect(out.text.endsWith('…')).toBe(true);
  });

  it('falls back to the words when no line is prose', () => {
    const row = `| ${'cell '.repeat(10)} |`;
    const table = ['| head |', '| - |', ...Array.from({ length: 12 }, () => row)].join('\n');
    const out = replyText(table);
    expect(out.cut).toBe(true);
    expect(out.text.length).toBeGreaterThan(0);
  });
});
