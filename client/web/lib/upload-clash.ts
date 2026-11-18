/**
 * What the upload dock does when a file's name is already taken in its
 * folder (file history, brain contract P3), free of React so it can be
 * unit-tested.
 *
 *  - The same bytes are there: the brain answers 200 `{ skipped: true }` and
 *    writes nothing. The row reads "Already here", like a finished upload.
 *  - Other bytes are there: 409 with `reason: 'name-taken'`. The dock asks
 *    once per batch: Override, Override all, Skip, Skip all. Override sends
 *    the same upload again with `replace=true`; the brain keeps the old bytes
 *    as an earlier version. "...all" holds for the rest of that batch only.
 *  - A 409 with no reason: the name is taken by a file the login may not
 *    change (or a brain from before file history). Override would not help.
 */
import { isNameClash } from './upload-progress';

/** The file that holds the name, as the brain's 409 names it. */
export type ExistingFile = {
  id: string;
  sha256: string | null;
  sizeBytes: number;
  name: string;
};

/** The dock line of an upload the brain did not need: the same bytes are there. */
export const ALREADY_HERE = 'Already here';
/** The dock line of a clash the person skipped. */
export const SKIPPED_NOTE = 'Skipped: a different version is here';
/** The dock line of a name a login may not write over. */
export const LOCKED_NOTE = 'A file with this name exists that you cannot change';

/** A 200 from the upload: saved, or skipped because the same bytes are there. */
export type UploadAnswer = { kind: 'saved' } | { kind: 'already-here'; existingId: string | null };

export function readUploadAnswer(body: unknown): UploadAnswer {
  const b = body as { skipped?: unknown; existing?: { id?: unknown } } | null | undefined;
  if (b?.skipped !== true) return { kind: 'saved' };
  return {
    kind: 'already-here',
    existingId: typeof b.existing?.id === 'string' ? b.existing.id : null,
  };
}

/** A refused upload, read: another version holds the name (`name-taken`,
 *  the person decides), a file the login may not change holds it
 *  (`locked`), or it is no name clash at all (null). */
export type NameRefusal = { kind: 'name-taken'; existing: ExistingFile } | { kind: 'locked' } | null;

export function readNameRefusal(
  status: number,
  body: Record<string, unknown> | null,
): NameRefusal {
  if (status !== 409) return null;
  if (body?.reason === 'name-taken') {
    const e = (body.existing ?? {}) as Partial<ExistingFile>;
    return {
      kind: 'name-taken',
      existing: {
        id: typeof e.id === 'string' ? e.id : '',
        sha256: typeof e.sha256 === 'string' ? e.sha256 : null,
        sizeBytes: typeof e.sizeBytes === 'number' ? e.sizeBytes : 0,
        name: typeof e.name === 'string' ? e.name : '',
      },
    };
  }
  return isNameClash(status, body) ? { kind: 'locked' } : null;
}

/** The person's answer to the prompt. Escape or closing it is `skip`. */
export type ClashAnswer = 'override' | 'override-all' | 'skip' | 'skip-all';
/** What an "...all" answer set for the rest of its batch. */
export type BatchRule = 'override' | 'skip';

/** An upload paused on a taken name, waiting for the person. */
export type WaitingClash = {
  /** The dock row. */
  id: string;
  /** The enqueue it came in with: "...all" reaches only that one. */
  batch: string;
  name: string;
  parentPath: string;
  /** The size of the file being uploaded. */
  size: number;
  existing: ExistingFile;
};

/** What to do with a clash as it comes in: the batch's rule, or ask. */
export function clashStep(rule: BatchRule | undefined): BatchRule | 'ask' {
  return rule ?? 'ask';
}

export type ClashOutcome = {
  /** Rows to send again with replace=true. */
  override: string[];
  /** Rows to leave as they are (the dock keeps a Replace on them). */
  skip: string[];
  /** The rule an "...all" answer sets for its batch. */
  rule: { batch: string; rule: BatchRule } | null;
  /** The clashes still waiting, in order. */
  waiting: WaitingClash[];
};

/**
 * Apply an answer to the first waiting clash (the one the prompt names).
 * A single answer settles that row; an "...all" answer settles every row of
 * its batch that waits, and sets the rule for the rows of that batch still
 * to come. Other batches keep waiting.
 */
export function answerClash(waiting: readonly WaitingClash[], answer: ClashAnswer): ClashOutcome {
  const first = waiting[0];
  if (!first) return { override: [], skip: [], rule: null, waiting: [] };
  const all = answer === 'override-all' || answer === 'skip-all';
  const rule: BatchRule = answer === 'override' || answer === 'override-all' ? 'override' : 'skip';
  const settled = all ? waiting.filter((w) => w.batch === first.batch) : [first];
  const ids = settled.map((w) => w.id);
  const gone = new Set(ids);
  return {
    override: rule === 'override' ? ids : [],
    skip: rule === 'skip' ? ids : [],
    rule: all ? { batch: first.batch, rule } : null,
    waiting: waiting.filter((w) => !gone.has(w.id)),
  };
}

/** The prompt's sentence: which file, where, and that the bytes differ. */
export function clashQuestion(name: string, where: string): string {
  return `${name} already exists in ${where}. It has different contents.`;
}

/** How many more clashes of the same batch wait behind the first. */
export function moreInBatch(waiting: readonly WaitingClash[]): number {
  const first = waiting[0];
  if (!first) return 0;
  return waiting.filter((w) => w.batch === first.batch).length - 1;
}
