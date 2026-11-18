/**
 * File history on the client (brain contract P3): the shapes of the history
 * routes, the history sheet's rows, and what each refusal says. Free of
 * React so it can be unit-tested.
 *
 * A file keeps its earlier versions when new bytes replace it (an upload
 * with Override, a restore). Reading the list and downloading a version is
 * for whoever reads the file; restore and delete only when the brain says
 * `rights.mayRestore` (an Admin, or a Moderator of the file's workspace or
 * of a workspace that holds it). The brain checks again.
 *
 * A brain from before file history sends no `versions` on its rows (no
 * mark, no History entry) and answers the history route 404.
 */
import { ApiError } from '@mantle/web-ui/api-fetch';
import type { TreeItem } from '@mantle/web-ui/types/tree';
import { formatBytes } from './upload-progress';

/** One kept version, newest first in a list. */
export type FileVersion = {
  id: string;
  /** v1, v2 ... per file, never reused. */
  seq: number;
  /** `replace`: new bytes replaced it. `pre_restore`: a restore did. */
  trigger: 'replace' | 'pre_restore' | (string & {});
  /** When these bytes stopped being the file's (ISO). */
  createdAt: string;
  sizeBytes: number;
  sha256: string | null;
  /** The file's name when these bytes were its. */
  filename: string | null;
  /** Who replaced them. */
  actor: string;
  /** A `pre_restore` version: the seq the restore put back. */
  restoredFrom: number | null;
};

export type FileHistoryResponse = {
  versions: FileVersion[];
  rights: { mayRestore: boolean };
};

/** The file a history sheet is about, as a list row or the open file has it. */
export type HistoryFile = {
  id: string;
  filename: string;
  sizeBytes?: number;
  createdAt?: string;
  updatedAt?: string;
  replacedAt?: string;
};

export const historyPath = (fileId: string) => `/api/files/files/${fileId}/history`;
export const versionPath = (fileId: string, versionId: string) =>
  `${historyPath(fileId)}/${versionId}`;
export const versionDownloadPath = (fileId: string, versionId: string) =>
  `${versionPath(fileId, versionId)}/download`;

/** The history query's key, under the Files views' own ['files'] key, so
 *  the Files refresh asks it again too. */
export const historyKey = (fileId: string) => ['files', 'history', fileId] as const;

/** A tree row's version count (the brain's TreeItem.versions, files only);
 *  undefined from a brain before file history. */
export function treeItemVersions(item: TreeItem): number | undefined {
  const v = (item as TreeItem & { versions?: unknown }).versions;
  return typeof v === 'number' ? v : undefined;
}

/** Whether a row carries a history mark: one or more earlier versions. */
export function hasHistory(versions: number | undefined): versions is number {
  return typeof versions === 'number' && versions > 0;
}

/** The mark's tooltip. */
export function historyMarkLabel(versions: number): string {
  return `${versions} earlier version${versions === 1 ? '' : 's'}`;
}

const ACTOR_LABEL: Record<string, string> = {
  owner: 'you',
  member: 'a team member',
  agent: 'the assistant',
  mcp: 'an MCP client',
  system: 'MantleOS',
};

export function actorLabel(actor: string): string {
  return ACTOR_LABEL[actor] ?? actor;
}

/** One line of the history sheet. */
export type HistoryRow = {
  key: string;
  /** "Current" or "v3". */
  label: string;
  /** The version, or null for the current file. */
  version: FileVersion | null;
  /** What happened, in words: "Replaced by you", "Kept by restoring v2". */
  title: string;
  /** When (ISO), or null when not known. */
  at: string | null;
  size: string | null;
  /** The name it had then, when not the name it has now. */
  formerName: string | null;
};

/**
 * The sheet's rows: the current file first, then its versions newest first.
 * `createdAt` of a version is when its bytes stopped being the file's, and
 * `actor` who replaced them.
 */
export function historyRows(file: HistoryFile, versions: readonly FileVersion[]): HistoryRow[] {
  const current: HistoryRow = {
    key: 'current',
    label: 'Current',
    version: null,
    title: 'The file as it is now',
    at: file.replacedAt ?? file.updatedAt ?? file.createdAt ?? null,
    size: typeof file.sizeBytes === 'number' ? formatBytes(file.sizeBytes) : null,
    formerName: null,
  };
  const rows = [...versions]
    .sort((a, b) => b.seq - a.seq)
    .map<HistoryRow>((v) => ({
      key: v.id,
      label: `v${v.seq}`,
      version: v,
      title:
        v.trigger === 'pre_restore'
          ? v.restoredFrom !== null
            ? `Kept by restoring v${v.restoredFrom}`
            : 'Kept by a restore'
          : `Replaced by ${actorLabel(v.actor)}`,
      at: v.createdAt,
      size: formatBytes(v.sizeBytes),
      formerName: v.filename && v.filename !== file.filename ? v.filename : null,
    }));
  return [current, ...rows];
}

export const HISTORY_EMPTY =
  'No earlier versions. When a new file with the same name is uploaded here and you choose Override, the old one is kept here.';
export const HISTORY_GONE = 'History is not available on this brain';

/** Why the list could not be read: an older brain (404) or anything else. */
export function historyLoadError(err: unknown): string {
  if (err instanceof ApiError && err.status === 404) return HISTORY_GONE;
  return err instanceof Error && err.message ? err.message : 'Could not load the history.';
}

/** Why a restore or delete was refused, in the person's words. */
export function versionActionError(err: unknown, act: 'restore' | 'delete'): string {
  if (err instanceof ApiError) {
    if (err.status === 403) {
      return act === 'restore'
        ? 'You can see this history but cannot restore.'
        : 'You can see this history but cannot delete versions.';
    }
    if (err.status === 409 || err.status === 410) {
      return 'The bytes of this version are missing on the server.';
    }
    if (err.status === 404) return 'That version is gone. The list is up to date now.';
    if (err.message) return err.message;
  }
  return act === 'restore' ? 'Could not restore the version.' : 'Could not delete the version.';
}

/** The confirm of a restore: its title and line, read together
 *  "Restore v3? The current version is kept as a new version." */
export function restoreConfirm(seq: number): { title: string; body: string } {
  return { title: `Restore v${seq}?`, body: 'The current version is kept as a new version.' };
}

/** Said on the window when a restore put other bytes in a file: an open
 *  file view reloads it. */
export const FILE_RESTORED_EVENT = 'mantle:file-restored';

export function announceFileRestored(fileId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(FILE_RESTORED_EVENT, { detail: { fileId } }));
}

export function restoredFileId(e: Event): string | null {
  const d = (e as CustomEvent<{ fileId?: unknown }>).detail;
  return typeof d?.fileId === 'string' ? d.fileId : null;
}
