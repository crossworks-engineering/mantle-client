import { describe, expect, it } from 'vitest';
import {
  ALREADY_HERE,
  answerClash,
  clashQuestion,
  clashStep,
  moreInBatch,
  readNameRefusal,
  readUploadAnswer,
  savedOutcome,
  type WaitingClash,
} from './upload-clash';

const existing = { id: 'f1', sha256: 'aa', sizeBytes: 10, name: 'x.pdf' };
const clash = (id: string, batch: string): WaitingClash => ({
  id,
  batch,
  name: `${id}.pdf`,
  parentPath: 'files.a',
  size: 12,
  existing,
});

describe('readUploadAnswer', () => {
  it('reads the same-bytes answer as already here, not as a new file', () => {
    expect(
      readUploadAnswer({
        skipped: true,
        reason: 'same-bytes',
        existing: { id: 'f1', sha256: 'aa' },
      }),
    ).toEqual({ kind: 'already-here', existingId: 'f1' });
  });
  it('reads a normal answer as saved, with the file it names', () => {
    expect(readUploadAnswer({ file: { id: 'f2' } })).toEqual({ kind: 'saved', fileId: 'f2' });
    expect(readUploadAnswer({})).toEqual({ kind: 'saved', fileId: null });
    expect(readUploadAnswer(null)).toEqual({ kind: 'saved', fileId: null });
  });
  it('survives a skipped answer without the file there', () => {
    expect(readUploadAnswer({ skipped: true })).toEqual({ kind: 'already-here', existingId: null });
  });
});

describe('savedOutcome', () => {
  const skipped = readUploadAnswer({
    skipped: true,
    reason: 'same-bytes',
    existing: { id: 'f1', sha256: 'aa' },
  });
  it('reads a skipped answer to a replace resend as already here, not an error', () => {
    // An automatic retry of an Override whose first copy did land.
    expect(savedOutcome(skipped, true)).toEqual({
      status: 'exists',
      note: ALREADY_HERE,
      reloadFileId: null,
    });
    expect(savedOutcome(skipped, false)).toEqual(savedOutcome(skipped, true));
  });
  it('names the file when an automatic retry of an Override is answered skipped', () => {
    // The first send landed, its answer was lost: the file there has the new bytes.
    expect(savedOutcome(skipped, true, true)).toEqual({
      status: 'exists',
      note: ALREADY_HERE,
      reloadFileId: 'f1',
    });
    // Not an Override, or not a retry: nothing to reload.
    expect(savedOutcome(skipped, false, true).reloadFileId).toBeNull();
    expect(savedOutcome(skipped, true, false).reloadFileId).toBeNull();
  });
  it('names the file an Override wrote over, so an open view reloads', () => {
    const saved = readUploadAnswer({ file: { id: 'f2' } });
    expect(savedOutcome(saved, true)).toEqual({ status: 'done', reloadFileId: 'f2' });
  });
  it('reloads nothing for a new upload', () => {
    const saved = readUploadAnswer({ file: { id: 'f2' } });
    expect(savedOutcome(saved, false)).toEqual({ status: 'done', reloadFileId: null });
  });
});

describe('readNameRefusal', () => {
  it('reads the name-taken 409 with the file there', () => {
    expect(
      readNameRefusal(409, {
        error: "writeFile: 'x.pdf' already exists in this folder",
        reason: 'name-taken',
        existing,
      }),
    ).toEqual({ kind: 'name-taken', existing });
  });
  it('reads a 409 without a reason as a name the login may not change', () => {
    expect(
      readNameRefusal(409, { error: "writeFile: 'x.pdf' already exists in this folder" }),
    ).toEqual({ kind: 'locked' });
  });
  it('is no name clash for other refusals', () => {
    expect(readNameRefusal(409, { error: 'something else' })).toBeNull();
    expect(readNameRefusal(500, { reason: 'name-taken' })).toBeNull();
    expect(readNameRefusal(409, null)).toBeNull();
  });
});

describe('clash decisions per batch', () => {
  it('asks when the batch has no rule yet, else follows it', () => {
    expect(clashStep(undefined)).toBe('ask');
    expect(clashStep('override')).toBe('override');
    expect(clashStep('skip')).toBe('skip');
  });

  it('Override settles the one row named, and sets no rule', () => {
    const out = answerClash([clash('a', 'b1'), clash('b', 'b1')], 'override');
    expect(out.override).toEqual(['a']);
    expect(out.skip).toEqual([]);
    expect(out.rule).toBeNull();
    expect(out.waiting.map((w) => w.id)).toEqual(['b']);
  });

  it('Skip settles the one row named', () => {
    const out = answerClash([clash('a', 'b1'), clash('b', 'b1')], 'skip');
    expect(out.skip).toEqual(['a']);
    expect(out.override).toEqual([]);
    expect(out.rule).toBeNull();
    expect(out.waiting.map((w) => w.id)).toEqual(['b']);
  });

  it('Override all settles every waiting row of that batch and sets its rule', () => {
    const out = answerClash([clash('a', 'b1'), clash('x', 'b2'), clash('b', 'b1')], 'override-all');
    expect(out.override).toEqual(['a', 'b']);
    expect(out.rule).toEqual({ batch: 'b1', rule: 'override' });
    // Another batch's clash still waits for its own answer.
    expect(out.waiting.map((w) => w.id)).toEqual(['x']);
  });

  it('Skip all settles every waiting row of that batch and sets its rule', () => {
    const out = answerClash([clash('a', 'b1'), clash('b', 'b1'), clash('x', 'b2')], 'skip-all');
    expect(out.skip).toEqual(['a', 'b']);
    expect(out.override).toEqual([]);
    expect(out.rule).toEqual({ batch: 'b1', rule: 'skip' });
    expect(out.waiting.map((w) => w.id)).toEqual(['x']);
  });

  it('a rule set by "all" decides the later rows of that batch only', () => {
    const rules = new Map<string, 'override' | 'skip'>();
    const out = answerClash([clash('a', 'b1')], 'override-all');
    if (out.rule) rules.set(out.rule.batch, out.rule.rule);
    expect(clashStep(rules.get('b1'))).toBe('override');
    expect(clashStep(rules.get('b2'))).toBe('ask');
  });

  it('nothing waiting is nothing to do', () => {
    expect(answerClash([], 'override-all')).toEqual({
      override: [],
      skip: [],
      rule: null,
      waiting: [],
    });
  });

  it('counts the rest of the batch behind the first', () => {
    expect(moreInBatch([clash('a', 'b1'), clash('x', 'b2'), clash('b', 'b1')])).toBe(1);
    expect(moreInBatch([clash('a', 'b1')])).toBe(0);
    expect(moreInBatch([])).toBe(0);
  });

  it('names the file, the folder and that the contents differ', () => {
    expect(clashQuestion('x.pdf', 'Files > A > B')).toBe(
      'x.pdf already exists in Files > A > B. It has different contents.',
    );
  });
});
