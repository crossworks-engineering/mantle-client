'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@mantle/web-ui/api-fetch';
import { useToast } from '@mantle/web-ui/ui/toast';
import type { TreeFolder, TreeKind } from '@mantle/web-ui/types/tree';
import { moveTreeItems, treeKey } from './tree-api';
import { seenOf, visibilityRefusal } from './sharing';
import { VisibilityConfirmDialog, type PendingConfirm } from './visibility-confirm';
import {
  CREATE_HERE_TITLE,
  MoveGrantsDialog,
  fetchMovePreview,
  type MoveTarget,
} from '@/components/share/grant-dialogs';
import { moveChangesAccess, type MovePreview } from '@/lib/grants';

/**
 * Files a new item in a folder of the owner's tree: the section created it
 * with its own create call (most of them take no folder), and this moves it
 * there with the tree's own move. In a shared folder the brain asks first
 * (the item takes the folder's workspaces): `confirm` is that question, which the
 * section renders. Cancelled, the item stays at the top level. Resolves once
 * it is filed, kept where it is, or the move failed (a toast).
 */
export function useFileNewItem(
  kind: TreeKind,
  noun: string,
): { fileNew: (id: string, folder: TreeFolder) => Promise<void>; confirm: ReactNode } {
  const qc = useQueryClient();
  const toast = useToast();
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [grantMove, setGrantMove] = useState<{
    target: MoveTarget;
    preview: MovePreview;
  } | null>(null);
  // The open question's promise, and whether "go ahead" was chosen (then the
  // confirmed move settles it, not the dialog closing).
  const settle = useRef<(() => void) | null>(null);
  const going = useRef(false);

  const fileNew = useCallback(
    (id: string, folder: TreeFolder) =>
      new Promise<void>((resolve) => {
        const attempt = async (confirm: boolean, seen?: number) => {
          try {
            const res = await moveTreeItems(kind, [id], folder.id, confirm, 'owner', seen);
            if (res.failed.length) {
              toast.error(`Could not put the ${noun} in “${folder.name}”: ${res.failed[0]!.error}`);
            }
          } catch (err) {
            const refusal = visibilityRefusal(err);
            if (refusal) {
              settle.current = resolve;
              going.current = false;
              setPending({
                refusal,
                action: `Put the new ${noun} in “${folder.name}”.`,
                verb: 'Put it there',
                run: () => {
                  going.current = true;
                  void attempt(true, seenOf(refusal));
                },
              });
              return;
            }
            toast.error(
              err instanceof ApiError ? err.message : `Could not put the ${noun} in the folder`,
            );
          }
          void qc.invalidateQueries({ queryKey: treeKey(kind) });
          resolve();
        };
        // W5b, S6: the item takes the folder's workspaces. Say which first
        // ("This will also be visible to: ..."); a brain before W5b, or a
        // folder that adds none, files it as before.
        fetchMovePreview([id], { toFolderId: folder.id }).then(
          (preview) => {
            if (!moveChangesAccess(preview)) return void attempt(false);
            settle.current = resolve;
            setGrantMove({
              preview,
              target: {
                nodeIds: [id],
                action: `Put the new ${noun} in “${folder.name}”.`,
                title: CREATE_HERE_TITLE,
                to: { toFolderId: folder.id },
                ...(kind === 'apps' ? { app: true } : {}),
                onMoved: () => void qc.invalidateQueries({ queryKey: treeKey(kind) }),
              },
            });
          },
          () => void attempt(false),
        );
      }),
    [kind, noun, qc, toast],
  );

  const closeGrantMove = useCallback(() => {
    setGrantMove(null);
    // Moved or cancelled (it stays at the top level): the section opens it.
    settle.current?.();
    settle.current = null;
  }, []);

  const confirm = (
    <>
      <MoveGrantsDialog
        target={grantMove?.target ?? null}
        preview={grantMove?.preview ?? null}
        onClose={closeGrantMove}
      />
      <VisibilityConfirmDialog
        pending={pending}
        onOpenChange={(o) => {
          if (o) return;
          setPending(null);
          // A cancel keeps the item at the top level; the section opens it.
          if (!going.current) settle.current?.();
          settle.current = null;
        }}
      />
    </>
  );
  return { fileNew, confirm };
}
