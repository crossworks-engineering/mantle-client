import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@mantle/web-ui/api-fetch';
import {
  cascadeOutcome,
  describeDerivedCounts,
  refusalMessages,
  folderIndexingDoneText,
  folderIndexingErrorText,
  FOLDER_INDEXING_MANAGE_TEXT,
  dismissDialog,
  fileFolderHref,
  slugify,
  sumDerivedCounts,
} from './files-shared';
import type { DerivedCounts, FilesDialog } from './files-shared';

/**
 * The Files screen's pure layer. None of this could be reached without
 * rendering a 2,158-line component until phase 1 lifted it out.
 */

describe('dismissDialog', () => {
  const rename: FilesDialog = {
    kind: 'rename',
    target: { kind: 'file', id: 'f1', filename: 'a.md', extension: 'md' },
  };

  it('closes the dialog that asked', () => {
    expect(dismissDialog(rename, 'rename')).toBeNull();
    expect(dismissDialog({ kind: 'bulkDelete' }, 'bulkDelete')).toBeNull();
  });

  // The reason this is a function and not `setDialog(null)`. Radix fires
  // onOpenChange(false) as it closes, and the bulk-delete flow opens the
  // cascade confirm from an async handler — a late close must not wipe the
  // dialog that replaced it.
  it('leaves a dialog that has already replaced it alone', () => {
    const cascade: FilesDialog = {
      kind: 'cascade',
      ids: ['f1'],
      counts: { images: 0, tables: 0, pages: 1, notes: 0, other: 0, total: 1 },
    };
    expect(dismissDialog(cascade, 'bulkDelete')).toBe(cascade);
    expect(dismissDialog(rename, 'createFolder')).toBe(rename);
  });

  it('is a no-op when nothing is open', () => {
    expect(dismissDialog(null, 'rename')).toBeNull();
  });
});

describe('slugify', () => {
  it('makes a path segment out of what someone types', () => {
    expect(slugify('My Notes')).toBe('my-notes');
    expect(slugify('  spaced  out  ')).toBe('spaced-out');
  });

  it('drops what cannot ride in a path', () => {
    expect(slugify('a/b\\c')).not.toContain('/');
    expect(slugify('a/b\\c')).not.toContain('\\');
    expect(slugify('....')).toBe('');
  });
});

describe('derived counts', () => {
  const counts = (o: Partial<DerivedCounts> = {}): DerivedCounts => ({
    images: 0,
    tables: 0,
    pages: 0,
    notes: 0,
    other: 0,
    total: 0,
    ...o,
  });

  it('sums every kind across files', () => {
    const total = sumDerivedCounts([
      counts({ pages: 1, notes: 2, total: 3 }),
      counts({ pages: 3, images: 1, total: 4 }),
    ]);
    expect(total.pages).toBe(4);
    expect(total.notes).toBe(2);
    expect(total.images).toBe(1);
    expect(total.total).toBe(7);
  });

  it('sums to zero over nothing', () => {
    expect(sumDerivedCounts([])).toEqual(counts());
  });

  // This sentence is what the user reads before agreeing to a cascade delete,
  // so it has to name what would actually go.
  it('describes what a cascade would take', () => {
    const text = describeDerivedCounts(counts({ pages: 2, notes: 1, total: 3 }));
    expect(text).toContain('2');
    expect(text).toMatch(/page/i);
    expect(text).toMatch(/note/i);
    expect(typeof describeDerivedCounts(counts())).toBe('string');
  });
});

/** The Files writes into a shared folder, pinned where the node runner
 *  cannot render them. */
describe('Files writes into a shared folder', () => {
  const read = (f: string) =>
    readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8').replace(/\s+/g, ' ');

  // Owner's word, 2026-11-12: a new file takes its folder's sharing, so an
  // upload (one file, many, a folder) just goes, whatever the screen's view
  // of the folder says. The drop zone still names who reads the folder.
  it('an upload into a shared folder asks nothing and goes at once', () => {
    const src = read('./files-client.tsx');
    expect(src).not.toMatch(/asksOnUpload|setSharedUpload|sharedUpload|to a shared folder\?/);
    expect(src).toContain('if (picked.length) enqueue(picked, currentPath);');
    expect(src).toContain('void sendTree(plan);');
    expect(src).toContain('for (const b of plan.batches) enqueue(b.files, b.parentPath);');
    expect(src).toContain('if (e.dataTransfer.files?.length) upload(e.dataTransfer.files);');
    expect(src).toContain(
      'const visibleTo = currentFolder ? uploadVisibleTo(folderGrants.data) : null;',
    );
  });

  it('the dock has no shared-folder refusal of its own', () => {
    const src = read('../../../components/uploads/upload-provider.tsx');
    expect(src).not.toMatch(/SHARED_UPLOAD_REFUSED|confirm/);
  });

  it('a new file in a shared folder shows the brain’s list and repeats with confirm', () => {
    const src = read('./files-dialogs.tsx');
    expect(src).toContain('const refusal = visibilityRefusal(err);');
    expect(src).toContain('run: () => void create(true),');
  });

  it('the dual pane sets refused items aside and repeats them with confirm and seen', () => {
    const src = read('./files-panes.tsx');
    expect(src).toContain(
      'const yes = seen?.has(key) ? { confirm: true, seen: seen.get(key) } : {};',
    );
    expect(src).toContain('refusal: mergeRefusals(refused.map((r) => r.refusal)),');
    expect(src).toContain('new Map(refused.map((r) => [r.key, r.refusal.total])),');
  });
});

