import { describe, expect, it } from 'vitest';
import { COMPOSER_ATTACH_ACCEPT, decideComposerPaste, fileMatchesAccept } from './composer-paste';

const f = (name: string, type = '') => ({ name, type });

describe('fileMatchesAccept', () => {
  it('matches a MIME family', () => {
    expect(fileMatchesAccept(f('shot.png', 'image/png'), 'image/*')).toBe(true);
    expect(fileMatchesAccept(f('clip.mp4', 'video/mp4'), 'image/*')).toBe(false);
  });

  it('matches an extension, case-insensitively, and only at the end of the name', () => {
    expect(fileMatchesAccept(f('Report.PDF', 'application/pdf'), '.pdf')).toBe(true);
    expect(fileMatchesAccept(f('notes.md'), '.md')).toBe(true);
    expect(fileMatchesAccept(f('pdf.exe'), '.pdf')).toBe(false);
  });

  it('matches by extension when the OS gave no MIME type at all', () => {
    // Windows often reports '' for .md / .yaml; the extension must still count.
    expect(fileMatchesAccept(f('config.yaml', ''), COMPOSER_ATTACH_ACCEPT)).toBe(true);
  });

  it('matches an exact MIME token', () => {
    expect(fileMatchesAccept(f('x', 'application/pdf'), 'application/pdf')).toBe(true);
  });
});

describe('decideComposerPaste', () => {
  it('leaves an ordinary text paste alone', () => {
    expect(decideComposerPaste(['text/plain'], [])).toEqual({ kind: 'text' });
  });

  it('attaches a file copied in Explorer (Files only)', () => {
    const file = f('invoice.pdf', 'application/pdf');
    expect(decideComposerPaste(['Files'], [file])).toEqual({ kind: 'attach', files: [file] });
  });

  it('attaches a file copied in Finder, which also carries its NAME as text/plain', () => {
    // If "has text" meant "text paste", this would type "invoice.pdf" into the
    // box instead of attaching it.
    const file = f('invoice.pdf', 'application/pdf');
    expect(decideComposerPaste(['text/plain', 'Files'], [file])).toEqual({
      kind: 'attach',
      files: [file],
    });
  });

  it('attaches a pasted screenshot', () => {
    const file = f('image.png', 'image/png');
    expect(decideComposerPaste(['Files'], [file])).toEqual({ kind: 'attach', files: [file] });
  });

  it('treats a rich-text copy (Word/Excel/web) as text, not as its picture', () => {
    const picture = f('image.png', 'image/png');
    expect(decideComposerPaste(['text/plain', 'text/html', 'Files'], [picture])).toEqual({
      kind: 'text',
    });
    expect(decideComposerPaste(['text/plain', 'text/rtf', 'Files'], [picture])).toEqual({
      kind: 'text',
    });
  });

  it('a browser\'s "Copy image" (an <img> tag and the picture, no plain text) is the picture', () => {
    const picture = f('image.png', 'image/png');
    const accept = COMPOSER_ATTACH_ACCEPT;
    // What Chromium gives (checked in the e2e browser): text/html + Files, '' plain.
    expect(decideComposerPaste(['text/html', 'Files'], [picture], accept, '')).toEqual({
      kind: 'attach',
      files: [picture],
    });
    // Blank cells from Excel are whitespace, not nothing: still text.
    expect(
      decideComposerPaste(['text/plain', 'text/html', 'Files'], [picture], accept, '\t\n'),
    ).toEqual({ kind: 'text' });
    // Word or Excel carry the words too: still text.
    expect(
      decideComposerPaste(['text/plain', 'text/html', 'Files'], [picture], accept, 'A1 B1'),
    ).toEqual({ kind: 'text' });
  });

  it('takes every ATTACHABLE file when several were copied, in order', () => {
    const bad = f('setup.exe', 'application/x-msdownload');
    const a = f('data.csv', 'text/csv');
    const b = f('shot.png', 'image/png');
    expect(decideComposerPaste(['Files'], [a, bad, b])).toEqual({ kind: 'attach', files: [a, b] });
  });

  it('rejects an unsupported file with a reason that names it', () => {
    const d = decideComposerPaste(['Files'], [f('movie.mp4', 'video/mp4')]);
    expect(d.kind).toBe('reject');
    if (d.kind === 'reject') {
      expect(d.reason).toContain('movie.mp4');
      expect(d.reason).toContain('Supported');
    }
  });
});
