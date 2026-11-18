import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { finishedHeading } from './upload-provider';

const none = { done: 0, exists: 0, conflicts: 0, failed: 0, cancelled: 0 };

describe('finishedHeading', () => {
  it('counts files already there as uploaded', () => {
    expect(finishedHeading({ ...none, done: 1, exists: 2 })).toBe(
      'Uploaded 3 files · 2 already there',
    );
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
