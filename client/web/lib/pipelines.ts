/**
 * Settings > Pipelines: the readers that make a file's database, and the
 * Transformers (`after` in the data) that add tabs to it (mantle
 * docs/pipelines.md). The brain
 * answers GET /api/pipelines for an Admin with the settings area; another
 * login gets 403, and a brain before pipelines gives 404. A phase 1 brain
 * gives rows with no `kind`: the screen shows them read only. A phase 2
 * brain takes PATCH /api/pipelines/:id (options, the off list) and
 * POST /api/pipelines/:id/test. A router row (`kind: 'router'`) names the
 * kind of a file; it is read only, as is a kind word this client does not
 * know (`canChange`). Pure helpers only: no DOM here.
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
  /** A later server may add a word: `canChange` is the one rule for it. */
  kind: PipelineKind | (string & {});
  /** Kept for older clients: always 'all' since the off list (mantle,
   *  pipelines WO). Read `offInOf`, never this. */
  workspaces: 'all' | string[];
  /** LOCAL COPY of the field mantle pipelines WO adds: the ids of the
   *  workspaces the pipeline is off in; [] for a router, always. A server
   *  before WO sends none: read it through `offInOf`. Make it required (and
   *  delete this note) when the contract pin moves past the release that
   *  ships it. */
  offIn?: string[];
  /** For an `after` pipeline: the shape it reads. Null for a reader. */
  after: string | null;
  /** The tabs an `after` pipeline writes. */
  tabs: string[];
  options: PipelineOption[];
  /** A router: the kinds it can name (mantle branch feat/router-2r). An
   *  older server sends none: read it through `nameLines`. */
  names?: PipelineName[];
  /** A reader: the kinds it claims from a router; [] for most. An older
   *  server sends none: read it through `claimsText`. */
  claims?: string[];
};

/** The kind words this client knows. */
export type PipelineKind = 'reader' | 'after' | 'router';

/** A kind a router can name. `decider`: named only by the decider's answer. */
export type PipelineName = { kind: string; decider?: boolean };

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
  /** Kept in the type; the server refuses it since WO. Never sent. */
  workspaces?: string[];
  /** LOCAL COPY (mantle pipelines WO): replaces the off list; [] is on in
   *  every workspace. A router refuses it. */
  offIn?: string[];
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

/** A router has no off switch: it runs where its readers run. */
export const ROUTER_WORKSPACES = 'A router is used wherever its readers are.';

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

/**
 * The one rule of what a row can do: a reader and an `after` pipeline have
 * options, an off switch per workspace, a test and a re-read. A router, and a kind word this
 * client does not know, are read only: the screen shows them and offers
 * nothing to press but the name.
 */
export function canChange(row: PipelineRow): boolean {
  return row.kind === 'reader' || row.kind === 'after';
}

/**
 * The role names a person reads, in one place: Router, Reader, Transformer
 * and Agent. The key is the server's `kind` word, and the data does not
 * change: a Transformer is `after` there. No brain sends `agent` yet.
 */
export const ROLE_WORDS: Readonly<Record<string, string>> = {
  router: 'Router',
  reader: 'Reader',
  after: 'Transformer',
  agent: 'Agent',
};

/** The role of a row in one word. An unknown word is shown as the server
 *  gives it, with a capital. */
export function roleWord(kind: string | undefined): string {
  if (!kind) return '-';
  return Object.hasOwn(ROLE_WORDS, kind)
    ? ROLE_WORDS[kind]!
    : kind[0]!.toUpperCase() + kind.slice(1);
}

/** The role of a row as the detail says it: the role word, and for a
 *  Transformer the shape it reads. */
export function kindText(row: PipelineRow): string {
  const role = roleWord(row.kind);
  return row.kind === 'after' ? `${role}, on ${row.after ?? '-'}` : role;
}

/** The list's "Used in" cell: "Off in N" when it is off somewhere, else
 *  every workspace; or the kind word of a row with no off switch (a router,
 *  an unknown kind). */
export function usedInText(row: PipelineRow): string {
  if (!canChange(row)) return kindText(row);
  const n = offInOf(row).length;
  return n > 0 ? `Off in ${n}` : 'Every workspace';
}

/** The kinds a router can name, one line each. Empty when the server sent
 *  none. */
export function nameLines(row: PipelineRow): string[] {
  const names = Array.isArray(row.names) ? row.names : [];
  return names.map((n) => (n.decider ? `${n.kind} (only by the decider's answer)` : n.kind));
}

/** One line of the kinds a reader claims, or null when it claims none (or
 *  the server sent none). */
export function claimsText(row: PipelineRow): string | null {
  const claims = Array.isArray(row.claims) ? row.claims : [];
  if (claims.length === 0) return null;
  return `Reads a file only when the router names one of these kinds: ${claims.join(', ')}.`;
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

/** The workspaces a pipeline is off in. A server before WO sends no
 *  `offIn`: that is on everywhere. */
export function offInOf(row: PipelineRow): string[] {
  return Array.isArray(row.offIn) ? row.offIn : [];
}

/** The summary line of the workspaces part. */
export function offText(n: number): string {
  if (n === 0) return 'On in every workspace';
  return n === 1 ? 'Off in 1 workspace' : `Off in ${countText(n)} workspaces`;
}

/** The off list after the switches of the shown workspaces moved: a shown
 *  one is off when its switch is off; an id not shown (a deleted workspace,
 *  or the list not loaded) stays as it was. */
export function offFromOn(
  off: readonly string[],
  shown: readonly string[],
  on: readonly string[],
): string[] {
  return [...off.filter((id) => !shown.includes(id)), ...shown.filter((id) => !on.includes(id))];
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

/** The body of a Save: the changed options, and the off list when it
 *  moved. Null when nothing changed. Never `workspaces`: the server refuses
 *  it. */
export function setBody(
  row: PipelineRow,
  form: Readonly<Record<string, unknown>>,
  off: readonly string[],
): PipelineSetBody | null {
  const body: PipelineSetBody = {};
  const options = changedOptions(row, form);
  if (Object.keys(options).length > 0) body.options = options;
  if (!same([...offInOf(row)].sort(), [...off].sort())) body.offIn = [...off];
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
