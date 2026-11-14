/**
 * Settings > Pipelines: the readers that make a file's database, and the
 * `after` pipelines that add tabs to it (mantle docs/pipelines.md). The brain
 * answers GET /api/pipelines for an Admin with the settings area; another
 * login gets 403, and a brain before pipelines gives 404. A phase 1 brain
 * gives rows with no `kind`: the screen shows them read only. A phase 2
 * brain takes PATCH /api/pipelines/:id (options, workspaces) and
 * POST /api/pipelines/:id/test. Pure helpers only: no DOM here.
 */

/**
 * LOCAL COPY of @mantle/client-types dto/pipelines.ts `PipelineOptionSpec`
 * (mantle branch feat/pipelines-2). Delete when the contract pin moves past
 * the release that ships it.
 */
export type PipelineOptionSpec =
  | { type: 'number'; label: string; help?: string; default: number; min: number; max: number }
  | { type: 'bool'; label: string; help?: string; default: boolean }
  | {
      type: 'words';
      label: string;
      help?: string;
      default: readonly string[];
      maxItems: number;
      maxChars: number;
    };

/**
 * LOCAL COPY of the phase 1 fields of @mantle/client-types dto/pipelines.ts
 * `PipelineRow` (mantle, pipelines phase 1). A phase 1 brain gives only
 * these. Delete when the contract pin moves past the release that ships
 * `PipelineRow`.
 */
export type PipelineRowV1 = {
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
  /** Of those, read at an older version, before stamps, or with other options. */
  older: number | null;
};

/**
 * LOCAL COPY of @mantle/client-types dto/pipelines.ts `PipelineRow` (mantle
 * branch feat/pipelines-2): the phase 1 fields and the state of phase 2.
 * Delete when the contract pin moves past the release that ships it.
 */
export type PipelineRow = PipelineRowV1 & {
  kind: 'reader' | 'after';
  /** 'all' (a reader), or the ids of the workspaces it is attached to. */
  workspaces: 'all' | string[];
  /** For an `after` pipeline: the shape it reads. Null for a reader. */
  after: string | null;
  /** The tabs an `after` pipeline writes. */
  tabs: string[];
  options: PipelineOption[];
};

export type PipelineOption = { name: string; spec: PipelineOptionSpec; value: unknown };

/**
 * LOCAL COPY of @mantle/client-types dto/pipelines.ts `PipelineVersionCount`
 * (mantle branch feat/pipelines-2-m8). `version` null: read before versions
 * were recorded. Delete when the contract pin moves past the release that
 * ships it.
 */
export type PipelineVersionCount = { version: string | null; files: number };

/**
 * LOCAL COPY of the fields M8 adds to @mantle/client-types dto/pipelines.ts
 * `PipelineRow` (mantle branch feat/pipelines-2-m8). A server before M8
 * sends none of them: read them through `statsOf`. Delete when the contract
 * pin moves past the release that ships them.
 */
export type PipelineStats = {
  /** What it reads and what it writes, in one or two plain sentences. */
  description: string;
  /** `files` by the version in their stamp, highest first; null last. */
  versions: PipelineVersionCount[];
  /** Its writes into a file's database on this box; null when not read. */
  runs: number | null;
  /** When it last wrote, as an ISO time; null before its first run. */
  lastRunAt: string | null;
};

/**
 * LOCAL COPY of @mantle/client-types dto/pipelines.ts `PipelineList`. Its
 * rows are phase 1 rows until `hasState` says they carry `kind`.
 */
export type PipelineList = {
  api: number;
  pipelines: PipelineRowV1[];
  /** The scan stopped at its cap: the counts are of the first files only. */
  countsPartial: boolean;
};

/** LOCAL COPY of @mantle/client-types dto/pipelines.ts `PipelineSetBody`
 *  (mantle branch feat/pipelines-2). Delete when the pin moves. */
export type PipelineSetBody = {
  options?: Record<string, unknown>;
  workspaces?: string[];
};

/** LOCAL COPY of @mantle/client-types dto/pipelines.ts `PipelineTestBody`
 *  (mantle branch feat/pipelines-2-m4). Delete when the pin moves. */
export type PipelineTestBody = {
  fileId: string;
  options?: Record<string, unknown>;
};

/** LOCAL COPY of @mantle/client-types dto/pipelines.ts `PipelineTestResult`
 *  (mantle branch feat/pipelines-2-m4). Delete when the pin moves. */
export type PipelineTestResult = {
  status: 'ok' | 'not_mine' | 'unsure' | 'failed' | 'busy';
  pipeline: string;
  version: string;
  ms: number;
  tabs: { name: string; rows: number; columns: string[]; first: unknown[][] }[];
  shapes: string[];
  warnings: string[];
  writes: string[];
  word: 'no-database' | 'no-match' | 'too-large' | 'unreadable' | 'no-rows' | null;
};

export const PIPELINES_PATH = '/api/pipelines';

/** One pipeline's route: PATCH sets it, `/test` tests it. */
export const pipelinePath = (id: string) => `${PIPELINES_PATH}/${encodeURIComponent(id)}`;

/** What a brain before pipelines (404) gets instead of the list. */
export const PIPELINES_TOO_OLD = 'This box does not list its pipelines yet.';

/** What the screen says when the counts stopped at the brain's cap. */
export const COUNTS_PARTIAL = 'The counts are partial: the box stopped counting at its limit.';

/** The state of a pipeline on a phase 1 brain: it has no switch, so it is on. */
export const PIPELINE_STATE = 'On';

/** A reader is used in every workspace: no ticks. */
export const READER_EVERYWHERE = 'Used in every workspace.';

/** An `after` pipeline with no tick. */
export const ATTACHED_NONE = 'Attached to no workspace. It does nothing.';

