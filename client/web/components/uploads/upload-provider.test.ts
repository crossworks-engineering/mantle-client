import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { finishedHeading } from './upload-provider';

const none = { done: 0, exists: 0, conflicts: 0, failed: 0, cancelled: 0 };

describe('finishedHeading', () => {
  it('counts only files sent as uploaded', () => {
    expect(finishedHeading({ ...none, done: 1, exists: 2 })).toBe(
      'Uploaded 1 file · 2 already there',
    );
    expect(finishedHeading({ ...none, done: 2, exists: 1, conflicts: 1 })).toBe(
      'Uploaded 2 files · 1 already there · 1 not replaced',
    );
  });
  it('names a file already there alone when nothing was sent', () => {
    expect(finishedHeading({ ...none, exists: 1 })).toBe('1 already there');
    expect(finishedHeading({ ...none, exists: 2, failed: 1 })).toBe('2 already there · 1 failed');
  });
  it('leads with what happened when nothing was uploaded', () => {
    expect(finishedHeading({ ...none, conflicts: 1 })).toBe('1 not replaced');
  });
  it('says plainly when all went through', () => {
    expect(finishedHeading({ ...none, done: 1 })).toBe('Uploaded 1 file');
  });
});

describe('the uploader lets go of only its own controller', () => {
  it('releases through releaseController, never by a plain clear', () => {
    // An Override resend starts inside the old send: a plain clear in the
    // old send's finally wiped the resend's controller and Cancel did nothing.
    const src = readFileSync(new URL('./upload-provider.tsx', import.meta.url), 'utf8');
    expect(src).toContain('releaseController(entry, controller)');
    expect(src).not.toMatch(/entry\.controller = undefined/);
  });
});
