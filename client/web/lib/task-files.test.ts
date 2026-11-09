import { describe, expect, it } from 'vitest';
import {
  TASK_FILE_ACCEPT,
  TASK_FILE_MAX_BYTES,
  TASK_FILES_MAX,
  checkTaskUploads,
  decideTaskPaste,
  isTaskFileType,
  taskFileExt,
  taskFileName,
} from './task-files';

const f = (name: string, size = 100, type = '') => ({ name, size, type });

describe('the mirrored contract', () => {
  it('reads the extension, lower-case, and none for a dotfile or no dot', () => {
    expect(taskFileExt('Shot.PNG')).toBe('png');
    expect(taskFileExt('archive.tar.gz')).toBe('gz');
    expect(taskFileExt('.env')).toBe('');
    expect(taskFileExt('README')).toBe('');
  });

  it('takes the listed types and refuses svg and html', () => {
    for (const ok of ['a.png', 'a.jpeg', 'a.webp', 'a.pdf', 'a.log', 'a.md', 'a.csv']) {
      expect(isTaskFileType(ok), ok).toBe(true);
    }
    for (const no of ['a.svg', 'a.html', 'a.htm', 'a.exe', 'a.docx', 'noext']) {
      expect(isTaskFileType(no), no).toBe(false);
    }
  });

  it('builds the accept list from the extensions', () => {
    expect(TASK_FILE_ACCEPT).toBe('.png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.log,.md,.json,.csv');
  });
});

describe('taskFileName', () => {
  it('keeps a name the brain takes', () => {
    expect(taskFileName({ name: 'image.png', type: 'image/png' })).toBe('image.png');
  });

  it('names a nameless pasted picture by its type', () => {
    expect(taskFileName({ name: '', type: 'image/png' })).toBe('pasted-image.png');
    expect(taskFileName({ name: 'image', type: 'image/jpeg' })).toBe('image.jpg');
  });

  it('leaves any other name alone, so the check can refuse it', () => {
    expect(taskFileName({ name: 'logo.svg', type: 'image/svg+xml' })).toBe('logo.svg');
    expect(taskFileName({ name: 'notes', type: '' })).toBe('notes');
  });
});

describe('checkTaskUploads', () => {
  it('accepts good files in order', () => {
    const r = checkTaskUploads([f('a.png'), f('b.log')], 0);
    expect(r.accepted.map((x) => x.name)).toEqual(['a.png', 'b.log']);
    expect(r.refused).toEqual([]);
  });

  it('refuses a type off the list, naming the types', () => {
    const r = checkTaskUploads([f('page.html')], 0);
    expect(r.accepted).toEqual([]);
    expect(r.refused[0]).toMatch(/^page\.html can't go on a task\. Use PNG/);
  });

  it('refuses an empty file', () => {
    expect(checkTaskUploads([f('a.txt', 0)], 0).refused).toEqual(['a.txt is empty.']);
  });

  it('refuses a file over the cap, naming the cap', () => {
    const r = checkTaskUploads([f('big.pdf', TASK_FILE_MAX_BYTES + 1)], 0);
    expect(r.accepted).toEqual([]);
    expect(r.refused[0]).toBe('big.pdf is over the 10 MB limit for a task file.');
    // Exactly at the cap is fine.
    expect(checkTaskUploads([f('ok.pdf', TASK_FILE_MAX_BYTES)], 0).accepted).toHaveLength(1);
  });

  it('fills the task to the cap and says how many were left out', () => {
    const batch = [f('1.png'), f('2.png'), f('3.png')];
    const r = checkTaskUploads(batch, TASK_FILES_MAX - 1);
    expect(r.accepted.map((x) => x.name)).toEqual(['1.png']);
    expect(r.refused).toEqual(['A task holds 5 files. 2 files were not added.']);
    expect(checkTaskUploads([f('x.png')], TASK_FILES_MAX).refused).toEqual([
      'A task holds 5 files. 1 file was not added.',
    ]);
  });

  it('a refused file does not use up a place', () => {
    const r = checkTaskUploads([f('bad.svg'), f('good.png')], TASK_FILES_MAX - 1);
    expect(r.accepted.map((x) => x.name)).toEqual(['good.png']);
    expect(r.refused).toHaveLength(1);
  });

  it('checks a nameless pasted picture by the name it will go up under', () => {
    expect(checkTaskUploads([f('', 10, 'image/png')], 0).accepted).toHaveLength(1);
  });
});

describe('decideTaskPaste', () => {
  const file = (name: string, type = '') => ({ name, type });

  it('lets a plain text paste through', () => {
    expect(decideTaskPaste(['text/plain'], [])).toEqual({ kind: 'text' });
  });

  it('attaches a screenshot', () => {
    const shot = file('image.png', 'image/png');
    expect(decideTaskPaste(['Files'], [shot])).toEqual({ kind: 'attach', files: [shot] });
  });

  it('attaches a nameless pasted picture by its type', () => {
    const shot = file('', 'image/png');
    expect(decideTaskPaste(['Files'], [shot])).toEqual({ kind: 'attach', files: [shot] });
  });

  it('attaches a Finder copy, which also carries the filename as text', () => {
    const log = file('server.log');
    expect(decideTaskPaste(['Files', 'text/plain'], [log])).toEqual({
      kind: 'attach',
      files: [log],
    });
  });

  it('treats rich text with a picture of itself as a text paste', () => {
    expect(
      decideTaskPaste(['text/plain', 'text/html', 'Files'], [file('image.png', 'image/png')]),
    ).toEqual({ kind: 'text' });
  });

  it('refuses a type off the list in the task words', () => {
    const d = decideTaskPaste(['Files'], [file('drawing.svg', 'image/svg+xml')]);
    expect(d).toEqual({
      kind: 'reject',
      reason:
        "drawing.svg can't go on a task. Use PNG, JPG, GIF, WebP, PDF, TXT, LOG, MD, JSON or CSV.",
    });
  });

  it('refuses a Word file the composer would take', () => {
    expect(decideTaskPaste(['Files'], [file('spec.docx')]).kind).toBe('reject');
  });
});
