/**
 * The pure layer behind the Files screen: the row shapes, the small format and slug helpers, and the derived-count arithmetic.
 *
 * Moved out of files-client.tsx unchanged (structure pass, phase 1):
 * already standalone, just living in the wrong file. No signatures changed.
 */

import { formatDate } from '@mantle/web-ui/lib/format-datetime';
import type { HitWorkspaceField } from '@mantle/client-types';
import { isItemWorkspaceRefusal } from '@/lib/item-access';
import type { RunTarget } from '@/lib/pipeline-run';

export const FILES_ROOT = 'files';

export type FolderRow = {
  id: string;
  path: string;
  title: string;
  slug: string;
  description: string;
  /** The folder's own indexing flag; null = inherit from ancestors. */
  indexing: 'full' | 'metadata' | null;
  /** The folder's face: an emoji or `lucide:<name>`, and a tint key (the
   *  app-nav vocabulary). Absent from brains that predate folder looks. */
  icon?: string | null;
  color?: string | null;
  childFolderCount: number;
  fileCount: number;
  createdAt: string;
  updatedAt: string;
};

export type FileRow = {
  id: string;
  parentPath: string;
  filename: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  isText: boolean;
  summary: string | null;
  /** Own flag (null = folder chain decides) and the mode the extractor last
   *  actually ran — the badge reads the latter. */
  indexing: 'full' | 'metadata' | null;
  indexingApplied: 'full' | 'metadata' | null;
  createdAt: string;
  updatedAt: string;
};

/** One `/api/search?branch=files` hit — the server's node shape, trimmed to
 *  what the results list renders. `workspace`: where it opens (brain task
 *  f26a516e; absent from a brain before it). */
export type FileSearchHit = HitWorkspaceField & {
  id: string;
  type: string;
  title: string;
  path: string;
  summary: string | null;
  updatedAt: string;
};

export type TextExt = 'md' | 'txt' | 'json';

/** Server-shaped counts of the nodes ingest derived from a file — mirrors
 *  DerivedCounts in @mantle/files (the client bundle can't import it). */
export type DerivedCounts = {
  images: number;
  tables: number;
  pages: number;
  notes: number;
  other: number;
  total: number;
};

/*
 * A file delete's answers (brain F4, the bulk delete's contract in mantle's
 * docs/actors.md). Mirrored here from mantle's
 * packages/client-types/src/dto/file-deletes.ts, which is not published yet.
 * TODO(f4): once the mantle release that carries file-deletes.ts is out,
 * bump the @mantle/client-types pin and import these from it
 * (FileDeleteRefusalReason, BulkDeleteRefusal, BulkDeleteFilesResponse,
 * BulkDeleteCascadeResponse, FileCascadeDeleteResponse), then delete the
 * copies below. Fields new in F4 are optional here: a brain before it does
 * not send them.
 */

/** Why one id of a bulk delete was not deleted. `not_found`: no such file,
 *  or one the login cannot read (the brain never tells the two apart);
 *  `forbidden`: the login reads it but may not delete it (a Moderator of its
 *  workspace may); `in_drawing`: a drawing places it; `attachment`: an email
 *  attachment. */
export type FileDeleteRefusalReason = 'not_found' | 'forbidden' | 'in_drawing' | 'attachment';

/** One id a bulk delete did not delete, and why (never a silent skip). */
export type BulkDeleteRefusal = {
  fileId: string;
  reason: FileDeleteRefusalReason;
  /** On `in_drawing`: the drawings placing it that the login reads. */
  drawings?: Array<{ id: string; title: string }>;
  /** On `in_drawing`: how many more place it that the login cannot read. */
  hiddenDrawings?: number;
};

/** DELETE /api/files/files `{ ids }`. */
export type BulkDeleteResponse = {
  deleted: number;
  /** Files not deleted because ingest derived items from them: confirm,
   *  then send these ids again with `cascade: true`. */
  hasDerived?: Array<{ fileId: string; derived: DerivedCounts }>;
  /** Refusals the user cannot resolve by confirming: surfaced so a blocked
   *  delete is never a silent no-op. */
  refused?: BulkDeleteRefusal[];
};

/** DELETE /api/files/files `{ ids, cascade: true }`. */
export type BulkDeleteCascadeResponse = {
  deleted: number;
  hasDerived?: [];
  /** Derived items deleted, over every file. */
  reapedTotal?: number;
  /** Derived items kept because the login may not delete them (F4). */
  keptTotal?: number;
  /** F4: a cascade also says which ids it did not delete. */
  refused?: BulkDeleteRefusal[];
};

