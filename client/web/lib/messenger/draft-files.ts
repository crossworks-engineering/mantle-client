/**
 * The files of each chat's unsent line (fleet chat, plan section 8), in
 * memory only, as the text drafts are (drafts.ts). A file is uploaded as it
 * is added (POST /api/messenger/c/:id/attachments: the brain keeps it with
 * no line yet), so the send only names its id. A file over 10 MB is never
 * uploaded: it stays in the list marked "Too big. It will not be sent.",
 * and the send names it in `leftOut`. The area capture's "Send to chat"
 * adds its picture here too, so the composer of the open chat shows it.
 *
 * Pinned by draft-files.test.ts.
 */
import { useSyncExternalStore } from 'react';
import type { MessengerAttachment } from './dto';
import { FILE_MAX_BYTES, FILES_PER_LINE } from './fleet';

export type DraftFile = {
  key: string;
  name: string;
  bytes: number;
  mime: string;
  /** A local picture of an image (an object URL), for the composer and the
   *  send preview; null for any other file. */
  url: string | null;
  state: 'uploading' | 'ready' | 'failed' | 'too-big';
  attachment?: MessengerAttachment;
  error?: string;
};

type Upload = (chat: string, file: File) => Promise<MessengerAttachment>;

const EMPTY: readonly DraftFile[] = [];
const files = new Map<string, readonly DraftFile[]>();
const listeners = new Set<() => void>();
let seq = 0;

const emit = () => {
  for (const l of listeners) l();
};
const set = (chat: string, next: readonly DraftFile[]) => {
  if (next.length) files.set(chat, next);
  else files.delete(chat);
  emit();
};
const patch = (chat: string, key: string, change: Partial<DraftFile>) =>
  set(
    chat,
    (files.get(chat) ?? EMPTY).map((f) => (f.key === key ? { ...f, ...change } : f)),
  );

const objectUrl = (file: File): string | null => {
  if (!file.type.startsWith('image/')) return null;
  try {
    return URL.createObjectURL(file);
  } catch {
    return null;
  }
};
const revoke = (f: DraftFile) => {
  if (f.url) {
    try {
      URL.revokeObjectURL(f.url);
    } catch {
      /* gone already */
    }
  }
};

export function draftFiles(chat: string): readonly DraftFile[] {
  return files.get(chat) ?? EMPTY;
}

/** The files that go with the line (uploaded, not too big). */
export function sendable(list: readonly DraftFile[]): DraftFile[] {
  return list.filter((f) => f.state !== 'too-big');
}

/**
 * Add files to chat `chat`'s draft. A file over the cap is kept, marked,
 * never uploaded. At most FILES_PER_LINE go with a line: past that a file
 * is not added, and the answer counts it.
 */
export function addDraftFiles(
  chat: string,
  picked: readonly File[],
  upload: Upload,
): { added: number; refused: number } {
  const list = [...(files.get(chat) ?? EMPTY)];
  let added = 0;
  let refused = 0;
  const started: { key: string; file: File }[] = [];
  for (const file of picked) {
    const big = file.size > FILE_MAX_BYTES;
    if (!big && sendable(list).length >= FILES_PER_LINE) {
      refused += 1;
      continue;
    }
    const key = `f${(seq += 1)}`;
    list.push({
      key,
      name: file.name || 'file',
      bytes: file.size,
      mime: file.type || 'application/octet-stream',
      url: big ? null : objectUrl(file),
      state: big ? 'too-big' : 'uploading',
    });
    added += 1;
    if (!big) started.push({ key, file });
  }
  set(chat, list);
  for (const { key, file } of started) {
    upload(chat, file).then(
      (attachment) => {
        if (draftFiles(chat).some((f) => f.key === key))
          patch(chat, key, { state: 'ready', attachment });
      },
      (err: unknown) => {
        if (!draftFiles(chat).some((f) => f.key === key)) return;
        patch(chat, key, {
          state: 'failed',
          error: err instanceof Error && err.message ? err.message : 'Not uploaded',
        });
      },
    );
  }
  return { added, refused };
}

export function removeDraftFile(chat: string, key: string): void {
  const list = files.get(chat) ?? EMPTY;
  const gone = list.find((f) => f.key === key);
  if (gone) revoke(gone);
  set(
    chat,
    list.filter((f) => f.key !== key),
  );
}

/** After a send: the draft's files went with the line. */
export function clearDraftFiles(chat: string): void {
  for (const f of files.get(chat) ?? EMPTY) revoke(f);
  set(chat, EMPTY);
}

/** What a send carries from the draft: the uploaded ids, and the files
 *  over the cap by name and size. */
export function draftPayload(list: readonly DraftFile[]): {
  attachments: string[];
  leftOut: { name: string; bytes: number }[];
} {
  return {
    attachments: list.flatMap((f) =>
      f.state === 'ready' && f.attachment ? [f.attachment.id] : [],
    ),
    leftOut: list
      .filter((f) => f.state === 'too-big')
      .map((f) => ({ name: f.name, bytes: f.bytes })),
  };
}

/** Whether the draft can go: no upload still running or failed. */
export function draftSettled(list: readonly DraftFile[]): boolean {
  return list.every((f) => f.state === 'ready' || f.state === 'too-big');
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Chat `chat`'s draft files, live. */
export function useDraftFiles(chat: string | undefined): readonly DraftFile[] {
  return useSyncExternalStore(
    subscribe,
    () => (chat ? draftFiles(chat) : EMPTY),
    () => EMPTY,
  );
}
