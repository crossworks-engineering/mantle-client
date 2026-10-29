'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import type { ToolDTO } from '@mantle/client-types';
import { apiFetch, apiSend } from '@mantle/web-ui/api-fetch';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { Button } from '@mantle/web-ui/ui/button';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { Switch } from '@mantle/web-ui/ui/switch';
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
import { Input } from '@mantle/web-ui/ui/input';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@mantle/web-ui/ui/field';
import { FieldHint } from '@mantle/web-ui/ui/field-hint';
import { useToast } from '@mantle/web-ui/ui/toast';
import { ListSearchBar, ListSearchEmpty, useListQuery } from '@/components/list-search';
import { filterToolGroups } from '@/lib/tool-search';
import { ToolPicker, type ToolOption } from '@/components/tool-picker';
import {
  ToolGroupIntegrationSection,
  emptyIntegrationForm,
  integrationFormFrom,
  integrationToPayload,
  type IntegrationForm,
} from '@/components/tool-group-integration';
import {
  ListCard,
  ListCardMeta,
  ListCardSnippet,
  ListCardTitle,
} from '@mantle/web-ui/ui/list-card';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import { slugify } from '@mantle/web-ui/slugify';
import type { ToolGroupRow } from '@/lib/tool-group-links';
import { connectorKind, toolGroupSaveBody } from './tool-group-save';
import { play } from '@/lib/sounds/play';

// List items carry the agent-grant fan-out from GET /api/tool-groups.
type ToolGroupSummary = ToolGroupRow;

type FormState = {
  slug: string;
  name: string;
  description: string;
  toolSlugs: string[];
  integration: IntegrationForm;
  enabled: boolean;
};

const emptyForm = (): FormState => ({
  slug: '',
  name: '',
  description: '',
  toolSlugs: [],
  integration: emptyIntegrationForm(),
  enabled: true,
});

function fromGroup(g: ToolGroupSummary): FormState {
  return {
    slug: g.slug,
    name: g.name,
    description: g.description,
    toolSlugs: g.toolSlugs,
    integration: integrationFormFrom(g.integration),
    enabled: g.enabled,
  };
}