/** DELETE /api/files/files/:id?cascade=1 (not called by this screen yet;
 *  mirrored with the rest of the contract). */
export type FileCascadeDeleteResponse = {
  ok: true;
  reaped: DerivedCounts;
  skipped: number;
  /** Derived items kept because the login may not delete them (F4). */
  kept?: number;
};

/** What the rename dialog is acting on — a file (stem, extension preserved) or
 *  a folder (slug). */
export type RenameTarget =
  | { kind: 'file'; id: string; filename: string; extension: string }
  | { kind: 'folder'; id: string; slug: string };

export function sumDerivedCounts(all: DerivedCounts[]): DerivedCounts {
  const sum: DerivedCounts = { images: 0, tables: 0, pages: 0, notes: 0, other: 0, total: 0 };
  for (const c of all) {
    sum.images += c.images;
    sum.tables += c.tables;
    sum.pages += c.pages;
    sum.notes += c.notes;
    sum.other += c.other;
    sum.total += c.total;
  }
  return sum;
}

/** "34 images, 2 tables and 1 note" — matches the server's phrasing. */
export function describeDerivedCounts(c: DerivedCounts): string {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts: string[] = [];
  if (c.images) parts.push(plural(c.images, 'image', 'images'));
  if (c.tables) parts.push(plural(c.tables, 'table', 'tables'));
  if (c.pages) parts.push(plural(c.pages, 'page', 'pages'));
  if (c.notes) parts.push(plural(c.notes, 'note', 'notes'));
  if (c.other) parts.push(plural(c.other, 'other node', 'other nodes'));
  if (parts.length === 0) return 'nothing';
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]!}`;
}

// ── What a delete says (brain F4) ─────────────────────────────────────────

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "a", "a and b", "a, b and c". */
function andList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]!}`;
}

/** The order the refusals are said in: what the user can act on first. */
const REFUSAL_ORDER: readonly FileDeleteRefusalReason[] = [
  'in_drawing',
  'attachment',
  'forbidden',
  'not_found',
];

/** Where the files of an `in_drawing` refusal are placed: the drawings the
 *  login reads by title, the others as a count (one file) or as "drawings
 *  you cannot open" (several: their counts may overlap). */
function drawingsText(group: readonly BulkDeleteRefusal[]): {
  where: string;
  visible: number;
  hidden: boolean;
} {
  const titles = new Map<string, string>();
  for (const r of group) {
    for (const d of r.drawings ?? []) titles.set(d.id, `"${d.title.trim() || 'Untitled drawing'}"`);
  }
  const hiddenCounts = group.map((r) => r.hiddenDrawings ?? 0);
  const hidden = hiddenCounts.some((n) => n > 0);
  const parts = [...titles.values()];
  if (hidden) {
    parts.push(
      group.length === 1
        ? `${count(hiddenCounts[0]!, 'drawing', 'drawings')} you cannot open`
        : 'drawings you cannot open',
    );
  }
  return { where: parts.length ? andList(parts) : 'a drawing', visible: titles.size, hidden };
}

/** What to do about an `in_drawing` refusal. */
function inDrawingAdvice(visible: number, hidden: boolean, it: string): string {
  if (!hidden) return `Remove ${it} from ${visible > 1 ? 'those drawings' : 'the drawing'} first.`;
  const ask = `ask someone who can open the other drawings to remove ${it} there`;
  return visible > 0
    ? `Remove ${it} from the drawings you can open, and ${ask}.`
    : `${ask.charAt(0).toUpperCase()}${ask.slice(1)}.`;
}

/**
 * Why files of a bulk delete were not deleted, one plain line per reason
 * (brain F4: `not_found`, `forbidden`, `in_drawing`, `attachment`). `nameOf`
 * names a file the screen lists; an id is never shown, nor anything of a
 * drawing the login cannot open but how many there are.
 */
