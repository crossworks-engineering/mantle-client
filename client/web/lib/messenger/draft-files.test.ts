/**
 * The draft's files: uploaded as added, a file over the cap marked and
 * never uploaded, at most 5 a line, and what a send carries.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MessengerAttachment } from './dto';
import {
  addDraftFiles,
  clearDraftFiles,
  draftFiles,
  draftPayload,
  draftSettled,
  removeDraftFile,
} from './draft-files';
import { FILE_MAX_BYTES } from './fleet';

const CHAT = 'chat-1';

const file = (name: string, bytes: number, type = 'text/plain') => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: bytes });
  return f;
};
const attachment = (name: string): MessengerAttachment => ({
  id: `id-${name}`,
  name,
  mime: 'text/plain',
  bytes: 1,
  kind: 'file',
});
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => clearDraftFiles(CHAT));

describe('draft files', () => {
  it('uploads each file and names it in the send', async () => {
    const upload = vi.fn((_c: string, f: File) => Promise.resolve(attachment(f.name)));
    addDraftFiles(CHAT, [file('a.txt', 10), file('b.txt', 20)], upload);
    expect(draftFiles(CHAT).map((f) => f.state)).toEqual(['uploading', 'uploading']);
    expect(draftSettled(draftFiles(CHAT))).toBe(false);
    await flush();
    expect(upload).toHaveBeenCalledTimes(2);
    expect(draftSettled(draftFiles(CHAT))).toBe(true);
    expect(draftPayload(draftFiles(CHAT))).toEqual({
      attachments: ['id-a.txt', 'id-b.txt'],
      leftOut: [],
    });
  });

  it('keeps a file over 10 MB, marked, never uploaded, and names it as left out', async () => {
    const upload = vi.fn(() => Promise.resolve(attachment('x')));
    addDraftFiles(CHAT, [file('dump.log', FILE_MAX_BYTES + 1)], upload);
    await flush();
    expect(upload).not.toHaveBeenCalled();
    expect(draftFiles(CHAT)[0]!.state).toBe('too-big');
    expect(draftSettled(draftFiles(CHAT))).toBe(true);
    expect(draftPayload(draftFiles(CHAT))).toEqual({
      attachments: [],
      leftOut: [{ name: 'dump.log', bytes: FILE_MAX_BYTES + 1 }],
    });
  });

  it('takes at most 5 files a line', () => {
    const upload = vi.fn(() => new Promise<MessengerAttachment>(() => {}));
    const out = addDraftFiles(
      CHAT,
      Array.from({ length: 7 }, (_, i) => file(`${i}.txt`, 1)),
      upload,
    );
    expect(out).toEqual({
      added: 5,
      refused: ['A line takes at most 5 files. Not added: 5.txt, 6.txt.'],
    });
    expect(draftFiles(CHAT)).toHaveLength(5);
  });

  it('refuses a type the brain does not take, and names a nameless pasted picture', async () => {
    const upload = vi.fn((_c: string, f: File) => Promise.resolve(attachment(f.name)));
    const out = addDraftFiles(
      CHAT,
      [file('page.html', 10, 'text/html'), file('image', 10, 'image/png')],
      upload,
    );
    expect(out.refused).toEqual([
      'page.html cannot go in a chat. Use PNG, JPG, GIF, WebP, PDF, TXT, LOG, MD, JSON or CSV.',
    ]);
    await flush();
    expect(draftFiles(CHAT).map((f) => f.name)).toEqual(['image.png']);
    expect(upload.mock.calls[0]![1].name).toBe('image.png');
  });

  it('names at most 20 files left out', () => {
    const upload = vi.fn(() => Promise.resolve(attachment('x')));
    const big = Array.from({ length: 21 }, (_, i) => file(`${i}.log`, FILE_MAX_BYTES + 1));
    const out = addDraftFiles(CHAT, big, upload);
    expect(out.added).toBe(20);
    expect(out.refused).toEqual(['A line names at most 20 files left out. Not added: 20.log.']);
    expect(draftPayload(draftFiles(CHAT)).leftOut).toHaveLength(20);
  });

  it('marks a failed upload, which holds the send until removed', async () => {
    addDraftFiles(CHAT, [file('a.txt', 1)], () => Promise.reject(new Error('No room')));
    await flush();
    const [f] = draftFiles(CHAT);
    expect(f).toMatchObject({ state: 'failed', error: 'No room' });
    expect(draftSettled(draftFiles(CHAT))).toBe(false);
    removeDraftFile(CHAT, f!.key);
    expect(draftFiles(CHAT)).toHaveLength(0);
  });

  it('a file removed while it uploads stays removed', async () => {
    let done: (a: MessengerAttachment) => void = () => {};
    addDraftFiles(CHAT, [file('a.txt', 1)], () => new Promise((r) => (done = r)));
    removeDraftFile(CHAT, draftFiles(CHAT)[0]!.key);
    done(attachment('a.txt'));
    await flush();
    expect(draftFiles(CHAT)).toHaveLength(0);
  });
});
