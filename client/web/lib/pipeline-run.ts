/**
 * The Run button of Files: run a built-in pipeline on one file or a folder
 * (mantle docs/pipelines.md, "Run on demand"). The brain answers
 * POST /api/files/files/:id/run and POST /api/files/folders/:id/run with a
 * `PipelineRunAnswer`; an older brain has no such route (404).
 *
 * Two checks, and no third. (1) The dialog always asks first: a body with
 * `apply` comes only from `applyBody` or `nextBody`, and each needs a dry run
 * answer that is on screen. (2) No pipeline list in the client: the choices
 * are the answer's own. Pure helpers only: no DOM here.
 */

/**
 * LOCAL COPY of @mantle/client-types dto/pipelines.ts `PipelineRunSkip`,
 * `PipelineRunBody` and `PipelineRunAnswer` (mantle, branch
 * feat/pipelines-2-m5, pipelines phase 2). Declared here until the contract
 * pin moves past the release that ships them; then import them and delete
 * these.
 */
export type PipelineRunSkip =
  'no-match' | 'no-database' | 'not-attached' | 'no-sha' | 'private' | 'pdf';

/** LOCAL COPY, as above. With no `apply`, the dry run. */
export type PipelineRunBody = {
  pipeline?: string;
  apply?: boolean;
  limit?: number;
  after?: string;
};

/** LOCAL COPY, as above. The dry run and the run alike. */
export type PipelineRunAnswer = {
  apply: boolean;
  /** The extract queue is busy: nothing was queued. */
  busy: boolean;
  /** The pipelines that can run on these files, with the count each takes.
   *  `refused`: a word when it may not run ('pdf'). */
  choices: { pipeline: string; name: string; files: number; refused: string | null }[];
  queued: number;
  /** The files the named pipeline does not take, by PipelineRunSkip word. */
  skipped: Record<string, number>;
  /** The last file id looked at, when there are more: send it as `after`. */
  next: string | null;
};

export type RunTarget = { kind: 'file' | 'folder'; id: string; name: string };

export function runPath(target: Pick<RunTarget, 'kind' | 'id'>): string {
  return target.kind === 'file'
    ? `/api/files/files/${target.id}/run`
    : `/api/files/folders/${target.id}/run`;
}

/** The most files one call looks at: the brain's default, as no `limit` is sent. */
export const RUN_LIMIT = 100;

export const RUN_BUSY = 'The box is busy. Try later.';
export const RUN_NO_CHOICE = 'No pipeline can run on these files.';
export const RUN_QUEUED_NOTE =
  "Queued is not done. When a file's run is done, its Data view shows which pipeline read it.";
export const RUN_NEXT_LABEL = `Run the next ${RUN_LIMIT}`;

/** Where the dialog is. `shown` and `done` carry the dry run on screen. */
export type RunStep =
  | { step: 'asking' }
  | { step: 'shown'; dry: PipelineRunAnswer }
  | { step: 'done'; dry: PipelineRunAnswer; pipeline: string; result: PipelineRunAnswer }
  | { step: 'error'; message: string };

/** The first call of the dialog, always: the dry run. */
export const DRY_RUN_BODY: PipelineRunBody = {};

/** Whether a choice may be picked: not refused, and it takes a file. */
export function choiceOpen(c: PipelineRunAnswer['choices'][number]): boolean {
  return c.refused === null && c.files > 0;
}

/** The choices that may be picked, from the answer alone. */
export function openChoices(dry: PipelineRunAnswer): PipelineRunAnswer['choices'] {
  return dry.busy ? [] : dry.choices.filter(choiceOpen);
}

/** The first pick: the one open choice when there is only one. */
export function firstPick(dry: PipelineRunAnswer): string | null {
  const open = openChoices(dry);
  return open.length === 1 ? open[0]!.pipeline : null;
}

/** The body of Run: only with a dry run on screen, not busy, and a pick
 *  that is one of its open choices. Else null: nothing to send. */