export function refusalMessages(
  refused: readonly BulkDeleteRefusal[],
  nameOf: (fileId: string) => string | undefined = () => undefined,
): string[] {
  const out: string[] = [];
  // A reason this client does not know (a newer brain) is said last, as
  // one group with no why (F4 audit L4): never a silent skip.
  const groups: Array<[FileDeleteRefusalReason | null, BulkDeleteRefusal[]]> = [
    ...REFUSAL_ORDER.map((reason): [FileDeleteRefusalReason, BulkDeleteRefusal[]] => [
      reason,
      refused.filter((r) => r.reason === reason),
    ]),
    [null, refused.filter((r) => !REFUSAL_ORDER.includes(r.reason))],
  ];
  for (const [reason, group] of groups) {
    if (group.length === 0) continue;
    const one = group.length === 1;
    const name = one ? nameOf(group[0]!.fileId) : undefined;
    const subject = one
      ? name
        ? `"${name}" was not deleted`
        : 'One file was not deleted'
      : `${group.length} files were not deleted`;
    const it = one ? 'it' : 'them';
    switch (reason) {
      case 'in_drawing': {
        const { where, visible, hidden } = drawingsText(group);
        out.push(
          `${subject}: ${one ? 'it is' : 'they are'} used in ${where}. ${inDrawingAdvice(visible, hidden, it)}`,
        );
        break;
      }
      case 'attachment':
        out.push(
          `${subject}: ${one ? 'it is an email attachment' : 'they are email attachments'}. Delete ${it} from the email instead.`,
        );
        break;
      case 'forbidden':
        out.push(
          `${subject}: you can open ${it} but not delete ${it}. A Moderator of ${
            one ? 'its' : 'their'
          } workspace can.`,
        );
        break;
      case 'not_found':
        out.push(
          `${subject}: ${one ? 'it was' : 'they were'} not found. ${
            one ? 'It may' : 'They may'
          } already be deleted, or you no longer have access.`,
        );
        break;
      default:
        out.push(`${subject}.`);
    }
  }
  return out;
}

/** What a confirmed cascade says: the success line (null when nothing was
 *  deleted) and, when the brain kept derived items the login may not
 *  delete, how many (brain F4 `keptTotal`). Never "everything" when
 *  anything was kept. `asked`: the ids sent, for a brain that sends no
 *  `deleted`. */
export function cascadeOutcome(
  res: Pick<BulkDeleteCascadeResponse, 'deleted' | 'keptTotal'>,
  asked: number,
): { success: string | null; kept: string | null } {
  const deleted = typeof res.deleted === 'number' ? res.deleted : asked;
  const kept = res.keptTotal ?? 0;
  const files = count(deleted, 'file', 'files');
  return {
    success:
      deleted === 0
        ? null
        : kept > 0
          ? `Deleted ${files} and what was derived from ${deleted === 1 ? 'it' : 'them'} that you can manage`
          : `Deleted ${files} and everything derived from ${deleted === 1 ? 'it' : 'them'}`,
    kept:
      kept > 0
        ? `${count(kept, 'derived item was', 'derived items were')} kept because you cannot manage ${
            kept === 1 ? 'it' : 'them'
          }.`
        : null,
  };
}

/** Normalize a free-typed folder name into a slug (lowercase, dashes). */
/**
 * Folder-slug normaliser — deliberately NOT the shared `@/lib/slugify`.
 *
 * This one *deletes* punctuation ("Q1/Q2" → "q1q2") rather than turning runs of
 * it into a separator ("q1-q2"), and it has no length cap. That's the folder
 * on-disk path convention, and the slug it produces is sent to
 * `/api/files/folders` as the persisted folder identity — so its output is
 * load-bearing and must stay byte-stable. Kept local, and distinct from the
 * shared slugify, precisely so a future "de-dupe" doesn't silently re-slug
 * existing folders. See lib/slugify.ts for the divergence history.
 */
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Outer data-fetch wrapper so the page stays data-free. Fetches the folder
 * tree + the current folder's files from the existing /api/files endpoints,
 * resolves the `?path` param against the tree (falling back to root), and
 * derives the current folder from the tree — no dedicated endpoint needed.
 */
/**
 * Effective indexing mode for a path, resolved from the loaded folder tree the
 * same way the server resolves it at extract time: own flag, else the nearest
 * flagged ancestor, else full. The tree always loads whole, so every ancestor
 * is present — no extra request needed.
 */
export function effectiveFolderIndexing(
  path: string,
  byPath: Map<string, FolderRow>,
): { mode: 'full' | 'metadata'; from: string | null } {
  const segs = path.split('.');
  for (let i = segs.length; i >= 1; i--) {
    const p = segs.slice(0, i).join('.');
    const own = byPath.get(p)?.indexing;
    if (own) return { mode: own, from: p === path ? null : p };
  }
  return { mode: 'full', from: null };
}

