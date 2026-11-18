import { describe, expect, it } from 'vitest';
import {
  attentionHint,
  FILE_REINDEX_MAX,
  REINDEX_BUSY,
  REINDEX_PATH,
  reindexConfirmText,
  reindexPages,
  reindexText,
  sendReindex,
  stalePath,
  type FileReindexAnswer,
  type ReindexOutcome,
} from './file-reindex';

const ids = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `id-${from + i}`);

function outcome(over: Partial<ReindexOutcome> = {}): ReindexOutcome {
  return {
    queued: 0,
    databases: 0,
    skipped: { 'not-found': 0, 'not-allowed': 0, 'in-queue': 0 },
    busy: false,
    left: [],
    ...over,
  };
}

describe('reindexPages: pages of 200', () => {
  it('splits 450 ids into 200, 200 and 50', () => {
    const pages = reindexPages(ids(450));
    expect(FILE_REINDEX_MAX).toBe(200);
    expect(pages.map((p) => p.length)).toEqual([200, 200, 50]);
    expect(pages[1]![0]).toBe('id-200');
  });

  it('exactly 200 is one page; none is no page', () => {
    expect(reindexPages(ids(200))).toHaveLength(1);
    expect(reindexPages([])).toEqual([]);
  });

  it('sends each id once', () => {
    expect(reindexPages(['a', 'b', 'a', 'c', 'b'])).toEqual([['a', 'b', 'c']]);
  });
});

describe('sendReindex: the send loop', () => {
  it('sends every page and adds the answers up', async () => {
    const sent: string[][] = [];
    const out = await sendReindex(ids(401), async (path, body) => {
      expect(path).toBe(REINDEX_PATH);
      sent.push(body.ids);
      return {
        queued: body.ids.length - 1,
        databases: 1,
        skipped: [{ id: body.ids[0]!, reason: 'in-queue' }],
      };
    });
    expect(sent.map((p) => p.length)).toEqual([200, 200, 1]);
    expect(out).toEqual(
      outcome({
        queued: 398,
        databases: 3,
        skipped: { 'not-found': 0, 'not-allowed': 0, 'in-queue': 3 },
      }),
    );
  });

  it('a busy queue stops the loop and names what was left', async () => {
    let calls = 0;
    const out = await sendReindex(ids(450), async (_p, body): Promise<FileReindexAnswer> => {
      calls += 1;
      if (calls === 1) return { queued: 200, databases: 0, skipped: [] };
      return {
        queued: 0,
        databases: 0,
        skipped: [
          { id: body.ids[0]!, reason: 'not-allowed' },
          ...body.ids.slice(1).map((id) => ({ id, reason: 'busy' as const })),
        ],
      };
    });
    expect(calls).toBe(2);
    expect(out.busy).toBe(true);
    expect(out.queued).toBe(200);
    expect(out.skipped['not-allowed']).toBe(1);
    // 199 busy from page two, and all 50 of page three never sent.
    expect(out.left).toHaveLength(249);
    expect(out.left).toContain('id-449');
    expect(out.left).not.toContain('id-200');
  });

  it('an error throws on', async () => {
    await expect(
      sendReindex(['a'], () => Promise.reject(Object.assign(new Error('gone'), { status: 404 }))),
    ).rejects.toThrow('gone');
  });
});

describe('reindexText: the answer in plain words', () => {
  it('all queued', () => {
    expect(reindexText(outcome({ queued: 5 }))).toEqual({
      tone: 'success',
      message: 'Queued 5.',
    });
    expect(reindexText(outcome({ queued: 5, databases: 2 })).message).toBe(
      'Queued 5. 2 databases will be built again.',
    );
  });

  it('every skip reason, counted', () => {
    const t = reindexText(
      outcome({ queued: 3, skipped: { 'in-queue': 2, 'not-allowed': 1, 'not-found': 1 } }),
    );
    expect(t).toEqual({
      tone: 'success',
      message: 'Queued 3. Skipped 4: 2 already in the queue, 1 not allowed, 1 not found.',
    });
  });

  it('nothing queued', () => {
    expect(
      reindexText(outcome({ skipped: { 'in-queue': 2, 'not-allowed': 0, 'not-found': 0 } })),
    ).toEqual({
      tone: 'info',
      message: 'Nothing was queued. Skipped 2: 2 already in the queue.',
    });
  });

  it('busy: says so, and what was queued before it', () => {
    expect(reindexText(outcome({ busy: true, left: ids(3) }))).toEqual({
      tone: 'error',
      message: REINDEX_BUSY,
    });
    expect(reindexText(outcome({ queued: 200, busy: true, left: ids(50) })).message).toBe(
      `Queued 200. ${REINDEX_BUSY}`,
    );
    expect(REINDEX_BUSY).toBe(
      'The read queue is busy. Nothing more was queued; try again in a few minutes.',
    );
  });

  it('one file by name', () => {
    expect(reindexText(outcome({ queued: 1 }), 'a.pdf')).toEqual({
      tone: 'success',
      message: 'a.pdf is queued to be read again.',
    });
    expect(reindexText(outcome({ queued: 1, databases: 1 }), 'a.xlsx').message).toBe(
      'a.xlsx is queued to be read again, its database too.',
    );
    const one = (k: 'in-queue' | 'not-allowed' | 'not-found') =>
      reindexText(
        outcome({ skipped: { 'in-queue': 0, 'not-allowed': 0, 'not-found': 0, [k]: 1 } }),
        'a.pdf',
      ).message;
    expect(one('in-queue')).toBe('a.pdf is already in the queue.');
    expect(one('not-allowed')).toBe('You may not change a.pdf, so it was not queued.');
    expect(one('not-found')).toBe('a.pdf was not found.');
    expect(reindexText(outcome({ busy: true, left: ['x'] }), 'a.pdf').message).toBe(REINDEX_BUSY);
  });

  it('the confirm for many', () => {
    expect(reindexConfirmText(12)).toEqual({
      title: 'Read 12 files again?',
      body: 'This runs the whole pipeline (text, embedding, facts, file database) and may use model credits.',
      action: 'Reindex 12 files',
    });
  });
});

describe('Needs attention helpers', () => {
  it('stalePath', () => {
    expect(stalePath('stale', null)).toBe('/api/files/stale?state=stale&limit=50');
    expect(stalePath('failed', 'abc', 1)).toBe('/api/files/stale?state=failed&limit=1&cursor=abc');
  });

  it('attentionHint: what read it, or why it was not read', () => {
    expect(
      attentionHint(
        {
          readBy: { reader: 'pdf-parse', v: 1 },
          pipelineRead: { name: 'Sheets', version: '1.0' },
        },
        'stale',
      ),
    ).toBe('Read by pdf-parse v1; database by Sheets, version 1.0');
    expect(attentionHint({}, 'stale')).toBe('Read by an older reader');
    expect(
      attentionHint({ extraction: { reason: 'encrypted', hint: 'Upload it open.' } }, 'failed'),
    ).toBe('Upload it open.');
    expect(attentionHint({ extraction: { reason: 'encrypted' } }, 'failed')).toBe('encrypted');
    expect(attentionHint({}, 'partial')).toBe('');
  });
});