export function ToolGroupsClient() {
  const queryClient = useQueryClient();
  const toast = useToast();

  // ── Reads ─────────────────────────────────────────────────────────────────
  const groupsQuery = useQuery({
    queryKey: ['tool-groups'],
    queryFn: () =>
      apiFetch<{ groups: ToolGroupSummary[] }>('/api/tool-groups').then((r) => r.groups),
  });
  // Shares the ['tools'] cache with /settings/tools — projected to the picker shape.
  const toolsQuery = useQuery({
    queryKey: ['tools'],
    queryFn: () => apiFetch<{ tools: ToolDTO[] }>('/api/tools').then((r) => r.tools),
  });
  const groups = useMemo(() => groupsQuery.data ?? [], [groupsQuery.data]);
  const availableTools: ToolOption[] = useMemo(
    () =>
      (toolsQuery.data ?? []).map((t) => ({
        slug: t.slug,
        name: t.name,
        description: t.description,
        requiresConfirm: t.requiresConfirm,
        kind: t.handler.kind,
      })),
    [toolsQuery.data],
  );

  const [editing, setEditing] = useState<
    { mode: 'create' } | { mode: 'edit'; group: ToolGroupSummary } | null
  >(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [slugTouched, setSlugTouched] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ToolGroupSummary | null>(null);

  /**
   * §6b: the failure lands on the control at fault. These rules are the ones
   * `required` / `pattern` already encoded plus the integration check that used
   * to be a toast — the form is `noValidate`, the attributes stay as
   * documentation, and nothing about WHAT is valid has changed.
   */
  const [errors, setErrors] = useState<{ name?: string; slug?: string; service?: string }>({});
  const clearError = (k: 'name' | 'slug' | 'service') =>
    setErrors((cur) => {
      if (!cur[k]) return cur;
      const next = { ...cur };
      delete next[k];
      return next;
    });

  // ── Mutations ───────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: (vars: { mode: 'create' | 'edit'; id?: string; body: Record<string, unknown> }) =>
      vars.mode === 'create'
        ? apiSend('/api/tool-groups', 'POST', vars.body)
        : apiSend(`/api/tool-groups/${vars.id}`, 'PATCH', vars.body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tool-groups'] });
      setEditing(null);
      play('success');
    },
    onError: (e) => {
      play('danger');
      toast.error(e instanceof Error ? e.message : 'save failed');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiSend(`/api/tool-groups/${id}`, 'DELETE'),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['tool-groups'] });
      if (editing?.mode === 'edit' && editing.group.id === id) setEditing(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Delete failed.'),
  });

  const onName = (v: string) =>
    setForm((f) => ({
      ...f,
      name: v,
      slug: slugTouched ? f.slug : slugify(v, { allowUnderscore: true, maxLength: 64 }),
    }));

  const openCreate = () => {
    setForm(emptyForm());
    setSlugTouched(false);
    setEditing({ mode: 'create' });
  };
  const openEdit = (g: ToolGroupSummary) => {
    setForm(fromGroup(g));
    setSlugTouched(true);
    setEditing({ mode: 'edit', group: g });
  };
  const close = () => setEditing(null);
  // The connector owns a connector group's binding and tool list.
  const connector = editing?.mode === 'edit' ? connectorKind(editing.group) : null;

  const search = useListQuery();
  const shownGroups = useMemo(() => filterToolGroups(groups, search.query), [groups, search.query]);

  // Deep link: /settings/tool-groups?selected=<id-or-slug> opens that group's
  // editor once the list arrives (one-shot; selection stays client-state).
  const searchParams = useSearchParams();
  const deepLinkRef = useRef(searchParams.get('selected'));
  useEffect(() => {
    const want = deepLinkRef.current?.trim();
    if (!want || groups.length === 0) return;
    deepLinkRef.current = null;
    const hit = groups.find((g) => g.id === want || g.slug === want);
    if (hit) openEdit(hit);
  }, [groups]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;

    const integration = integrationToPayload(form.integration);
    const next: { name?: string; slug?: string; service?: string } = {};
    if (!form.name.trim()) next.name = 'A name is required.';
    if (editing.mode === 'create') {
      const slug = form.slug.trim();
      if (!slug) next.slug = 'A slug is required.';
      else if (!/^[a-z0-9_-]+$/.test(slug))
        next.slug = 'Lower-case letters, digits, hyphen and underscore only.';
    }
    // `undefined` means "enabled, but no service" — the one case the payload
    // builder refuses to encode.
    if (integration === undefined && connector === null)
      next.service = 'An integration needs a service — e.g. openweathermap.';

    if (next.name || next.slug || next.service) {
      setErrors(next);
      const first = next.name ? 'name' : next.slug ? 'slug' : 'integration-service';
      document.getElementById(first)?.focus();
      return;
    }
    setErrors({});

    // PATCH takes the whole binding (null = plain capability bundle); a
    // connector group's PATCH takes neither binding nor tools.
    const body = toolGroupSaveBody(
      editing.mode,
      { ...form, integration: integration ?? null },
      connector,
    );
    saveMutation.mutate(
      editing.mode === 'create'
        ? { mode: 'create', body }
        : { mode: 'edit', id: editing.group.id, body },
    );
  };

  const confirmDelete = () => {
    const g = deleteTarget;
    if (!g) return;
    setDeleteTarget(null);
    deleteMutation.mutate(g.id, { onSuccess: () => toast.success(`Deleted ${g.name}`) });
  };

  return (
    <>
      <MasterDetail
        id="settings-tool-groups"
        // The 360px this screen has always had.
        defaultListSize="360px"
        // No `detailFills`: the detail is a form, and the 672px default measure
        // is what keeps it off 1200px line lengths (§8).
        list={
          <>
            <div className="flex items-center justify-between gap-2 border-b border-border p-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Tool groups
              </h2>
              <Button type="button" size="sm" onClick={openCreate}>
                <Plus /> New
              </Button>
            </div>
            <ListSearchBar
              query={search.query}
              onQuery={search.setQuery}
              inputRef={search.inputRef}
              placeholder="Search tool groups…"
              shown={shownGroups.length}
              total={groupsQuery.isSuccess ? groups.length : undefined}
              noun={['tool group', 'tool groups']}
            />
            <div className="space-y-2 p-3 md:flex-1 md:overflow-y-auto md:scrollbar-thin">
              {groupsQuery.isPending ? (
                <div className="flex flex-col items-center gap-3 px-4 py-10 text-sm text-muted-foreground">
                  <Spinner size={28} />
                  Loading tool groups…
                </div>
              ) : groupsQuery.isError ? (
                <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-6 text-center text-sm text-destructive-ink">
                  <p>Couldn’t load tool groups: {groupsQuery.error.message}</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => groupsQuery.refetch()}
                  >
                    Retry
                  </Button>
                </div>
              ) : groups.length === 0 ? (
                <p className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
                  No tool groups yet. Click <strong>New</strong> to bundle some tools.
                </p>
              ) : shownGroups.length === 0 ? (
                <ListSearchEmpty noun="tool groups" onClear={search.clear} />
              ) : (
                shownGroups.map((g) => {
                  const selected = editing?.mode === 'edit' && editing.group.id === g.id;
                  const agents = g.grantedTo ?? [];
                  return (
                    <ListCard
                      key={g.id}
                      onClick={() => openEdit(g)}
                      selected={selected}
                      dimmed={!g.enabled}
                    >
                      <div className="flex items-center gap-2">
                        <ListCardTitle>{g.name}</ListCardTitle>
                        <span className="shrink-0 rounded-sm bg-muted px-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                          {g.toolSlugs.length} tool{g.toolSlugs.length === 1 ? '' : 's'}
                        </span>
                        {g.integration && (
                          <span
                            className="shrink-0 rounded-sm bg-accent px-1 text-[10px] uppercase tracking-wider text-accent-foreground"
                            title={`API integration: ${g.integration.service}${g.integration.secretRef ? ` · ${g.integration.secretRef}` : ''}`}
                          >
                            {g.integration.service}
                          </span>
                        )}
                        {!g.enabled && (
                          <span className="shrink-0 rounded-sm bg-muted px-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                            off
                          </span>
                        )}
                      </div>
                      <ListCardMeta className="font-mono">{g.slug}</ListCardMeta>
                      {g.description && <ListCardSnippet>{g.description}</ListCardSnippet>}
                      {agents.length > 0 && (
                        <div className="mt-1 text-xs text-info-ink" title={agents.join('\n')}>
                          ↳ granted to {agents.length} agent{agents.length === 1 ? '' : 's'}
                        </div>
                      )}
                    </ListCard>
                  );
                })
              )}
            </div>
          </>
        }
        // `relative` and the pane's single scroller are `MasterDetail`'s job
        // now — it owns the classes that used to be copied onto every screen.
        detail={
          editing ? (
            <div className="space-y-4 p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold">
                    {editing.mode === 'create' ? 'New tool group' : `Edit ${editing.group.name}`}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {editing.mode === 'create'
                      ? 'A named bundle of tools. Slug is immutable after creation.'
                      : 'Update the bundle. Slug is immutable.'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <Switch
                      checked={form.enabled}
                      onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
                    />
                    Enabled
                  </label>
                  {editing.mode === 'edit' && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive-ink"
                      onClick={() => setDeleteTarget(editing.group)}
                      aria-label={`Delete ${editing.group.name}`}
                      title="Delete tool group"
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </div>
              <form onSubmit={submit} noValidate>
                <FieldGroup>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field data-invalid={!!errors.name || undefined}>
                      <FieldLabel htmlFor="name">Name</FieldLabel>
                      <Input
                        id="name"
                        value={form.name}
                        onChange={(e) => {
                          onName(e.target.value);
                          clearError('name');
                        }}
                        autoFocus
                        aria-invalid={!!errors.name || undefined}
                        aria-describedby={errors.name ? 'name-error name-hint' : 'name-hint'}
                      />
                      <FieldDescription id="name-hint">
                        What this bundle is called in the list.
                      </FieldDescription>
                      <FieldError id="name-error">{errors.name}</FieldError>
                    </Field>
                    <Field data-invalid={!!errors.slug || undefined}>
                      <FieldLabel htmlFor="slug">Slug</FieldLabel>
                      <Input
                        id="slug"
                        value={form.slug}
                        onChange={(e) => {
                          setSlugTouched(true);
                          setForm((f) => ({ ...f, slug: e.target.value }));
                          clearError('slug');
                        }}
                        // Documentation of the rule; `noValidate` means it no
                        // longer raises the browser's own bubble. See submit().
                        pattern="[a-z0-9_\-]+"
                        disabled={editing?.mode === 'edit'}
                        aria-invalid={!!errors.slug || undefined}
                        aria-describedby={errors.slug ? 'slug-error slug-hint' : 'slug-hint'}
                      />
                      <FieldDescription id="slug-hint">
                        How an agent grants this bundle. Fixed once saved.
                      </FieldDescription>
                      <FieldError id="slug-error">{errors.slug}</FieldError>
                    </Field>
                  </div>

                  <Field>
                    <FieldLabel htmlFor="description">
                      Description (what this bundle is for)
                    </FieldLabel>
                    <Input
                      id="description"
                      value={form.description}
                      onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                      placeholder="Calendar — event CRUD"
                      aria-describedby="description-hint"
                    />
                    <FieldDescription id="description-hint">
                      What the tools in here have in common — helps you pick the right bundle to
                      grant.
                    </FieldDescription>
                  </Field>

                  {connector !== null ? null : editing.mode === 'edit' ? (
                    <ToolGroupIntegrationSection
                      value={form.integration}
                      onChange={(next) => {
                        setForm((f) => ({ ...f, integration: next }));
                        clearError('service');
                      }}
                      serviceError={errors.service}
                    />
                  ) : (
                    <p className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                      Create the group first, then bind it to an API (base URL, credential, docs)
                      here — or just ask Toolsmith to build the integration and it sets all of this
                      up.
                    </p>
                  )}

                  <Field>
                    {/* Labels the PICKER, not one control, so there is no
                      `htmlFor` to give — `asChild` keeps the type without
                      minting a label that names nothing. */}
                    <FieldLabel asChild>
                      <span>Tools in this group</span>
                    </FieldLabel>
                    {/* Still `FieldHint`: `warn` is the only thing that says the
                      cost of getting this one wrong, in a second tone. */}
                    <FieldHint warn="Granting this bundle grants every tool in it.">
                      Everything an agent gets when you give it this group.
                    </FieldHint>
                    {connector !== null ? (
                      <ConnectorToolList
                        kind={connector}
                        toolSlugs={form.toolSlugs}
                        names={availableTools}
                      />
                    ) : toolsQuery.isError ? (
                      <p className="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">
                        <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                        Couldn’t load the tool list.
                        <RowButton
                          onClick={() => toolsQuery.refetch()}
                          className="ml-auto shrink-0 underline underline-offset-2 hover:text-foreground"
                        >
                          Retry
                        </RowButton>
                      </p>
                    ) : toolsQuery.isPending ? (
                      <p className="text-xs text-muted-foreground">Loading tools…</p>
                    ) : availableTools.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No tools registered yet. Start <code>pnpm dev</code> to seed built-ins.
                      </p>
                    ) : (
                      <ToolPicker
                        // A fresh filter for each group the editor opens.
                        key={editing.mode === 'edit' ? editing.group.id : 'new'}
                        available={availableTools}
                        selected={form.toolSlugs}
                        onChange={(next) => setForm((f) => ({ ...f, toolSlugs: next }))}
                      />
                    )}
                    <FieldDescription>
                      When an agent is granted this group, every tool here joins its effective tool
                      set — plus the integration&apos;s usage skill, if it has one. No other
                      instructions: behaviour still belongs to skills.
                    </FieldDescription>
                  </Field>

                  <div className="flex justify-end gap-2 border-t border-border pt-3">
                    <Button type="button" variant="outline" onClick={close}>
                      Cancel
                    </Button>
                    <SubmitButton pending={saveMutation.isPending}>
                      {editing.mode === 'create' ? 'Create group' : 'Save group'}
                    </SubmitButton>
                  </div>
                </FieldGroup>
              </form>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-10 text-center text-sm text-muted-foreground">
              Select a tool group to edit, or create a new one.
            </div>
          )
        }
      />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                const refs = deleteTarget?.grantedTo ?? [];
                if (refs.length === 0) return 'This cannot be undone.';
                return `Granted to ${refs.length} agent${refs.length === 1 ? '' : 's'} (${refs.join(', ')}) — the grant will be removed from ${refs.length === 1 ? 'it' : 'them'}. This cannot be undone.`;
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * A connector group's tools, read-only. The connector's sync writes this list
 * and the brain refuses changes to it here, so there is no picker to try.
 */
function ConnectorToolList({
  kind,
  toolSlugs,
  names,
}: {
  kind: 'mcp' | 'openapi';
  toolSlugs: string[];
  names: ToolOption[];
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        The connector manages this list. Change it in{' '}
        <Link href="/settings/connectors" className="underline underline-offset-2">
          Settings &gt; Connectors
        </Link>
        .
      </p>
      {toolSlugs.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No tools yet. The {kind === 'mcp' ? 'MCP' : 'OpenAPI'} connector adds them when it syncs.
        </p>
      ) : (
        <ToolPicker readOnly available={names} selected={toolSlugs} />
      )}
    </div>
  );
}
