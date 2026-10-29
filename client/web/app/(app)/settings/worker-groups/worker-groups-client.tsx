'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { apiFetch, apiSend } from '@mantle/web-ui/api-fetch';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { Button } from '@mantle/web-ui/ui/button';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { Switch } from '@mantle/web-ui/ui/switch';
import { Checkbox } from '@mantle/web-ui/ui/checkbox';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@mantle/web-ui/ui/dialog';
import { Input } from '@mantle/web-ui/ui/input';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@mantle/web-ui/ui/field';
import { useToast } from '@mantle/web-ui/ui/toast';
import { ListCard, ListCardMeta, ListCardTitle } from '@mantle/web-ui/ui/list-card';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import { cn } from '@mantle/web-ui/lib/utils';
import { slugify } from '@mantle/web-ui/slugify';
import { play } from '@/lib/sounds/play';

type WorkerGroup = {
  id: string;
  slug: string;
  name: string;
  memberSlugs: string[];
  enabled: boolean;
};
type WorkerAgentOption = { slug: string; name: string };
type Payload = { groups: WorkerGroup[]; workers: WorkerAgentOption[] };

const MAX_MEMBERS = 10;

export function WorkerGroupsClient() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const dataQuery = useQuery({
    queryKey: ['worker-groups'],
    queryFn: () => apiFetch<Payload>('/api/settings/worker-groups'),
  });
  const groups = useMemo(() => dataQuery.data?.groups ?? [], [dataQuery.data]);
  const workers = useMemo(() => dataQuery.data?.workers ?? [], [dataQuery.data]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = groups.find((g) => g.id === selectedId) ?? null;

  // Detail-form draft (name / members / enabled) for the selected group.
  const [draftName, setDraftName] = useState('');
  const [draftMembers, setDraftMembers] = useState<string[]>([]);
  const [draftEnabled, setDraftEnabled] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<WorkerGroup | null>(null);

  // Create dialog state.
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);

  /**
   * Validation lives here rather than on `required` / `pattern` because the
   * browser's own bubble is not the failure this screen owes the user (§6b):
   * it points at nothing a screen reader announces, it vanishes on the next
   * click, and it cannot say WHICH rule a slug broke. Both forms are
   * `noValidate` for the same reason — the attributes stay as documentation of
   * the rule, but they no longer drive the message.
   *
   * The rules are unchanged from the ones those attributes encoded. This is a
   * port, not a new policy.
   */
  const [detailErrors, setDetailErrors] = useState<{ name?: string }>({});
  const [createErrors, setCreateErrors] = useState<{ name?: string; slug?: string }>({});

  const SLUG_RE = /^[a-z0-9_-]+$/;

  const openGroup = (g: WorkerGroup) => {
    setSelectedId(g.id);
    setDraftName(g.name);
    setDraftMembers(g.memberSlugs);
    setDraftEnabled(g.enabled);
  };

  const createMutation = useMutation({
    mutationFn: (body: { slug: string; name: string }) =>
      apiSend<{ group: WorkerGroup }>('/api/settings/worker-groups', 'POST', body),
    onSuccess: async ({ group }) => {
      await queryClient.invalidateQueries({ queryKey: ['worker-groups'] });
      setCreateOpen(false);
      setNewName('');
      setNewSlug('');
      setSlugTouched(false);
      openGroup(group);
      toast.success(`Created ${group.name}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Create failed.'),
  });

  const saveMutation = useMutation({
    mutationFn: (vars: { id: string; body: Record<string, unknown> }) =>
      apiSend<{ group: WorkerGroup }>(`/api/settings/worker-groups/${vars.id}`, 'PATCH', vars.body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['worker-groups'] });
      play('success');
      toast.success('Saved worker group');
    },
    onError: (e) => {
      play('danger');
      toast.error(e instanceof Error ? e.message : 'Save failed.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiSend(`/api/settings/worker-groups/${id}`, 'DELETE'),
    onSuccess: (_d, id) => {
      queryClient.invalidateQueries({ queryKey: ['worker-groups'] });
      if (selectedId === id) setSelectedId(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Delete failed.'),
  });

  const toggleMember = (slug: string) =>
    setDraftMembers((cur) => (cur.includes(slug) ? cur.filter((s) => s !== slug) : [...cur, slug]));

  const submitDetail = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    const name = draftName.trim();
    if (!name) {
      setDetailErrors({ name: 'A name is required.' });
      return;
    }
    setDetailErrors({});
    saveMutation.mutate({
      id: selected.id,
      body: { name, memberSlugs: draftMembers, enabled: draftEnabled },
    });
  };

  const submitCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    const slug = newSlug.trim();
    const errs: { name?: string; slug?: string } = {};
    if (!name) errs.name = 'A name is required.';
    if (!slug) errs.slug = 'A slug is required.';
    else if (!SLUG_RE.test(slug))
      errs.slug = 'Lower-case letters, digits, hyphen and underscore only.';
    else if (slug.length > 64) errs.slug = 'Keep the slug to 64 characters or fewer.';
    if (errs.name || errs.slug) {
      setCreateErrors(errs);
      return;
    }
    setCreateErrors({});
    createMutation.mutate({ slug, name });
  };

  return (
    <>
      <MasterDetail
        id="settings-worker-groups"
        // The 360px this screen has always had. The cluster splits 340/360 for
        // no reason anyone recorded, so each screen keeps its own rather than
        // snapping to the default — and it is a starting point now, not a rule.
        defaultListSize="360px"
        // No `detailFills`: the detail is a FORM, and the default 672px measure
        // is exactly what stops it running to 1200px line lengths on a wide
        // display (§8). The spacer takes the slack.
        list={
          <>
            <div className="flex items-center justify-between gap-2 border-b border-border p-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Worker groups
              </h2>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setNewName('');
                  setNewSlug('');
                  setSlugTouched(false);
                  setCreateOpen(true);
                }}
              >
                <Plus /> New
              </Button>
            </div>
            <div className="space-y-2 p-3 md:flex-1 md:overflow-y-auto md:scrollbar-thin">
              {dataQuery.isPending ? (
                <div className="flex flex-col items-center gap-3 px-4 py-10 text-sm text-muted-foreground">
                  <Spinner size={28} />
                  Loading worker groups…
                </div>
              ) : dataQuery.isError ? (
                <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-6 text-center text-sm text-destructive-ink">
                  <p>Couldn’t load worker groups: {dataQuery.error.message}</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => dataQuery.refetch()}
                  >
                    Retry
                  </Button>
                </div>
              ) : groups.length === 0 ? (
                <p className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
                  No worker groups yet. Click <strong>New</strong> to bundle worker agents into a
                  panel.
                </p>
              ) : (
                groups.map((g) => (
                  <ListCard
                    key={g.id}
                    onClick={() => openGroup(g)}
                    selected={selectedId === g.id}
                    dimmed={!g.enabled}
                  >
                    <div className="flex items-center gap-2">
                      <ListCardTitle>{g.name}</ListCardTitle>
                      <span className="shrink-0 rounded-sm bg-muted px-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {g.memberSlugs.length} member{g.memberSlugs.length === 1 ? '' : 's'}
                      </span>
                      {!g.enabled && (
                        <span className="shrink-0 rounded-sm bg-muted px-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                          off
                        </span>
                      )}
                    </div>
                    <ListCardMeta className="font-mono">{g.slug}</ListCardMeta>
                  </ListCard>
                ))
              )}
            </div>
          </>
        }
        detail={
          selected ? (
            <div className="space-y-4 p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold">Edit {selected.name}</h2>
                  <p className="font-mono text-xs text-muted-foreground">{selected.slug}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <Switch checked={draftEnabled} onCheckedChange={setDraftEnabled} />
                    Enabled
                  </label>
                  {/* §8: icon-only, grey until hover, and LAST in the row.
                    Phase 1 fixed the colour and deliberately left the word. */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive-ink"
                    onClick={() => setDeleteTarget(selected)}
                    aria-label={`Delete ${selected.name}`}
                    title="Delete worker group"
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>

              <form onSubmit={submitDetail} noValidate>
                <FieldGroup>
                  <Field data-invalid={!!detailErrors.name || undefined}>
                    <FieldLabel htmlFor="wg-name">Name</FieldLabel>
                    <Input
                      id="wg-name"
                      value={draftName}
                      onChange={(e) => {
                        setDraftName(e.target.value);
                        if (detailErrors.name) setDetailErrors({});
                      }}
                      aria-invalid={!!detailErrors.name || undefined}
                      aria-describedby={
                        detailErrors.name ? 'wg-name-error wg-name-hint' : 'wg-name-hint'
                      }
                    />
                    <FieldDescription id="wg-name-hint">
                      What this pool of workers is called.
                    </FieldDescription>
                    <FieldError id="wg-name-error">{detailErrors.name}</FieldError>
                  </Field>

                  <Field>
                    {/* Labels a GROUP of checkboxes, not one control, so there is
                      no `htmlFor` to give — `asChild` keeps the type without
                      minting a label that names nothing. */}
                    <FieldLabel asChild>
                      <span>Members (enabled worker agents)</span>
                    </FieldLabel>
                    <FieldDescription>
                      Which workers a run may hand steps to. Only enabled ones appear here.
                    </FieldDescription>
                    {workers.length === 0 ? (
                      <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                        No enabled worker agents yet. Create one under{' '}
                        <a href="/settings/agents" className="underline hover:text-foreground">
                          Agents
                        </a>{' '}
                        (role <code>worker</code>) first.
                      </p>
                    ) : (
                      <div className="space-y-1 rounded-md border border-border p-2">
                        {workers.map((w) => {
                          const checked = draftMembers.includes(w.slug);
                          const atCap = !checked && draftMembers.length >= MAX_MEMBERS;
                          return (
                            <label
                              key={w.slug}
                              className={cn(
                                'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/50',
                                atCap && 'cursor-not-allowed opacity-50',
                              )}
                            >
                              <Checkbox
                                checked={checked}
                                disabled={atCap}
                                onCheckedChange={() => toggleMember(w.slug)}
                              />
                              <span className="truncate">{w.name}</span>
                              <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                                {w.slug}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                    <FieldDescription>
                      A run step with <code>group:{selected.slug}</code> fans out into one attempt
                      per member plus a panel audit. 1–{MAX_MEMBERS} members.
                    </FieldDescription>
                  </Field>

                  <div className="flex justify-end gap-2 border-t border-border pt-3">
                    <SubmitButton pending={saveMutation.isPending}>Save worker group</SubmitButton>
                  </div>
                </FieldGroup>
              </form>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-10 text-center text-sm text-muted-foreground">
              Select a worker group to edit, or create a new one.
            </div>
          )
        }
      />

      {/* Create dialog — slug + name; members added in the detail form. */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New worker group</DialogTitle>
            <DialogDescription>
              A named set of worker agents. The slug is immutable; add members after creating.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitCreate} noValidate>
            <FieldGroup>
              <Field data-invalid={!!createErrors.name || undefined}>
                <FieldLabel htmlFor="wg-new-name">Name</FieldLabel>
                <Input
                  id="wg-new-name"
                  value={newName}
                  autoFocus
                  onChange={(e) => {
                    const v = e.target.value;
                    setNewName(v);
                    if (!slugTouched)
                      setNewSlug(slugify(v, { allowUnderscore: true, maxLength: 64 }));
                    if (createErrors.name) setCreateErrors({ ...createErrors, name: undefined });
                  }}
                  aria-invalid={!!createErrors.name || undefined}
                  aria-describedby={
                    createErrors.name ? 'wg-new-name-error wg-new-name-hint' : 'wg-new-name-hint'
                  }
                />
                <FieldDescription id="wg-new-name-hint">
                  What this pool of workers is called.
                </FieldDescription>
                <FieldError id="wg-new-name-error">{createErrors.name}</FieldError>
              </Field>

              <Field data-invalid={!!createErrors.slug || undefined}>
                <FieldLabel htmlFor="wg-new-slug">Slug</FieldLabel>
                <Input
                  id="wg-new-slug"
                  value={newSlug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setNewSlug(e.target.value);
                    if (createErrors.slug) setCreateErrors({ ...createErrors, slug: undefined });
                  }}
                  // Kept as documentation of the rule; `noValidate` on the form
                  // means they no longer drive the message. See submitCreate.
                  pattern="[a-z0-9_\-]+"
                  maxLength={64}
                  aria-invalid={!!createErrors.slug || undefined}
                  aria-describedby={
                    createErrors.slug ? 'wg-new-slug-error wg-new-slug-hint' : 'wg-new-slug-hint'
                  }
                />
                <FieldDescription id="wg-new-slug-hint">
                  How a run references this group. Fixed once created.
                </FieldDescription>
                <FieldError id="wg-new-slug-error">{createErrors.slug}</FieldError>
              </Field>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                  Cancel
                </Button>
                <SubmitButton pending={createMutation.isPending}>Create worker group</SubmitButton>
              </div>
            </FieldGroup>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Runs that named this group keep their history, but new plans can no longer fan out to
              it. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const g = deleteTarget;
                if (!g) return;
                setDeleteTarget(null);
                deleteMutation.mutate(g.id, {
                  onSuccess: () => toast.success(`Deleted ${g.name}`),
                });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
