/**
 * Settings > Pipelines: the readers that make a file's database (mantle
 * docs/pipelines.md). The brain answers GET /api/pipelines for an Admin with
 * the settings area; another login gets 403, and a brain before pipelines
 * gives 404. In phase 1 the list is read only: no button writes, and every
 * pipeline is on. Pure helpers only: no DOM here.
 */

/**
 * LOCAL COPY of @mantle/client-types dto/pipelines.ts `PipelineRow` and
 * `PipelineList` (mantle, pipelines phase 1). Declared here until the
 * contract pin moves past the release that ships them; then import them and
 * delete these.
 */
export type PipelineRow = {
  id: string;
  name: string;
  version: string;
  source: 'builtin' | 'curated' | 'own';
  start: 'upload' | 'demand';
  /** The file extensions it reads. */
  reads: string[];
  weight: 'light' | 'heavy';
  shapes: string[];
  workers: string[];
  tools: string[];
  /** Files with a database of this pipeline; null when not counted. */
  files: number | null;
  /** Of those, read at an older version or before stamps. */
  older: number | null;
};

export type PipelineList = {
  api: number;
  pipelines: PipelineRow[];
  /** The scan stopped at its cap: the counts are of the first files only. */
  countsPartial: boolean;
};

export const PIPELINES_PATH = '/api/pipelines';

/** What a brain before pipelines (404) gets instead of the list. */
export const PIPELINES_TOO_OLD = 'This box does not list its pipelines yet.';

/** What the screen says when the counts stopped at the brain's cap. */
export const COUNTS_PARTIAL = 'The counts are partial: the box stopped counting at its limit.';

/** The state of a pipeline. Phase 1 has no switch, so it is always on. */
export const PIPELINE_STATE = 'On';

/** A count as the screen shows it: a dash when the brain did not count. */
export function countText(n: number | null): string {
  return n === null ? '-' : n.toLocaleString('en-US');
}

/** The extensions a pipeline reads, as one short line. */
export function readsText(reads: readonly string[]): string {
  return reads.map((e) => `.${e}`).join(', ');
}

/** "N files were read by an older version", or null when there are none
 *  (or the brain did not count them). */
export function olderText(older: number | null): string | null {
  if (older === null || older === 0) return null;
  return older === 1
    ? '1 file was read by an older version'
    : `${countText(older)} files were read by an older version`;
}
