'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Layers, Plus } from 'lucide-react';
import { ApiError } from '@mantle/web-ui/api-fetch';
import { Badge } from '@mantle/web-ui/ui/badge';
import { Button } from '@mantle/web-ui/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@mantle/web-ui/ui/dialog';
import { Field, FieldError, FieldGroup, FieldLabel } from '@mantle/web-ui/ui/field';
import { Input } from '@mantle/web-ui/ui/input';
import { ListCard, ListCardMeta } from '@mantle/web-ui/ui/list-card';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { Textarea } from '@mantle/web-ui/ui/textarea';
import { useToast } from '@mantle/web-ui/ui/toast';
import {
  isSystemWorkspace,
  sortWorkspaces,
  workspaceErrorText,
  workspaceMeta,
  type Workspace,
} from '@/lib/workspaces';
import { useViewerAreas } from '@/components/workspaces/use-shell-workspaces';
import { useWorkspaceActions, useWorkspaces } from '@/components/workspaces/workspace-queries';
import { WorkspaceTile } from '@/components/workspaces/workspace-tile';
import { WorkspaceScreen } from './workspace-screen';

/** What the list says when this brain has no workspaces routes (before W5a). */
export const NO_WORKSPACES_ROUTE_TEXT = 'This brain does not have workspaces yet.';

/**
 * Workspaces: the list on the left, the ONE workspace screen on the right
 * (plan 1.4). Every workspace uses the same screen; Admin is not special
 * here beyond its pill and having no Archive.
 *
 * Deep link: ?selected=<id> (initial state only; selection stays client
 * state after, as on Users).
 */
export function WorkspacesClient() {
  const searchParams = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('selected'));
  const [newOpen, setNewOpen] = useState(false);
  const list = useWorkspaces();
  const areas = useViewerAreas();

  if (list.isPending) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }
  if (list.isError && !list.data) {
    const missing = list.error instanceof ApiError && list.error.status === 404;
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 py-12 text-sm text-muted-foreground">
        <p>{missing ? NO_WORKSPACES_ROUTE_TEXT : 'Could not load workspaces.'}</p>
        {missing ? null : (
          <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
            Retry
          </Button>
        )}
      </div>
    );
  }

  return (
    <WorkspacesView
      workspaces={list.data}
      areas={areas}
      selectedId={selectedId}
      onSelect={setSelectedId}
      newOpen={newOpen}
      onNewOpenChange={setNewOpen}
    />
  );
}

export function WorkspacesView({
  workspaces,
  areas,
  selectedId,
  onSelect,
  newOpen,
  onNewOpenChange,
}: {
  workspaces: Workspace[];
  areas: readonly string[] | undefined;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  newOpen: boolean;
  onNewOpenChange: (open: boolean) => void;
}) {
  const sorted = sortWorkspaces(workspaces);
  // The first workspace when nothing (or something gone) is selected, so the
  // right pane is never blank.
  const selected = sorted.find((w) => w.id === selectedId) ?? sorted[0] ?? null;

  return (
    <>
      <MasterDetail
        id="settings-workspaces"
        defaultListSize="340px"
        list={
          <>
            <div className="flex items-center justify-between gap-2 border-b border-border p-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Workspaces
              </h2>
              {/* Any login may make one; it is then its only user, a Moderator. */}
              <Button size="sm" onClick={() => onNewOpenChange(true)}>
                <Plus /> New workspace
              </Button>
            </div>
            <div className="space-y-2 p-3 md:flex-1 md:overflow-y-auto md:scrollbar-thin">
              {sorted.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">You are in no workspaces.</p>
              ) : (
                sorted.map((w) => (
                  <WorkspaceCard
                    key={w.id}
                    workspace={w}
                    selected={selected?.id === w.id}
                    onSelect={() => onSelect(w.id)}
                  />
                ))
              )}
            </div>
          </>
        }
        detail={
          selected ? (
            <WorkspaceScreen
              key={selected.id}
              workspace={selected}
              areas={areas}
              onArchived={() => onSelect(null)}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
              <Layers className="mr-2 size-4" aria-hidden /> No workspaces.
            </div>
          )
        }
      />
      <NewWorkspaceDialog
        open={newOpen}
        onOpenChange={onNewOpenChange}
        onCreated={(id) => onSelect(id)}
      />
    </>
  );
}

function WorkspaceCard({
  workspace: w,
  selected,
  onSelect,
}: {
  workspace: Workspace;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <ListCard onClick={onSelect} selected={selected} dimmed={w.archived}>
      <div className="flex items-center gap-2">
        <WorkspaceTile workspace={w} size="sm" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{w.name}</span>
        {w.isAdmin ? (
          <Badge variant="secondary" className="shrink-0">
            Admin
          </Badge>
        ) : null}
        {isSystemWorkspace(w) ? (
          <Badge variant="secondary" className="shrink-0">
            System
          </Badge>
        ) : null}
        {w.me.moderator && !w.archived ? (
          <Badge variant="outline" className="shrink-0">
            Moderator
          </Badge>
        ) : null}
        {w.archived ? (
          <Badge variant="outline" className="shrink-0">
            Archived
          </Badge>
        ) : null}
      </div>
      <ListCardMeta>{w.description.trim() || workspaceMeta(w)}</ListCardMeta>
    </ListCard>
  );
}

function NewWorkspaceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const toast = useToast();
  const actions = useWorkspaceActions();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Enter a name.');
      document.getElementById('new-workspace-name')?.focus();
      return;
    }
    setError(undefined);
    setPending(true);
    try {
      const ws = await actions.create({
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      toast.success('Workspace made');
      setName('');
      setDescription('');
      onOpenChange(false);
      onCreated(ws.id);
    } catch (err) {
      toast.error(workspaceErrorText(err, 'Could not make the workspace.'));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New workspace</DialogTitle>
          <DialogDescription>
            A group of users. You are its first user and a Moderator. Then add users and connectors
            on its screen.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <FieldGroup>
            <Field data-invalid={!!error || undefined}>
              <FieldLabel htmlFor="new-workspace-name">Name</FieldLabel>
              <Input
                id="new-workspace-name"
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={!!error || undefined}
                aria-describedby={error ? 'new-workspace-name-error' : undefined}
              />
              <FieldError id="new-workspace-name-error">{error}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor="new-workspace-description">Description (optional)</FieldLabel>
              <Textarea
                id="new-workspace-description"
                value={description}
                rows={3}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <SubmitButton pending={pending}>Make workspace</SubmitButton>
            </div>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
