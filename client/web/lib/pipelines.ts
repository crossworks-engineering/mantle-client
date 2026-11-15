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

import { matchesQuery } from './tool-search';

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
  /** LOCAL COPY of the field mantle pipelines P3-0 adds: why an own
   *  pipeline does not run on this box, in one sentence; null when it runs,
   *  always null for a built-in. An older server sends none: read it
   *  through `problemOf`. Delete this note when the pin moves. */
  problem?: string | null;
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
  /** LOCAL COPY (mantle pipelines P3-1): a draft package to test in place
   *  of the installed one. This screen never sends it. */
  files?: PipelinePackage['files'];
};

/** LOCAL COPY of @mantle/client-types dto/pipelines.ts `PipelinePackageFile`
 *  (mantle branch feat/pipelines-p3-1): text as it is, or binary bytes as
 *  base64. Delete when the pin moves past the release that ships it. */
export type PipelinePackageFile = string | { base64: string };

/** LOCAL COPY of `PipelinePackage` (mantle branch feat/pipelines-p3-1):
 *  path -> file; `pipeline.json` is its manifest. It is also the body of
 *  POST /api/pipelines (`PipelineInstallBody`). Delete when the pin moves. */
export type PipelinePackage = { files: Record<string, PipelinePackageFile> };

/** LOCAL COPY of `PipelineInstallAnswer` (mantle branch
 *  feat/pipelines-p3-1): the answer of an install or a remove; `row` is
 *  null after a remove. Delete when the pin moves. */
export type PipelineInstallAnswer = { row: PipelineRow | null; note: string };

/** The answer of GET /api/pipelines/:id/package (mantle branch
 *  feat/pipelines-p3-1, `pipelinePackage`): the package with its id and
 *  version. Delete when the pin moves past a release that types it. */
export type PipelinePackageAnswer = { id: string; version: string | null } & PipelinePackage;

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

/**
 * The search of the list: the name, the id, the role word ("reader" finds
 * the readers, "transformer" the `after` ones), the extensions and the
 * description, case-insensitive; every word must hit. A phase 1 row has no
 * role. The list arrives whole, so this filters the loaded rows.
 */
export function filterPipelines<T extends PipelineRowV1>(rows: readonly T[], query: string): T[] {
  if (!query.trim()) return [...rows];
  return rows.filter((r) =>
    matchesQuery(
      [
        r.name,
        r.id,
        'kind' in r ? roleWord((r as { kind?: string }).kind) : null,
        readsText(r.reads),
        statsOf(r)?.description,
      ],
      query,
    ),
  );
}

/** A cell of a test's first rows, as text. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

// ---------------------------------------------------------------------------
// Own pipelines (mantle docs/pipelines.md, "Own pipelines"): an Admin adds a
// package from a folder (POST /api/pipelines), downloads it
// (GET /api/pipelines/:id/package) and removes it (DELETE
// /api/pipelines/:id). The brain checks the package; the client reads the
// folder, says the caps before the send, and never runs or renders a file.

/** The manifest of a package, always text. */
export const PIPELINE_MANIFEST_FILE = 'pipeline.json';

/** The caps of one package, as the brain holds them (mantle
 *  PIPELINE_PACKAGE_FILES_MAX and PIPELINE_PACKAGE_MAX_BYTES, all files as
 *  bytes on disk). Said before the send; the brain checks them again. */
export const PACKAGE_FILES_MAX = 200;
export const PACKAGE_MAX_BYTES = 5 * 1024 * 1024;

/** The one line of the Add dialog (text, not a confirm). */
export const INSTALL_LINE =
  'This runs code on files of this box. You install it as you would a library.';

/** What an install says on a brain before own pipelines (404 or 405). */
export const CANNOT_ADD = 'This box cannot add pipelines yet.';

/** The brain's problem of an own row whose files are not on disk (mantle
 *  NOT_ON_DISK): the one problem the screen offers a button for. */
export const NOT_ON_DISK =
  'The files of this package are not on disk. Install it again with the same files.';

/** Finder's own file in a folder on a Mac: left out of a package, and said. */
const FINDER_FILE = '.DS_Store';

/** One file of a picked folder: its path as the browser gives it (the
 *  folder's own name first), and its bytes, or null when it could not be
 *  read. */
export type PickedFile = { path: string; bytes: Uint8Array | null };

/** What the dialog shows of `pipeline.json`. */
export type ManifestFacts = {
  id: string;
  name: string;
  version: string;
  reads: string[];
  /** The role word: Reader, Router, Transformer. */
  role: string;
};