describe('fileFolderHref (a /n link to a file, W6b fix round)', () => {
  it('opens the file in its own folder when the link names only the file', () => {
    expect(fileFolderHref(new URLSearchParams('file=f1'), 'files/reports')).toBe(
      '/files?file=f1&path=files%2Freports',
    );
  });

  it('leaves a link that names a folder, or a file with no folder', () => {
    expect(fileFolderHref(new URLSearchParams('file=f1&path=files'), 'files/reports')).toBeNull();
    expect(fileFolderHref(new URLSearchParams('file=f1'), null)).toBeNull();
    expect(fileFolderHref(new URLSearchParams('file=f1'), '')).toBeNull();
    expect(fileFolderHref(new URLSearchParams(''), 'files/reports')).toBeNull();
  });
});

// Brain F4: a bulk delete's refusals, one plain line per reason, and a
// cascade that never claims "everything" when items were kept.
describe('refusalMessages', () => {
  const names: Record<string, string> = { f1: 'plan.pdf', f2: 'notes.md' };
  const nameOf = (id: string) => names[id];

  it('says a reason it does not know without a why, never skipping it (F4 audit L4)', () => {
    const unknown = (fileId: string) =>
      ({ fileId, reason: 'locked' }) as unknown as Parameters<typeof refusalMessages>[0][number];
    expect(refusalMessages([unknown('f1'), unknown('f2'), unknown('f3')], nameOf)).toEqual([
      '3 files were not deleted.',
    ]);
    expect(refusalMessages([unknown('f1')], nameOf)).toEqual(['"plan.pdf" was not deleted.']);
    expect(refusalMessages([{ fileId: 'f2', reason: 'forbidden' }, unknown('f9')], nameOf)).toEqual(
      [
        '"notes.md" was not deleted: you can open it but not delete it. A Moderator of its workspace can.',
        'One file was not deleted.',
      ],
    );
  });

  it('says each reason in its own words', () => {
    expect(refusalMessages([{ fileId: 'f1', reason: 'not_found' }], nameOf)).toEqual([
      '"plan.pdf" was not deleted: it was not found. It may already be deleted, or you no longer have access.',
    ]);
    expect(refusalMessages([{ fileId: 'f1', reason: 'forbidden' }], nameOf)).toEqual([
      '"plan.pdf" was not deleted: you can open it but not delete it. A Moderator of its workspace can.',
    ]);
    expect(refusalMessages([{ fileId: 'f1', reason: 'attachment' }], nameOf)).toEqual([
      '"plan.pdf" was not deleted: it is an email attachment. Delete it from the email instead.',
    ]);
    expect(
      refusalMessages(
        [{ fileId: 'f1', reason: 'in_drawing', drawings: [{ id: 'd1', title: 'Site plan' }] }],
        nameOf,
      ),
    ).toEqual([
      '"plan.pdf" was not deleted: it is used in "Site plan". Remove it from the drawing first.',
    ]);
  });

  it('only an attachment is called an attachment (the old toast said so of every refusal)', () => {
    const lines = refusalMessages([
      { fileId: 'a', reason: 'not_found' },
      { fileId: 'b', reason: 'forbidden' },
    ]);
    expect(lines.join(' ')).not.toContain('attachment');
  });

  it('counts the drawings the login cannot open, never names them', () => {
    expect(
      refusalMessages(
        [
          {
            fileId: 'f1',
            reason: 'in_drawing',
            drawings: [{ id: 'd1', title: 'Site plan' }],
            hiddenDrawings: 2,
          },
        ],
        nameOf,
      ),
    ).toEqual([
      '"plan.pdf" was not deleted: it is used in "Site plan" and 2 drawings you cannot open. Remove it from the drawings you can open, and ask someone who can open the other drawings to remove it there.',
    ]);
    expect(refusalMessages([{ fileId: 'f1', reason: 'in_drawing', hiddenDrawings: 1 }])).toEqual([
      'One file was not deleted: it is used in 1 drawing you cannot open. Ask someone who can open the other drawings to remove it there.',
    ]);
  });

  it('groups several files per reason, and never shows an id', () => {
    const lines = refusalMessages(
      [
        { fileId: 'secret-id-1', reason: 'not_found' },
        { fileId: 'secret-id-2', reason: 'not_found' },
        { fileId: 'f1', reason: 'forbidden' },
        { fileId: 'f2', reason: 'forbidden' },
        { fileId: 'f1', reason: 'in_drawing', drawings: [{ id: 'd1', title: 'A' }] },
        { fileId: 'f2', reason: 'in_drawing', drawings: [{ id: 'd2', title: 'B' }] },
      ],
      nameOf,
    );
    expect(lines).toEqual([
      '2 files were not deleted: they are used in "A" and "B". Remove them from those drawings first.',
      '2 files were not deleted: you can open them but not delete them. A Moderator of their workspace can.',
      '2 files were not deleted: they were not found. They may already be deleted, or you no longer have access.',
    ]);
    expect(lines.join(' ')).not.toContain('secret-id');
  });

  it('nothing refused, nothing said; no em or en dashes in any line', () => {
    expect(refusalMessages([])).toEqual([]);
    const all = refusalMessages([
      { fileId: 'a', reason: 'not_found' },
      { fileId: 'b', reason: 'forbidden' },
      { fileId: 'c', reason: 'attachment' },
      { fileId: 'd', reason: 'in_drawing', hiddenDrawings: 3 },
    ]);
    expect(all).toHaveLength(4);
    for (const line of all) expect(line).not.toMatch(/[\u2013\u2014]/);
  });
});