export function defaultBodyFor(ext: TextExt): string {
  if (ext === 'md') return '# Untitled\n\nWrite something.\n';
  if (ext === 'json') return '{\n  \n}\n';
  return '';
}

export function fmtSize(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export function fmtRelative(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return formatDate(iso);
}

/**
 * Which dialog the Files screen has open, if any.
 *
 * This was six `useState` — four booleans and two nullable payloads — for a
 * question with one answer. Six independent flags can represent thirty-one
 * states that must never happen (two dialogs at once, a rename target with no
 * rename dialog), and nothing in the type stopped them; keeping them apart was
 * a matter of remembering to. One value cannot be in two states, so the
 * illegal ones stop being unlikely and become unrepresentable.
 *
 * The payloads ride along with the kind that needs them, which also removes
 * the `cascadeConfirm && …` guard every field of that dialog used to carry.
 */
export type FilesDialog =
  | { kind: 'createFolder'; parentPath?: string }
  /** `parentPath`: "New file inside" a tree folder (else the open one). */
  | { kind: 'createFile'; ext: TextExt; parentPath?: string }
  | { kind: 'deleteFolder' }
  /** `ids` from a tree row's Delete; none = the table's selection. */
  | { kind: 'bulkDelete'; ids?: string[] }
  | { kind: 'cascade'; ids: string[]; counts: DerivedCounts }
  | { kind: 'rename'; target: RenameTarget }
  /** Run a pipeline on a tree file or folder (run-pipeline-dialog.tsx). */
  | { kind: 'run'; target: RunTarget }
  | null;

export type FilesDialogKind = NonNullable<FilesDialog>['kind'];

/**
 * Close a dialog, but only if it is still the one on screen.
 *
 * Radix calls `onOpenChange(false)` as it closes, and the bulk-delete flow
 * turns into the cascade confirm from an async handler — so a bare
 * `setDialog(null)` in that callback can arrive AFTER the cascade dialog has
 * opened and wipe it. Today the ordering happens to work (Radix closes on the
 * click, the cascade opens a network round-trip later); this makes it not
 * matter, which is cheaper than depending on it.
 */
export function dismissDialog(current: FilesDialog, kind: FilesDialogKind): FilesDialog {
  return current?.kind === kind ? null : current;
}

/**
 * Where a link that names only a file (`/files?file=<id>`, as /n builds it)
 * goes once the file's detail is loaded: the same file in its own folder,
 * so the list and the tree show where it is. Null when the link already
 * names a folder, or the detail has no folder.
 */
export function fileFolderHref(
  params: Pick<URLSearchParams, 'get' | 'has' | 'toString'>,
  parentPath: string | null | undefined,
): string | null {
  const file = params.get('file');
  if (!file || params.has('path') || !parentPath) return null;
  const next = new URLSearchParams(params.toString());
  next.set('path', parentPath);
  return `/files?${next.toString()}`;
}

/** What a folder's indexing change says when it worked: `requeued` is how
 *  many files the brain queued again (otherwise invisible until the
 *  extractor gets there). */
export function folderIndexingDoneText(
  mode: 'full' | 'metadata' | 'inherit',
  requeued: number,
): string {
  if (mode === 'metadata') {
    return `Content indexing off. Files stay findable by name, type and tags${
      requeued ? ` (${requeued} re-indexing)` : ''
    }.`;
  }
  if (mode === 'full') {
    return `Content indexing on${
      requeued ? `: ${requeued} ${requeued === 1 ? 'file' : 'files'} queued for extraction` : ''
    }.`;
  }
  return 'This folder now follows its parent for indexing.';
}

/** Why an existing folder's indexing switch was refused: the brain asks
 *  for the folder's manage right (a Moderator of its workspace) and
 *  answers 403 item-workspace (F4 audit L7). */
export const FOLDER_INDEXING_MANAGE_TEXT =
  "Only a Moderator of this folder's workspace can change its indexing.";

/** What a failed indexing change says: the workspace refusal in plain
 *  words, else the brain's own, else a fallback. */
export function folderIndexingErrorText(err: unknown): string {
  if (isItemWorkspaceRefusal(err)) return FOLDER_INDEXING_MANAGE_TEXT;
  return err instanceof Error && err.message ? err.message : 'Could not change indexing.';
}
