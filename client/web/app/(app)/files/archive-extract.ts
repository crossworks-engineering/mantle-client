/**
 * An archive's "Extract contents" (brain v0.709, mantle docs/files.md
 * "Archives"): GET /api/files/files/:id/extract says whether it applies and
 * how the last extraction went; POST to the same path asks for one. Never
 * automatic: only a person's click. Pure: the path, the name gate and the
 * words. The hook and the section are archive-extract-ui.tsx.
 */
import type {
  ArchiveEntryRefusal,
  ArchiveExtractAnswer,
  ArchiveExtractView,
} from '@mantle/client-types';
import type { DetailTone } from './file-status';

export type { ArchiveExtractAnswer, ArchiveExtractView };

export const extractPath = (fileId: string) =>
  `/api/files/files/${encodeURIComponent(fileId)}/extract`;

/** The endings the brain may extract (ZIP, TAR, gzip; `.tar.gz` ends in
 *  `.gz`). Only a name like this is asked about: the brain checks the first
 *  bytes too and its answer decides. 7z and RAR are never extracted. */
const ARCHIVE_END = /\.(zip|tar|tgz|gz)$/i;

export function mayBeArchive(filename: string | null | undefined): boolean {
  return !!filename && ARCHIVE_END.test(filename.trim());
}

/** Whether an extraction is under way: the panel asks again while it is. */
export function extractBusy(x: ArchiveExtractView | null | undefined): boolean {
  return x?.state === 'queued' || x?.state === 'running';
}

const count = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

const REFUSAL_WORDS: Record<ArchiveEntryRefusal, string> = {
  traversal: 'a path out of the folder',
  absolute: 'a path from the root',
  'bad-name': 'not a usable name',
  link: 'a link',
  device: 'a device or pipe',
  encrypted: 'encrypted',
  method: 'a compression this box does not read',
  unsupported: 'an entry type this box does not read',
  'too-large': 'past the size limit',
  damaged: 'damaged',
  'not-written': 'could not be written',
};

/** One entry not written, in plain words; a reason this client does not
 *  know is named as the brain sent it. */
export function refusalWords(reason: string): string {
  return Object.hasOwn(REFUSAL_WORDS, reason)
    ? REFUSAL_WORDS[reason as ArchiveEntryRefusal]
    : reason;
}

export type ExtractLine = { text: string; tone: DetailTone; more: string[] };

/** The state of the last extraction in plain words, with the details of a
 *  finished one (`more`). Null when none was asked. */
export function extractLine(x: ArchiveExtractView | null | undefined): ExtractLine | null {
  if (!x) return null;
  switch (x.state) {
    case 'queued':
      return { text: 'In the queue to extract', tone: 'muted', more: [] };
    case 'running':
      return {
        text: x.files > 0 ? `Extracting: ${count(x.files, 'file')} so far` : 'Extracting',
        tone: 'muted',
        more: [],
      };
    case 'failed':
      return {
        text: x.error ? `Could not extract: ${x.error}` : 'Could not extract',
        tone: 'error',
        more: [],
      };
    case 'done': {
      const more: string[] = [];
      if (x.refusedCount > 0) {
        more.push(`${count(x.refusedCount, 'entry', 'entries')} not written`);
      }
      if (x.flattened > 0) {
        more.push(`${count(x.flattened, 'file')} with deeper folders kept in the name`);
      }
      if (x.skipped > 0) more.push(`${count(x.skipped, 'system file')} left out`);
      return {
        text:
          `Extracted ${count(x.files, 'file')}` +
          (x.folders > 0 ? ` in ${count(x.folders, 'folder')}` : ''),
        tone: x.refusedCount > 0 ? 'warning' : 'ok',
        more,
      };
    }
    default:
      return null;
  }
}