export type PackageRead = {
  pkg: PipelinePackage;
  /** The files in the package, and their bytes. */
  count: number;
  bytes: number;
  /** Null when there is no `pipeline.json` or it is not JSON: the brain
   *  says why when it is sent. */
  manifest: ManifestFacts | null;
  /** What stops the send, one sentence each. Empty: it can be sent. */
  problems: string[];
  /** The files left out, said in the dialog. */
  leftOut: string[];
};

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** Bytes as base64, in chunks (a large file would overflow one call). */
export function base64Of(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

/** A file as the package holds it: valid UTF-8 with no NUL is text, as it
 *  is (a BOM and CRLF kept); anything else is `{ base64 }` (the brain
 *  refuses a text file that holds a NUL). */
export function packageFileOf(bytes: Uint8Array): PipelinePackageFile {
  try {
    const text = utf8.decode(bytes);
    if (!text.includes('\u0000')) return text;
  } catch {
    // Not UTF-8: base64, below.
  }
  return { base64: base64Of(bytes) };
}

/** A size as the dialog says it. */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The facts of a manifest's text, or null when it is not a JSON object. */
export function manifestFacts(text: string): ManifestFacts | null {
  let m: unknown;
  try {
    m = JSON.parse(text);
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  const o = m as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const match = (o.match && typeof o.match === 'object' ? o.match : {}) as Record<string, unknown>;
  const ext = Array.isArray(match.ext) ? match.ext.filter((e) => typeof e === 'string') : [];
  return {
    id: str(o.id),
    name: str(o.name),
    version: str(o.version),
    reads: ext as string[],
    role: roleWord(o.router === true ? 'router' : match.after ? 'after' : 'reader'),
  };
}

/**
 * A picked folder as a package: each path without the folder's own name;
 * a text file as text, any other as base64. A file that could not be read,
 * and a folder over the caps, are problems, said before the send.
 */
export function readPackage(picked: readonly PickedFile[]): PackageRead {
  const files: Record<string, PipelinePackageFile> = {};
  const problems: string[] = [];
  const leftOut: string[] = [];
  const unread: string[] = [];
  let bytes = 0;
  for (const f of picked) {
    const path = f.path.includes('/') ? f.path.slice(f.path.indexOf('/') + 1) : f.path;
    if (path === FINDER_FILE || path.endsWith(`/${FINDER_FILE}`)) {
      leftOut.push(path);
      continue;
    }
    if (f.bytes === null) {
      unread.push(path);
      continue;
    }
    bytes += f.bytes.length;
    files[path] = packageFileOf(f.bytes);
  }
  const count = Object.keys(files).length + unread.length;
  if (count === 0) problems.push('The folder has no files.');
  if (unread.length > 0) {
    problems.push(
      `${unread.length === 1 ? 'A file' : `${unread.length} files`} could not be read: ${unread.join(', ')}.`,
    );
  }
  if (count > PACKAGE_FILES_MAX) {
    problems.push(`A package has at most ${PACKAGE_FILES_MAX} files; this folder has ${count}.`);
  }
  if (bytes > PACKAGE_MAX_BYTES) {
    problems.push(
      `A package is at most ${sizeText(PACKAGE_MAX_BYTES)} of files; this folder has ${sizeText(bytes)}, ${bytes - PACKAGE_MAX_BYTES} B over.`,
    );
  }
  const text = files[PIPELINE_MANIFEST_FILE];
  return {
    pkg: { files },
    count,
    bytes,
    manifest: typeof text === 'string' ? manifestFacts(text) : null,
    problems,
    leftOut,
  };
}

/** What an install does to the own pipeline of the same id, or null for a
 *  new id (a built-in's id is refused by the brain, with its sentence). No
 *  version rule here: the brain refuses a lower version, or the same
 *  version with other files, with its own sentence. */
export function replacesText(
  rows: readonly PipelineRowV1[],
  manifest: Pick<ManifestFacts, 'id' | 'version'>,
): string | null {
  const row = rows.find((r) => r.id === manifest.id && r.source === 'own');
  if (!row) return null;
  return `${row.version ? `Version ${row.version}` : 'A version'} is installed: a higher version replaces it; the same version with the same files writes its folder again.`;
}

/** The file name a downloaded package is saved under. */
export function packageFileName(id: string, version: string | null): string {
  const safe = (s: string) => s.replace(/[^\w.-]+/g, '_');
  return version ? `${safe(id)}-${safe(version)}.json` : `${safe(id)}.json`;
}

/** Is it an own pipeline (Download, Remove, the Own pill)? */
export const isOwn = (row: PipelineRowV1) => row.source === 'own';

/** The problem of a row, or null: it runs. An older server sends none. */
export function problemOf(row: PipelineRowV1): string | null {
  const p = (row as { problem?: unknown }).problem;
  return typeof p === 'string' && p.trim() ? p : null;
}

/** Does the problem have its one act, "Write the files again"? */
export const canWriteAgain = (problem: string | null) => problem === NOT_ON_DISK;

/** The sentence of a refused install: the brain's own, or, on a brain
 *  before own pipelines (no POST: 404 or 405), CANNOT_ADD. */
export function addRefusedText(err: unknown): string {
  const status = (err as { status?: unknown } | null)?.status;
  if (status === 404 || status === 405) return CANNOT_ADD;
  return err instanceof Error ? err.message : String(err);
}
