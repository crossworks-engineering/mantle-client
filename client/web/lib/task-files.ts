/**
 * Files on tasks (2026-11-09): screenshots, logs and PDFs a person puts on a
 * task. Pure checks, split from the screen so they can be unit-tested: what
 * a task file may be, and which of a picked, dropped or pasted batch can go
 * up before a byte is sent.
 *
 * The type, the caps and the helpers mirror the brain's
 * `@mantle/client-types/task-files` (and `TaskFile` in its dto/rows.ts).
 * The pinned contract package predates them, so they live here until the
 * pin bump that carries them; then import them from there and keep only the
 * client's own helpers below.
 */

import { decideComposerPaste, type PasteDecision, type PastedFileLike } from './composer-paste';
import { formatBytes } from './upload-progress';

/** One file on a task, as `GET /api/tasks/:id` lists it in `task.files`. */
export type TaskFile = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};

/** 10 MB per file. */
export const TASK_FILE_MAX_BYTES = 10 * 1024 * 1024;
/** 5 files per task. */
export const TASK_FILES_MAX = 5;
/** Extensions a task file may have. No svg or html: they can carry script. */
export const TASK_FILE_EXTS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'pdf',
  'txt',
  'log',
  'md',
  'json',
  'csv',
] as const;

/** The lower-case extension of `filename`, or '' when it has none. */
export function taskFileExt(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

/** May a file of this name be put on a task? */
export function isTaskFileType(filename: string): boolean {
  return (TASK_FILE_EXTS as readonly string[]).includes(taskFileExt(filename));
}

// ─── Client helpers ─────────────────────────────────────────────────────────

/** The attach button's `accept` list. */
export const TASK_FILE_ACCEPT = TASK_FILE_EXTS.map((e) => `.${e}`).join(',');

/** The types in words, for a refusal. */
export const TASK_FILE_TYPES_TEXT = 'PNG, JPG, GIF, WebP, PDF, TXT, LOG, MD, JSON or CSV';

/** Image types a pasted picture may arrive as with no usable name. */
const IMAGE_EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/** What a paste may carry: the extensions, plus the image types a nameless
 *  pasted picture is known by (`taskFileName` names it before upload). */
export const TASK_PASTE_ACCEPT = [TASK_FILE_ACCEPT, ...Object.keys(IMAGE_EXT_BY_MIME)].join(',');

/**
 * The name a file goes up under. The brain checks the extension, and a
 * pasted picture can arrive named `image` or with no name at all: such a file
 * of a known image type gets that type's extension. Any other name is kept.
 */
export function taskFileName(file: PastedFileLike): string {
  if (isTaskFileType(file.name)) return file.name;
  const ext = IMAGE_EXT_BY_MIME[file.type.toLowerCase()];
  if (!ext) return file.name;
  const base = file.name.trim() || 'pasted-image';
  return `${base}.${ext}`;
}

/** The slice of a File the check needs (so tests need no DOM `File`). */
export type TaskUploadLike = PastedFileLike & { size: number };

/**
 * Which files of a batch may go up, and why the others may not. `existing`
 * is how many files the task holds now. Files are taken in order until the
 * task is full. Each refusal names the file and the cap it hit.
 */
export function checkTaskUploads<F extends TaskUploadLike>(
  files: readonly F[],
  existing: number,
): { accepted: F[]; refused: string[] } {
  const accepted: F[] = [];
  const refused: string[] = [];
  let over = 0;
  for (const f of files) {
    const name = taskFileName(f) || 'That file';
    if (!isTaskFileType(name)) {
      refused.push(`${name} can't go on a task. Use ${TASK_FILE_TYPES_TEXT}.`);
    } else if (f.size === 0) {
      refused.push(`${name} is empty.`);
    } else if (f.size > TASK_FILE_MAX_BYTES) {
      refused.push(
        `${name} is over the ${formatBytes(TASK_FILE_MAX_BYTES)} limit for a task file.`,
      );
    } else if (existing + accepted.length >= TASK_FILES_MAX) {
      over += 1;
    } else {
      accepted.push(f);
    }
  }
  if (over > 0) {
    refused.push(
      `A task holds ${TASK_FILES_MAX} files. ${over === 1 ? '1 file was' : `${over} files were`} not added.`,
    );
  }
  return { accepted, refused };
}

/**
 * Decide what a paste on the task detail means: the composer's decision
 * (lib/composer-paste: the Finder filename and rich-text traps) with the
 * task's types, and a refusal in the task's words.
 */
export function decideTaskPaste<F extends PastedFileLike>(
  types: readonly string[],
  files: readonly F[],
): PasteDecision<F> {
  const d = decideComposerPaste(types, files, TASK_PASTE_ACCEPT);
  if (d.kind !== 'reject') return d;
  const first = files[0];
  const label = first?.name || first?.type || 'That file';
  return { kind: 'reject', reason: `${label} can't go on a task. Use ${TASK_FILE_TYPES_TEXT}.` };
}
