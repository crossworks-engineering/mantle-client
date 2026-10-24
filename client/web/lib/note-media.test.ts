import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NoteMarkdown } from '@/components/note-markdown';
import { noteAssetPath, noteRefPath, ownerNoteAssetPath } from './note-media';

const FILE = '0e5c1a4e-1111-2222-3333-444455556666';
const DRAW = '7d1f2a3b-4444-5555-6666-777788889999';

/** The form Main and the agents write into a note. */
const NOTE = [
  'Step one.',
  '',
  `![the form](media:${FILE})`,
  '',
  `Open ![the plan](draw:${DRAW}) and [spec.pdf](media:${FILE}), or [docs](https://example.invalid/d).`,
].join('\n');

const render = (assetPath: (src: string) => string | null) =>
  renderToStaticMarkup(createElement(NoteMarkdown, { content: NOTE, assetPath }));

describe('noteRefPath', () => {
  it('names the same admin byte paths a page image carries', () => {
    expect(noteRefPath(`media:${FILE}`)).toBe(`/api/files/files/${FILE}?raw=1`);
    expect(noteRefPath(`draw:${DRAW}`)).toBe(`/api/draws/${DRAW}/svg?raw=1`);
    expect(noteRefPath(`present:${DRAW}`)).toBe(`/api/presents/${DRAW}/poster`);
  });

  it('is null for every other href', () => {
    for (const href of ['https://x/y.png', '/x.png', `page:${FILE}`, 'media:', ''])
      expect(noteRefPath(href), href).toBeNull();
  });
});

describe('noteAssetPath', () => {
  it('the owner keeps the brain routes', () => {
    expect(ownerNoteAssetPath(`media:${FILE}`)).toBe(`/api/files/files/${FILE}?raw=1`);
    expect(ownerNoteAssetPath('https://example.invalid/a.png')).toBe(
      'https://example.invalid/a.png',
    );
  });

  it('a reader map still applies to a reference and a hand-written path', () => {
    const mapped = noteAssetPath((p) => `/r${p}`);
    expect(mapped(`media:${FILE}`)).toBe(`/r/api/files/files/${FILE}?raw=1`);
    expect(mapped(`draw:${DRAW}`)).toBe(`/r/api/draws/${DRAW}/svg?raw=1`);
    expect(mapped(`/api/files/files/${FILE}`)).toBe(`/r/api/files/files/${FILE}`);
  });

  it('drops an unsafe src', () => {
    expect(ownerNoteAssetPath('javascript:alert(1)')).toBeNull();
  });
});

describe('NoteMarkdown', () => {
  it('the owner sees the pictures and the file link', () => {
    const html = render(ownerNoteAssetPath);
    expect(html).toContain(`<img src="/api/files/files/${FILE}?raw=1" alt="the form"/>`);
    expect(html).toContain(`<img src="/api/draws/${DRAW}/svg?raw=1" alt="the plan"/>`);
    expect(html).toContain(
      `<a href="/api/files/files/${FILE}?raw=1" target="_blank" rel="noopener noreferrer">spec.pdf</a>`,
    );
    expect(html).toContain('<a href="https://example.invalid/d">docs</a>');
    expect(html).not.toContain('media:');
    expect(html).not.toContain('draw:');
  });

  it('every login reads them on the owner byte routes (W7e: in its own scope)', () => {
    // There is one reader for every login now: no member route is named.
    const html = render(ownerNoteAssetPath);
    expect(html).not.toMatch(/\/api\/member\//);
  });

  it('a reference the reader may not read is its text, never a request', () => {
    const html = render(() => null);
    expect(html).not.toContain('<img');
    expect(html).toContain('[the form]');
    expect(html).toContain('<span>spec.pdf</span>');
    // An ordinary link is not a reference and stays a link.
    expect(html).toContain('<a href="https://example.invalid/d">docs</a>');
  });
});