/** Under every test result. */
export const NOTHING_WRITTEN = 'Nothing was written.';

/** A test the parser had no slot for. It is no failure. */
export const TEST_BUSY = 'The reader is busy. Try again.';

/** The M8 fields of a row, or null for a server before M8 (a row with no
 *  `versions`): that one shows none of them. */
export function statsOf(row: PipelineRowV1): PipelineStats | null {
  const r = row as PipelineRowV1 & Partial<PipelineStats>;
  if (!Array.isArray(r.versions)) return null;
  return {
    description: typeof r.description === 'string' ? r.description : '',
    versions: r.versions,
    runs: r.runs ?? null,
    lastRunAt: r.lastRunAt ?? null,
  };
}

/** One line for each version count. "current" is the row's own `version`;
 *  every other line is "older". The client holds no version rule. */
export function versionLines(version: string, versions: readonly PipelineVersionCount[]): string[] {
  return versions.map((v) => {
    const files = v.files === 1 ? '1 file' : `${countText(v.files)} files`;
    if (v.version === null) return `${files} read before versions were recorded`;
    return `${files} read with ${v.version} (${v.version === version ? 'current' : 'older'})`;
  });
}

/** What the screen says of a pipeline that never ran. */
export const NO_RUN_YET = 'No run yet.';

/** True when the pipeline never ran: no count above 0 and no last run. */
export function neverRan(stats: Pick<PipelineStats, 'runs' | 'lastRunAt'>): boolean {
  return !stats.runs && stats.lastRunAt === null;
}

/** The label of the re-read button, or null when there is nothing older. */
export function rereadLabel(older: number | null): string | null {
  if (older === null || older <= 0) return null;
  return older === 1
    ? 'Read the 1 older file again'
    : `Read the ${countText(older)} older files again`;
}

/** The rows of a phase 2 brain, or null for a phase 1 brain (a row with no
 *  `kind`): that one gets the read-only list. */
export function hasState(list: PipelineList): PipelineRow[] | null {
  const rows = list.pipelines;
  return rows.every((r) => 'kind' in r) ? (rows as PipelineRow[]) : null;
}

/** A count as the screen shows it: a dash when the brain did not count. */
export function countText(n: number | null): string {
  return n === null ? '-' : n.toLocaleString('en-US');
}

/** The extensions a pipeline reads, as one short line. */
export function readsText(reads: readonly string[]): string {
  return reads.map((e) => `.${e}`).join(', ');
}

/** "N files were read by an older version or with other options", or null
 *  when there are none (or the brain did not count them). */
export function olderText(older: number | null): string | null {
  if (older === null || older === 0) return null;
  return older === 1
    ? '1 file was read by an older version or with other options'
    : `${countText(older)} files were read by an older version or with other options`;
}

/** Where a phase 2 pipeline is used, as the list's State cell says it. */
export function attachText(row: PipelineRow): string {
  if (row.workspaces === 'all') return 'Every workspace';
  const n = row.workspaces.length;
  if (n === 0) return 'No workspace';
  return n === 1 ? '1 workspace' : `${n} workspaces`;
}

/** The form's first values: the value in force of each option. */
export function optionValues(row: PipelineRow): Record<string, unknown> {
  return Object.fromEntries(row.options.map((o) => [o.name, o.value]));
}

const same = (a: unknown, b: unknown) =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((x, i) => x === b[i])
    : a === b;

/** The options the form changed, by name: what Save sends. Empty when none. */
export function changedOptions(
  row: PipelineRow,
  form: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const o of row.options) {
    if (o.name in form && !same(form[o.name], o.value)) out[o.name] = form[o.name];
  }
  return out;
}

/** The body of a Save: the changed options, and the ticks when they moved.
 *  Null when nothing changed. A reader never sends `workspaces`. */
export function setBody(
  row: PipelineRow,
  form: Readonly<Record<string, unknown>>,
  ticks: readonly string[] | null,
): PipelineSetBody | null {
  const body: PipelineSetBody = {};
  const options = changedOptions(row, form);
  if (Object.keys(options).length > 0) body.options = options;
  if (ticks && row.workspaces !== 'all') {
    const was = [...row.workspaces].sort();
    const now = [...ticks].sort();
    if (!same(was, now)) body.workspaces = [...ticks];
  }
  return Object.keys(body).length > 0 ? body : null;
}

/** The row a Save answers, with the list's counts kept: the PATCH answer
 *  has `files` and `older` null, and (M8) no versions and no runs. */
export function keepCounts(saved: PipelineRow, was: PipelineRowV1): PipelineRow {
  const stats = statsOf(was);
  return {
    ...saved,
    files: was.files,
    older: was.older,
    ...(stats ? { versions: stats.versions, runs: stats.runs, lastRunAt: stats.lastRunAt } : {}),
  };
}

/** A word of a `words` option as the form keeps it: upper case, as the
 *  brain stores it. */
export const wordOf = (raw: string) => raw.trim().toUpperCase();

/** The status line of a test. */
export function testStatusText(r: PipelineTestResult): string {
  switch (r.status) {
    case 'ok':
      return 'Read';
    case 'not_mine':
      return 'This pipeline does not take this file';
    case 'unsure':
      return 'The rules left this PDF unsure; no model was asked';
    case 'failed':
      return 'Failed';
    case 'busy':
      return TEST_BUSY;
  }
}

/** Does this pipeline take a file of this name? By its extension, as the
 *  brain matches it; the test picker lists these files only. */
export function takesFile(row: PipelineRowV1, name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot > 0 && row.reads.includes(name.slice(dot + 1).toLowerCase());
}

/** A cell of a test's first rows, as text. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}
