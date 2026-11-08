import { describe, expect, it } from 'vitest';
import { REPLY_TEXT_MAX, factsLine, itemLinks, replyText } from './reply-text';

const LONG = 'The details go on for a long time here. '.repeat(20);

describe('replyText', () => {
  it('shows a short reply in full, with its marks gone', () => {
    expect(replyText('I **finished** the [report](page:abc).')).toEqual({
      text: 'I finished the report.',
      cut: false,
      note: null,
    });
  });

  it('takes the lead paragraph of a long reply, cut at a sentence', () => {
    const out = replyText(`I have finished the report for you. ${LONG}`);
    expect(out.cut).toBe(true);
    expect(out.note).toBeNull();
    expect(out.text.startsWith('I have finished the report for you. The details')).toBe(true);
    expect(out.text.endsWith('.')).toBe(true);
    expect(out.text.length).toBeLessThanOrEqual(REPLY_TEXT_MAX);
  });

  it('stops at the end of the lead paragraph', () => {
    const reply = `I created the list of new features you asked for, in the page New features. It has twelve items.\n\n${LONG}`;
    expect(replyText(reply).text).toBe(
      'I created the list of new features you asked for, in the page New features. It has twelve items.',
    );
  });

  it('stops before a list that follows the lead sentence', () => {
    const reply = `I created the list of new features you asked for:\n- ${'one feature, '.repeat(40)}\n- two`;
    expect(replyText(reply).text).toBe('I created the list of new features you asked for:');
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
    expect(replyText(reply).text).toBe('The report is ready now. It has more.');
  });

  it('does not stop at a very short first sentence', () => {
    const out = replyText(`Done. ${'x'.repeat(400)}`);
    expect(out.text.startsWith('Done. xxx')).toBe(true);
    expect(out.text.endsWith('…')).toBe(true);
  });

  it('clamps a long line with no sentence end', () => {
    const out = replyText('word '.repeat(200));
    expect(out.cut).toBe(true);
    expect(out.text.length).toBeLessThanOrEqual(REPLY_TEXT_MAX);
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

describe('factsLine', () => {
  it('says nothing for a reply with no tools', () => {
    expect(factsLine(undefined)).toBeNull();
    expect(factsLine({ calls: 0, failed: 0, queued: 0 })).toBeNull();
  });

  it('counts the tools, the failures and what waits for approval', () => {
    expect(factsLine({ calls: 1, failed: 0, queued: 0 })).toBe('Used 1 tool');
    expect(factsLine({ calls: 6, failed: 1, queued: 0 })).toBe('Used 6 tools, 1 failed');
    expect(factsLine({ calls: 3, failed: 0, queued: 2 })).toBe(
      'Used 3 tools, 2 waiting for approval',
    );
  });
});

describe('itemLinks', () => {
  const A = '0f0e1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
  const B = '1f0e1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
  const C = '2f0e1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b';

  it('takes node links and page cards, as app paths', () => {
    const reply = `I made [**New features**](/n/${A}).\n\n[Roadmap](page:${B})`;
    expect(itemLinks(reply)).toEqual([
      { label: 'New features', href: `/n/${A}` },
      { label: 'Roadmap', href: `/n/${B}` },
    ]);
  });

  it('never offers a link out of the app, an image or another path', () => {
    const reply = [
      `[Out](https://example.com/n/${A})`,
      `![Picture](/n/${A})`,
      `[Settings](/settings/profile)`,
      `[Tricky](/n/${A}/../../x)`,
      `[Script](javascript:alert(1))`,
    ].join(' ');
    expect(itemLinks(reply)).toEqual([]);
  });

  it('keeps one button for each item, two at most', () => {
    const reply = `[One](/n/${A}) [Again](page:${A}) [Two](/n/${B}) [Three](/n/${C})`;
    expect(itemLinks(reply).map((l) => l.label)).toEqual(['One', 'Two']);
  });
});