describe('cascadeOutcome', () => {
  it('everything derived, when nothing was kept', () => {
    expect(cascadeOutcome({ deleted: 2, keptTotal: 0 }, 2)).toEqual({
      success: 'Deleted 2 files and everything derived from them',
      kept: null,
    });
  });

  it('says what was kept, and does not claim everything', () => {
    const out = cascadeOutcome({ deleted: 1, keptTotal: 3 }, 1);
    expect(out.success).toBe('Deleted 1 file and what was derived from it that you can manage');
    expect(out.success).not.toContain('everything');
    expect(out.kept).toBe('3 derived items were kept because you cannot manage them.');
    expect(cascadeOutcome({ deleted: 1, keptTotal: 1 }, 1).kept).toBe(
      '1 derived item was kept because you cannot manage it.',
    );
  });

  it('no success line when nothing was deleted (all refused)', () => {
    expect(cascadeOutcome({ deleted: 0, keptTotal: 0 }, 2).success).toBeNull();
  });

  it('a brain before F4 (no keptTotal) reads as nothing kept', () => {
    expect(cascadeOutcome({ deleted: 1 }, 1)).toEqual({
      success: 'Deleted 1 file and everything derived from it',
      kept: null,
    });
  });
});

describe('folder indexing texts (F4 audit L7)', () => {
  it("says the brain's workspace refusal in plain words", () => {
    const e = new ApiError('You cannot change this item in your workspaces.', 403, {
      error: 'forbidden',
      reason: 'item-workspace',
      message: 'You cannot change this item in your workspaces.',
    });
    expect(folderIndexingErrorText(e)).toBe(FOLDER_INDEXING_MANAGE_TEXT);
  });

  it("keeps the brain's words for anything else, else a fallback", () => {
    expect(folderIndexingErrorText(new ApiError('Folder not found', 404))).toBe('Folder not found');
    expect(folderIndexingErrorText(new ApiError('Not allowed here.', 403))).toBe(
      'Not allowed here.',
    );
    expect(folderIndexingErrorText('boom')).toBe('Could not change indexing.');
  });

  it('says what changed, with no em or en dashes', () => {
    const texts = [
      folderIndexingDoneText('metadata', 0),
      folderIndexingDoneText('metadata', 3),
      folderIndexingDoneText('full', 0),
      folderIndexingDoneText('full', 1),
      folderIndexingDoneText('full', 4),
      folderIndexingDoneText('inherit', 0),
      FOLDER_INDEXING_MANAGE_TEXT,
    ];
    for (const t of texts) expect(t).not.toMatch(/[\u2013\u2014]/);
    expect(folderIndexingDoneText('full', 1)).toBe(
      'Content indexing on: 1 file queued for extraction.',
    );
    expect(folderIndexingDoneText('metadata', 3)).toBe(
      'Content indexing off. Files stay findable by name, type and tags (3 re-indexing).',
    );
  });
});
