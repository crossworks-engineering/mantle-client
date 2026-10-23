'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { apiFetch, apiSend } from '@mantle/web-ui/api-fetch';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { useToast } from '@mantle/web-ui/ui/toast';
import { DropdownMenuItem } from '@mantle/web-ui/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@mantle/web-ui/ui/alert-dialog';
import { useItemAddress } from '@/components/layout/use-item-address';
import { useRememberLastOpened } from '@/components/last-opened/last-opened';
import { useZenMode } from '@/components/layout/zen-mode';
import { ItemTree } from '@/components/item-tree/item-tree';
import { useTreeSearch } from '@/components/item-tree/use-tree-search';
import { presentAdapter } from '@/components/item-tree/kinds/simple';
import { treeKey } from '@/components/item-tree/tree-api';
import { useTreeServes } from '@/components/item-tree/use-tree-kinds';
import { shareMarksOf } from '@/components/share/access-stack';
import { itemAccess } from '@/lib/item-access';
import { PresentView, type PresentDetail } from './present-view';

/**
 * The Present workspace (mantle docs/proposals/canvas-files.md): canvases
 * in the standard folder view (the item tree of kind `present`, the shared
 * row-only kind folders), and the picked canvas running live beside it.
 *
 * Present v1 is agent driven: a canvas is made and changed by asking
 * Presenter, so there is no New and no editor here. The tree's folder menus,
 * search and Move work as on every kind.
 */
export function PresentClient() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { zen } = useZenMode();
  // The canvas in the address (`/present/<id>`).
  const address = useItemAddress('present');
  const treeServes = useTreeServes('present');
  const [treeQuery, setTreeQuery] = useTreeSearch();

  const [selectedId, setSelectedId] = useState<string | null>(address.id);
  // The tree row a canvas was opened from: its share marks, for Access.
  const [openedRow, setOpenedRow] = useState<unknown>(null);
  useEffect(() => {
    if (address.id) setSelectedId(address.id);
  }, [address.id]);

  const presentQuery = useQuery({
    queryKey: ['presents', selectedId],
    queryFn: () =>
      apiFetch<{ present: PresentDetail }>(`/api/presents/${selectedId}`).then((r) => r.present),
    enabled: !!selectedId,
  });
  const active = presentQuery.data?.id === selectedId ? presentQuery.data : null;
  // Present opens on this canvas next time (lib/last-opened.ts).
  useRememberLastOpened('present', active ? active.id : null);

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function deleteActive() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await apiSend(`/api/presents/${deleteTarget.id}`, 'DELETE');
      toast.success('Canvas deleted');
      if (selectedId === deleteTarget.id) setSelectedId(null);
      if (address.id === deleteTarget.id) address.close();
      await queryClient.invalidateQueries({ queryKey: ['presents'] });
      void queryClient.invalidateQueries({ queryKey: treeKey('present') });
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the canvas');
    } finally {
      setDeleting(false);
    }
  }

  function select(id: string) {
    setSelectedId(id);
    if (id !== address.id) address.open(id);
  }

  return (
    <>
      <MasterDetail
        id="present"
        defaultListSize="360px"
        // The detail is a running canvas, not prose: it takes the slack.
        detailFills
        // Maximise collapses the folders (the list stays mounted).
        listCollapsed={zen}
        list={
          treeServes === false ? (
            <div className="flex h-full items-center justify-center p-6 text-center">
              <p className="text-sm text-muted-foreground">
                This brain does not have Present yet. Update the brain to use it.
              </p>
            </div>
          ) : (
            <aside className="flex h-full flex-col bg-muted/20">
              <ItemTree
                kind="present"
                adapter={presentAdapter}
                selectedItemId={selectedId}
                query={treeQuery}
                onQueryChange={setTreeQuery}
                searchPlaceholder="Search canvases and folders…"
                onOpenItem={(item) => {
                  setOpenedRow(item);
                  select(item.id);
                }}
                itemActions={(item) =>
                  itemAccess(item).manage ? (
                    <DropdownMenuItem
                      className="text-destructive-ink focus:text-destructive-ink"
                      onSelect={() => setDeleteTarget({ id: item.id, title: item.title })}
                    >
                      <Trash2 />
                      Delete…
                    </DropdownMenuItem>
                  ) : null
                }
                onChanged={() => void queryClient.invalidateQueries({ queryKey: ['presents'] })}
              />
            </aside>
          )
        }
        detail={
          active ? (
            <PresentView
              key={active.id}
              present={active}
              shares={shareMarksOf(active, openedRow)}
              onDelete={() => setDeleteTarget({ id: active.id, title: active.title })}
            />
          ) : selectedId && presentQuery.isLoading ? (
            <div className="flex h-full items-center justify-center">
              <Spinner />
            </div>
          ) : selectedId && presentQuery.isError ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-muted-foreground">This canvas is not available.</p>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center">
              <p className="text-sm text-muted-foreground">Select a canvas.</p>
              <p className="text-xs text-muted-foreground">
                To make one, ask the assistant to draw, animate or present something.
              </p>
            </div>
          )
        }
      />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this canvas?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleteTarget?.title ?? ''}”, its kept versions and its brain index will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={() => void deleteActive()}
            >
              {deleting ? 'Deleting…' : 'Delete canvas'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
