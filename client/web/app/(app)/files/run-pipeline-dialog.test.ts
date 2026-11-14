/**
 * The Run dialog of Files (lib/pipeline-run.ts): it renders a fixed dry run
 * with its choices and counts; Run sends `apply` with the picked pipeline
 * and only after a dry run on screen; a busy answer shows no Run button; a
 * 404 hides the entry for the session; `next` shows "Run the next" and sends
 * `after`.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DRY_RUN_BODY,
  RUN_BUSY,
  RUN_NEXT_LABEL,
  RUN_QUEUED_NOTE,
  applyBody,
  firstPick,
  nextBody,
  postRun,
  resetRunRouteGone,
  resultLine,
  runPath,
  runRouteGone,
  showRunEntry,
  skipLines,
  type PipelineRunAnswer,
  type PipelineRunBody,
  type RunStep,
} from '@/lib/pipeline-run';
import { RunPipelineView } from './run-pipeline-dialog';

/** A fixed dry run of a folder of made-up drawings. */
const DRY: PipelineRunAnswer = {
  apply: false,
  busy: false,
  choices: [
    { pipeline: 'drawing-cad', name: 'CAD drawing', files: 4, refused: null },
    { pipeline: 'site-tags', name: 'Site tags', files: 3, refused: null },
    { pipeline: 'drawing-pdf', name: 'PDF drawing', files: 2, refused: 'pdf' },
  ],
  queued: 0,
  skipped: {},
  next: null,
};

const RESULT: PipelineRunAnswer = {
  apply: true,
  busy: false,
  choices: DRY.choices,
  queued: 3,
  skipped: { 'not-attached': 2, 'no-database': 1 },
  next: null,
};

const noop = () => {};
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ');
const view = (step: RunStep, pick: string | null = null) =>
  renderToStaticMarkup(
    createElement(RunPipelineView, {
      step,
      pick,
      onPick: noop,
      pending: false,
      onRun: noop,
      onNext: noop,
      onClose: noop,
    }),
  );

afterEach(() => resetRunRouteGone());

describe('the Run dialog', () => {
  it('renders a fixed dry run: each choice of the answer with its count', () => {
    const html = view({ step: 'shown', dry: DRY });
    const t = text(html);
    for (const want of [
      'CAD drawing',
      ': 4 files',
      'Site tags',
      ': 3 files',
      'PDF drawing',
      'Refused for now: the reader of a PDF drawing.',
      'Run pipeline',
    ]) {
      expect(t, want).toContain(want);
    }
    // The refused choice cannot be picked.
    expect(html.match(/role="radio"/g)).toHaveLength(3);
    const radios = html.match(/<button[^>]*role="radio"[^>]*>/g) ?? [];
    expect(radios.filter((b) => b.includes('disabled=""'))).toHaveLength(1);
    // With no pick yet, Run waits for one.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Run pipeline/);
    // Two open choices: no pick made for the person.
    expect(firstPick(DRY)).toBeNull();
    expect(firstPick({ ...DRY, choices: [DRY.choices[1]!, DRY.choices[2]!] })).toBe('site-tags');
  });

  it('Run sends apply with the picked pipeline, and only from a dry run on screen', async () => {
    const shown: RunStep = { step: 'shown', dry: DRY };
    expect(applyBody(shown, 'site-tags')).toEqual({ apply: true, pipeline: 'site-tags' });
    // No dry run on screen, no pick, a refused pick, or a name the answer
    // did not give: nothing to send.
    expect(applyBody({ step: 'asking' }, 'site-tags')).toBeNull();
    expect(applyBody({ step: 'error', message: 'x' }, 'site-tags')).toBeNull();
    expect(applyBody(shown, null)).toBeNull();
    expect(applyBody(shown, 'drawing-pdf')).toBeNull();
    expect(applyBody(shown, 'made-up')).toBeNull();
    // The first call has no apply.
    expect(DRY_RUN_BODY).toEqual({});

    const sent: { path: string; body: PipelineRunBody }[] = [];
    const send = async (path: string, _m: 'POST', body: PipelineRunBody) => {
      sent.push({ path, body });
      return RESULT;
    };
    const target = { kind: 'folder' as const, id: 'f-1' };
    await postRun(target, applyBody(shown, 'site-tags')!, send);
    expect(sent).toEqual([
      { path: '/api/files/folders/f-1/run', body: { apply: true, pipeline: 'site-tags' } },
    ]);
    expect(runPath({ kind: 'file', id: 'a-1' })).toBe('/api/files/files/a-1/run');
  });

  it('the result says queued, not done, with the skip words in plain words', () => {
    const t = text(
      view({ step: 'done', dry: DRY, pipeline: 'site-tags', result: RESULT }, 'site-tags'),
    );
    expect(resultLine(RESULT)).toBe('3 files are queued. 3 were not taken.');
    expect(t).toContain('3 files are queued. 3 were not taken.');
    expect(skipLines(RESULT)).toEqual([
      '2 are in a workspace the pipeline is not attached to',
      '1 has no database yet',
    ]);
    expect(t).toContain('1 has no database yet');
    expect(t).toContain(RUN_QUEUED_NOTE);
    expect(t).not.toContain(RUN_NEXT_LABEL);
    expect(resultLine({ ...RESULT, queued: 1, skipped: { 'no-sha': 1 } })).toBe(
      '1 file is queued. 1 was not taken.',
    );
  });

  it('a busy answer shows no Run button', () => {
    const busy: PipelineRunAnswer = { ...DRY, busy: true };
    const t = text(view({ step: 'shown', dry: busy }, 'site-tags'));
    expect(t).toContain(RUN_BUSY);
    expect(t).not.toContain('Run pipeline');
    expect(applyBody({ step: 'shown', dry: busy }, 'site-tags')).toBeNull();
    // A run that met a busy queue says so, and offers no next.
    const late = { ...RESULT, busy: true, queued: 0, next: 'n-9' };
    const done: RunStep = { step: 'done', dry: DRY, pipeline: 'site-tags', result: late };
    expect(text(view(done))).toContain(RUN_BUSY);
    expect(nextBody(done)).toBeNull();
  });

  it('next shows "Run the next" and sends it as after', () => {
    const cut = { ...RESULT, next: 'n-100' };
    const done: RunStep = { step: 'done', dry: DRY, pipeline: 'site-tags', result: cut };
    expect(text(view(done))).toContain(RUN_NEXT_LABEL);
    expect(RUN_NEXT_LABEL).toBe('Run the next 100');
    expect(nextBody(done)).toEqual({ apply: true, pipeline: 'site-tags', after: 'n-100' });
    expect(nextBody({ step: 'shown', dry: { ...DRY, next: 'n-100' } })).toBeNull();
  });

  it('a 404 hides the entry for the session', async () => {
    expect(showRunEntry(true, runRouteGone())).toBe(true);
    const gone = async () => {
      throw Object.assign(new Error('Not found'), { status: 404 });
    };
    await expect(postRun({ kind: 'file', id: 'a-1' }, DRY_RUN_BODY, gone)).rejects.toThrow();
    expect(runRouteGone()).toBe(true);
    expect(showRunEntry(true, runRouteGone())).toBe(false);
    // Another refusal leaves the entry.
    resetRunRouteGone();
    const refused = async () => {
      throw Object.assign(new Error('No'), { status: 400 });
    };
    await expect(postRun({ kind: 'file', id: 'a-1' }, DRY_RUN_BODY, refused)).rejects.toThrow();
    expect(runRouteGone()).toBe(false);
    // The entry follows the item's own edit right and nothing else.
    expect(showRunEntry(false, false)).toBe(false);
  });
});