export function applyBody(step: RunStep, pipeline: string | null): PipelineRunBody | null {
  if (step.step !== 'shown' || !pipeline) return null;
  if (!openChoices(step.dry).some((c) => c.pipeline === pipeline)) return null;
  return { apply: true, pipeline };
}

/** The body of "Run the next": the same pipeline, after the last file the
 *  run looked at. Only after a run whose answer has `next`. */
export function nextBody(step: RunStep): PipelineRunBody | null {
  if (step.step !== 'done' || step.result.busy || !step.result.next) return null;
  return { apply: true, pipeline: step.pipeline, after: step.result.next };
}

/** A skip word in plain words, after a count. An unknown word is shown as
 *  the brain sent it. */
const SKIP_WORDS: Record<PipelineRunSkip, { one: string; many: string }> = {
  'no-match': { one: 'does not fit this pipeline', many: 'do not fit this pipeline' },
  'no-database': { one: 'has no database yet', many: 'have no database yet' },
  'not-attached': {
    one: 'is in a workspace the pipeline is not attached to',
    many: 'are in a workspace the pipeline is not attached to',
  },
  'no-sha': { one: 'has no checksum', many: 'have no checksum' },
  private: { one: 'stays out of the brain', many: 'stay out of the brain' },
  pdf: {
    one: 'is a PDF drawing, whose reader is refused for now',
    many: 'are PDF drawings, whose reader is refused for now',
  },
};

export function skipText(word: string, n: number): string {
  const w = SKIP_WORDS[word as PipelineRunSkip];
  return w ? `${n} ${n === 1 ? w.one : w.many}` : `${n} ${word}`;
}

/** A choice's refusal word in plain words. */
export function refusedText(word: string): string {
  return word === 'pdf' ? 'Refused for now: the reader of a PDF drawing.' : `Refused: ${word}.`;
}

export function filesText(n: number): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'file' : 'files'}`;
}

/** "N files are queued. M were not taken." */
export function resultLine(result: PipelineRunAnswer): string {
  const q = result.queued;
  const m = Object.values(result.skipped).reduce((a, b) => a + b, 0);
  return `${filesText(q)} ${q === 1 ? 'is' : 'are'} queued. ${m.toLocaleString('en-US')} ${
    m === 1 ? 'was' : 'were'
  } not taken.`;
}

/** The skip words of a result, each with its count, in plain words. */
export function skipLines(result: PipelineRunAnswer): string[] {
  return Object.entries(result.skipped)
    .filter(([, n]) => n > 0)
    .map(([w, n]) => skipText(w, n));
}

/**
 * An older brain has no run route: after its first 404 the Run entry hides
 * for the rest of the session. One flag, and who listens to it.
 */
let runGone = false;
const listeners = new Set<() => void>();

export function runRouteGone(): boolean {
  return runGone;
}

export function markRunRouteGone(): void {
  if (runGone) return;
  runGone = true;
  for (const l of listeners) l();
}

export function subscribeRunRouteGone(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Tests only: a fresh session. */
export function resetRunRouteGone(): void {
  runGone = false;
}

/** Whether the Run entry shows: the item's own edit right, and a brain that
 *  has the route (`gone`: runRouteGone). No other rule. */
export function showRunEntry(mayEdit: boolean, gone: boolean): boolean {
  return mayEdit && !gone;
}

type Send = (path: string, method: 'POST', body: PipelineRunBody) => Promise<unknown>;

/** One call of the run route. A 404 marks the route gone, then throws on. */
export async function postRun(
  target: Pick<RunTarget, 'kind' | 'id'>,
  body: PipelineRunBody,
  send: Send,
): Promise<PipelineRunAnswer> {
  try {
    return (await send(runPath(target), 'POST', body)) as PipelineRunAnswer;
  } catch (err) {
    if ((err as { status?: unknown } | null)?.status === 404) markRunRouteGone();
    throw err;
  }
}
