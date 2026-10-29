'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import type { ToolHandler, ToolSettings } from '@mantle/client-types';
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
import { Textarea } from '@mantle/web-ui/ui/textarea';
import { Label } from '@mantle/web-ui/ui/label';
import { Field, FieldError, FieldLabel } from '@mantle/web-ui/ui/field';
import { FieldHint } from '@mantle/web-ui/ui/field-hint';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@mantle/web-ui/ui/select';
import { useToast } from '@mantle/web-ui/ui/toast';
import { ListCard, ListCardSnippet } from '@mantle/web-ui/ui/list-card';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import { cn } from '@mantle/web-ui/lib/utils';
import { slugify } from '@mantle/web-ui/slugify';
import { ListSearchBar, ListSearchEmpty, useListQuery } from '@/components/list-search';
import { filterTools } from '@/lib/tool-search';
import { connectorOff, groupsHolding, type ToolGroupRow } from '@/lib/tool-group-links';
import { ExternalAccessSection, type ToolWithExternalAccess } from './external-access-section';
import { toolAccessBadge } from '@/lib/tool-access-copy';
import { ConnectorOffNote, ToolGroupsOfTool } from './tool-groups-of-tool';
import { play } from '@/lib/sounds/play';

type ToolSummary = ToolWithExternalAccess;

type FormKind = 'http' | 'shell';

/**
 * Handlers this form cannot edit: builtins are code-backed, recipes are step
 * chains the Toolsmith authors, and mcp rows mirror a connector's remote tool
 * (the server refuses a handler patch on them). For all three, Save sends only
 * Enabled and Requires-confirm.
 */
function isLockedHandler(h: ToolHandler): boolean {
  return h.kind === 'builtin' || h.kind === 'recipe' || h.kind === 'mcp';
}

type FormState = {
  slug: string;
  name: string;
  description: string;
  kind: FormKind;
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headersJson: string; // JSON object — header → value template
  queryJson: string; // JSON object — query key → value template
  bodyTemplate: string;
  cmd: string;
  inputSchemaJson: string;
  requiresConfirm: boolean;
  enabled: boolean;
};

const emptyForm = (): FormState => ({
  slug: '',
  name: '',
  description: '',
  kind: 'http',
  url: '',
  method: 'POST',
  headersJson: '',
  queryJson: '',
  bodyTemplate: '',
  cmd: '',
  inputSchemaJson: '{\n  "type": "object",\n  "properties": {}\n}',
  requiresConfirm: false,
  enabled: true,
});

function fromTool(t: ToolSummary): FormState {
  const http = t.handler.kind === 'http' ? t.handler : null;
  return {
    slug: t.slug,
    name: t.name,
    description: t.description,
    kind: t.handler.kind === 'shell' ? 'shell' : 'http',
    url: http?.url ?? '',
    method: http?.method ?? 'POST',
    headersJson: http?.headers ? JSON.stringify(http.headers, null, 2) : '',
    queryJson: http?.query ? JSON.stringify(http.query, null, 2) : '',
    bodyTemplate: http?.body ?? '',
    cmd: t.handler.kind === 'shell' ? t.handler.cmd : '',
    inputSchemaJson: JSON.stringify(t.inputSchema ?? {}, null, 2),
    requiresConfirm: t.requiresConfirm,
    enabled: t.enabled,
  };
}

/** Parse an optional JSON-object textarea; '' → undefined; throws on junk. */
/**
 * Which controls are at fault. Keys are the control ids, so a failure can be
 * put on the control that produced it (§6b) and a test can find it by id.
 */
type ToolErrors = {
  name?: string;
  slug?: string;
  description?: string;
  url?: string;
  cmd?: string;
  schema?: string;
  'http-headers'?: string;
  'http-query'?: string;
};

/** DOM order, so the caret lands on the FIRST thing that is wrong. */
const ERROR_ORDER = [
  'name',
  'slug',
  'description',
  'url',
  'cmd',
  'http-headers',
  'http-query',
  'schema',
] as const;

/**
 * §6b. Three of this screen's failures were toasts carrying a PARSER message —
 * "Input schema is not valid JSON.", and whatever `parseRecordField` threw for
 * Headers/Query. Those are the worst kind to put in a corner: you have to read
 * them against the JSON you just typed, and the toast is gone before you look
 * back. Every rule below is the one `required` / `pattern` / the toasts already
 * encoded; only the delivery changed.
 *
 * Pure, and called from two places: once on submit, and again on every change
 * after the first failed submit, so a field stops complaining the moment it is
 * fixed without nine hand-wired `onChange` handlers.
 */
function validateTool(
  form: FormState,
  editing: { mode: 'create' } | { mode: 'edit'; tool: ToolSummary },
): ToolErrors {
  const errs: ToolErrors = {};
  // Locked handlers send only their editable metadata, so none of the rules
  // below apply: their handler, slug and schema are not this form's to write.
  if (editing.mode === 'edit' && isLockedHandler(editing.tool.handler)) return errs;

  if (!form.name.trim()) errs.name = 'A name is required.';
  if (!form.description.trim()) errs.description = 'A description is required.';
  if (editing.mode === 'create') {
    const slug = form.slug.trim();
    if (!slug) errs.slug = 'A slug is required.';
    else if (!/^[a-z0-9_-]+$/.test(slug))
      errs.slug = 'Lower-case letters, digits, hyphen and underscore only.';
  }
  if (form.kind === 'shell') {
    if (!form.cmd.trim()) errs.cmd = 'A command template is required.';
  } else if (!form.url.trim()) {
    errs.url = 'A URL template is required.';
  }
  try {
    JSON.parse(form.inputSchemaJson);
  } catch (err) {
    errs.schema = `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`;
  }
  if (form.kind !== 'shell') {
    for (const [key, label, raw] of [
      ['http-headers', 'Headers', form.headersJson],
      ['http-query', 'Query', form.queryJson],
    ] as const) {
      try {
        parseRecordField(label, raw);
      } catch (err) {
        errs[key] = err instanceof Error ? err.message : `${label} must be a JSON object.`;
      }
    }
  }
  return errs;
}

function parseRecordField(label: string, raw: string): Record<string, string> | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const parsed = JSON.parse(trimmed) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object of string values`);
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v !== 'string') throw new Error(`${label}.${k} must be a string`);
    out[k] = v;
  }
  return out;
}

const DEFAULT_SETTINGS: ToolSettings = { requireApproval: false, egressGate: false };

export function ToolsClient() {
  const queryClient = useQueryClient();
  const toast = useToast();

  // ── Reads ─────────────────────────────────────────────────────────────────
  const toolsQuery = useQuery({
    queryKey: ['tools'],
    queryFn: () => apiFetch<{ tools: ToolSummary[] }>('/api/tools').then((r) => r.tools),
  });
  const settingsQuery = useQuery({
    queryKey: ['tools', 'settings'],
    queryFn: () => apiFetch<ToolSettings>('/api/tools/settings'),
  });
  // Shares the ['tool-groups'] cache with /settings/tool-groups: a level set
  // there shows here at once.
  const groupsQuery = useQuery({
    queryKey: ['tool-groups'],
    queryFn: () => apiFetch<{ groups: ToolGroupRow[] }>('/api/tool-groups').then((r) => r.groups),
  });
  const tools = useMemo(() => toolsQuery.data ?? [], [toolsQuery.data]);
  const settings = settingsQuery.data ?? DEFAULT_SETTINGS;

  const [editing, setEditing] = useState<
    { mode: 'create' } | { mode: 'edit'; tool: ToolSummary } | null
  >(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [slugTouched, setSlugTouched] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ToolSummary | null>(null);
  const [errors, setErrors] = useState<ToolErrors>({});
  // Only complain AFTER a submit has failed. Validating from the first
  // keystroke would mark an empty form red before the user has done anything.
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    if (!submitted || !editing) return;
    setErrors(validateTool(form, editing));
  }, [submitted, form, editing]);

  // ── Mutations ───────────────────────────────────────────────────────────────
  // Settings toggles — optimistic: flip the cached value immediately, roll back
  // on error. (Replaces the old useState + server action + manual rollback.)
  const settingsMutation = useMutation({
    mutationFn: (patch: Partial<ToolSettings>) =>
      apiSend<ToolSettings>('/api/tools/settings', 'PUT', patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: ['tools', 'settings'] });
      const prev = queryClient.getQueryData<ToolSettings>(['tools', 'settings']);
      queryClient.setQueryData<ToolSettings>(['tools', 'settings'], (old) => ({
        ...(old ?? DEFAULT_SETTINGS),
        ...patch,
      }));
      return { prev };
    },
    onError: (e, _patch, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['tools', 'settings'], ctx.prev);
      toast.error(e instanceof Error && e.message ? e.message : 'Could not save that setting');
    },
    onSuccess: (data) => queryClient.setQueryData(['tools', 'settings'], data),
  });

  const toggleRequireApproval = (next: boolean) =>
    settingsMutation.mutate(
      { requireApproval: next },
      {
        onSuccess: () =>
          toast.success(
            next
              ? 'Agent-built tools will now require your approval'
              : 'Agent-built tools no longer require approval',
          ),
      },
    );
  const toggleEgressGate = (next: boolean) =>
    settingsMutation.mutate(
      { egressGate: next },
      {
        onSuccess: () =>
          toast.success(
            next
              ? 'Unattended heartbeats will now park email/web for approval'
              : 'Unattended heartbeats run email/web inline again',
          ),
      },
    );

  const saveMutation = useMutation({
    mutationFn: (vars: { mode: 'create' | 'edit'; id?: string; body: Record<string, unknown> }) =>
      vars.mode === 'create'
        ? apiSend('/api/tools', 'POST', vars.body)
        : apiSend(`/api/tools/${vars.id}`, 'PATCH', vars.body),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['tools'] });
      setEditing(null);
      play('success');
      toast.success(vars.mode === 'create' ? 'Tool created' : 'Tool saved');
    },
    onError: (e) => {
      play('danger');
      toast.error(e instanceof Error ? e.message : 'Save failed.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiSend(`/api/tools/${id}`, 'DELETE'),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['tools'] });
      if (editing?.mode === 'edit' && editing.tool.id === id) setEditing(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Delete failed.'),
  });

  // Search. A connector tool also matches its group's display name (from
  // groupsQuery above, the ['tool-groups'] cache).
  const groupNames = useMemo(
    () => new Map((groupsQuery.data ?? []).map((g) => [g.slug, g.name])),
    [groupsQuery.data],
  );
  const search = useListQuery();
  const shown = useMemo(
    () => filterTools(tools, search.query, groupNames),
    [tools, search.query, groupNames],
  );
  const filtering = search.query.trim() !== '';

  const builtins = shown.filter((t) => t.handler.kind === 'builtin');
  const userDefined = shown.filter((t) => t.handler.kind !== 'builtin');

  const editTool = editing?.mode === 'edit' ? editing.tool : null;
  const isBuiltin = editTool?.handler.kind === 'builtin';
  const isRecipe = editTool?.handler.kind === 'recipe';
  const isMcp = editTool?.handler.kind === 'mcp';
  // Recipe, mcp and builtin handlers aren't editable via this form (a recipe
  // is a step chain authored by the Toolsmith, delete + recreate to change it;
  // an mcp row mirrors a connector's remote tool and its sync owns it); only
  // Enabled / Requires-confirm toggle. Recipes stay deletable (they're
  // user-defined); builtins and mcp rows don't (the server refuses deleting a
  // connector-mirrored tool), so Delete keys off canDelete, not !isReadOnly.
  const isReadOnly = editTool ? isLockedHandler(editTool.handler) : false;
  const canDelete = !isBuiltin && !isMcp;
  const selectedId = editTool?.id ?? null;
  const settingsBusy = settingsQuery.isPending || settingsMutation.isPending;

  const openCreate = () => {
    setForm(emptyForm());
    setSlugTouched(false);
    setEditing({ mode: 'create' });
  };
  const openEdit = (t: ToolSummary) => {
    setForm(fromTool(t));
    setSlugTouched(true);
    setEditing({ mode: 'edit', tool: t });
  };
  const close = () => setEditing(null);

  // Deep link: /settings/tools?selected=<id-or-slug> opens that tool's
  // editor once the list arrives (one-shot; selection stays client-state).
  const searchParams = useSearchParams();
  const deepLinkRef = useRef(searchParams.get('selected'));
  useEffect(() => {
    const want = deepLinkRef.current?.trim();
    if (!want || tools.length === 0) return;
    deepLinkRef.current = null;
    const hit = tools.find((t) => t.id === want || t.slug === want);
    if (hit) openEdit(hit);
  }, [tools]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;

    /**
     * §6b. Three of this screen's failures were toasts carrying a PARSER
     * message — "Input schema is not valid JSON.", and whatever
     * `parseRecordField` threw for Headers/Query. Those are the worst kind to
     * put in a corner: you have to read them against the JSON you just typed,
     * and the toast is gone before you look back. Everything below lands on the
     * textarea that produced it. `required` / `pattern` are documentation now;
     * the form is `noValidate`.
     */
    const errs = validateTool(form, editing);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      setSubmitted(true);
      const first = ERROR_ORDER.find((k) => errs[k]);
      if (first) document.getElementById(first)?.focus();
      return;
    }
    setSubmitted(true);
    setErrors({});

    // Locked handlers (builtin, recipe, mcp): only the editable metadata is
    // sent. Everything else uses the full body.
    let body: Record<string, unknown>;
    if (editing.mode === 'edit' && isLockedHandler(editing.tool.handler)) {
      body = {
        requiresConfirm: form.requiresConfirm,
        enabled: form.enabled,
      };
    } else {
      // Already validated above; this parse cannot throw. Kept as a parse
      // rather than a cast so a future edit that skips validation still fails
      // loudly here instead of sending garbage.
      const inputSchema: Record<string, unknown> = JSON.parse(form.inputSchemaJson);
      let handler: ToolHandler;
      if (form.kind === 'shell') {
        handler = { kind: 'shell', cmd: form.cmd };
      } else {
        // Validated above too — same reasoning as the schema parse.
        const headers = parseRecordField('Headers', form.headersJson);
        const query = parseRecordField('Query', form.queryJson);
        // Preserve handler fields that have no form input (e.g. timeoutMs set
        // via the API/Toolsmith) — the PATCH replaces the whole handler jsonb,
        // so an unmapped field would be silently dropped on save.
        const priorHttp =
          editing.mode === 'edit' && editing.tool.handler.kind === 'http'
            ? editing.tool.handler
            : null;
        handler = {
          kind: 'http',
          url: form.url,
          method: form.method,
          ...(headers ? { headers } : {}),
          ...(query ? { query } : {}),
          ...(form.bodyTemplate.trim() ? { body: form.bodyTemplate } : {}),
          ...(priorHttp?.timeoutMs !== undefined ? { timeoutMs: priorHttp.timeoutMs } : {}),
        };
      }
      body = {
        name: form.name.trim(),
        description: form.description.trim(),
        inputSchema,
        handler,
        requiresConfirm: form.requiresConfirm,
        enabled: form.enabled,
        ...(editing.mode === 'create' ? { slug: form.slug.trim() } : {}),
      };
    }

    saveMutation.mutate(
      editing.mode === 'create'
        ? { mode: 'create', body }
        : { mode: 'edit', id: editing.tool.id, body },
    );
  };

  const confirmDelete = () => {
    const t = deleteTarget;
    if (!t) return;
    setDeleteTarget(null);
    deleteMutation.mutate(t.id, { onSuccess: () => toast.success(`Deleted ${t.slug}`) });
  };

  return (
    <>
      <MasterDetail
        id="settings-tools"
        // The 360px this screen has always had.
        defaultListSize="360px"
        // No `detailFills`: the detail is a form, and the 672px default measure
        // is what keeps it off 1200px line lengths (§8).
        list={
          <>
            <ListSearchBar
              query={search.query}
              onQuery={search.setQuery}
              inputRef={search.inputRef}
              placeholder="Search tools…"
              shown={shown.length}
              total={toolsQuery.isSuccess ? tools.length : undefined}
              noun={['tool', 'tools']}
            />
            <div className="space-y-4 p-3 md:flex-1 md:overflow-y-auto md:scrollbar-thin">
              {toolsQuery.isPending ? (
                <div className="flex flex-col items-center gap-3 px-4 py-10 text-sm text-muted-foreground">
                  <Spinner size={28} />
                  Loading tools…
                </div>
              ) : toolsQuery.isError ? (
                <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-6 text-center text-sm text-destructive-ink">
                  <p>Couldn’t load tools: {toolsQuery.error.message}</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => toolsQuery.refetch()}
                  >
                    Retry
                  </Button>
                </div>
              ) : filtering && shown.length === 0 ? (
                <ListSearchEmpty noun="tools" onClear={search.clear} />
              ) : (
                <>
                  <section className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 px-1">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        User-defined ({userDefined.length})
                      </h3>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs"
                        onClick={openCreate}
                      >
                        <Plus /> New
                      </Button>
                    </div>
                    {userDefined.length === 0 ? (
                      <p className="px-1 text-xs text-muted-foreground/60">
                        {filtering ? 'None match.' : 'None yet.'}
                      </p>
                    ) : (
                      userDefined.map((t) => (
                        <ToolCard
                          key={t.id}
                          tool={t}
                          selected={selectedId === t.id}
                          onClick={() => openEdit(t)}
                        />
                      ))
                    )}
                  </section>

                  {(builtins.length > 0 || !filtering) && (
                    <section className="space-y-1.5">
                      <h3 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Built-in ({builtins.length})
                      </h3>
                      {builtins.map((t) => (
                        <ToolCard
                          key={t.id}
                          tool={t}
                          selected={selectedId === t.id}
                          onClick={() => openEdit(t)}
                        />
                      ))}
                    </section>
                  )}
                </>
              )}

              {settingsQuery.isError && (
                <p className="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">
                  <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                  Couldn’t load tool policy settings — showing defaults.
                  <RowButton
                    onClick={() => settingsQuery.refetch()}
                    className="ml-auto shrink-0 underline underline-offset-2 hover:text-foreground"
                  >
                    Retry
                  </RowButton>
                </p>
              )}

              <section className="rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Label htmlFor="require-approval" className="text-xs font-medium">
                      Require my approval for agent-built tools
                    </Label>
                    <FieldHint
                      id="require-approval"
                      className="mt-1 leading-relaxed"
                      warn="Off, a tool the agent wrote itself runs unseen on its first call."
                    >
                      When on, a tool an agent builds (via Toolsmith) parks each call for your
                      approval until you clear <span className="font-medium">requires confirm</span>{' '}
                      for it. Turn on if an agent that reads email or the web can author tools.
                    </FieldHint>
                  </div>
                  <Switch
                    id="require-approval"
                    checked={settings.requireApproval}
                    disabled={settingsBusy}
                    onCheckedChange={toggleRequireApproval}
                    className="mt-0.5 shrink-0"
                  />
                </div>
              </section>

              <section className="rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Label htmlFor="egress-gate" className="text-xs font-medium">
                      Approve email &amp; web during unattended heartbeats
                    </Label>
                    <FieldHint
                      id="egress-gate"
                      className="mt-1 leading-relaxed"
                      warn="Off, an unattended heartbeat can send mail or fetch the web with nobody watching."
                    >
                      When on, a heartbeat that fires while you&apos;re away parks any{' '}
                      <span className="font-medium">email or web</span> call for your approval
                      instead of running it inline. You can clear it from the Telegram card on your
                      phone. The heartbeat&apos;s own message reply is unaffected.
                    </FieldHint>
                  </div>
                  <Switch
                    id="egress-gate"
                    checked={settings.egressGate}
                    disabled={settingsBusy}
                    onCheckedChange={toggleEgressGate}
                    className="mt-0.5 shrink-0"
                  />
                </div>
              </section>
            </div>
          </>
        }
        // `relative` and the pane's single scroller are `MasterDetail`'s job now.
        detail={
          !editing ? (
            <div className="flex h-full items-center justify-center p-10 text-center text-sm text-muted-foreground">
              Select a tool to view or edit, or create a new one.
            </div>
          ) : (
            <div className="space-y-4 p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold">
                    {editing.mode === 'create' ? 'New tool' : editing.tool.slug}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {isBuiltin
                      ? 'Built-in (code-backed). Name, description, and schema are defined in code (read-only) — toggle Enabled and Requires-confirm here.'
                      : isRecipe
                        ? 'Recipe (a chain of existing tools, authored by the Toolsmith). Read-only here — delete and recreate to change the steps; toggle Enabled and Requires-confirm.'
                        : isMcp
                          ? "Connector tool (mirrored from an MCP connector's remote server). Read-only here; its sync owns the definition. Toggle Enabled and Requires-confirm."
                          : editing.mode === 'create'
                            ? 'A new HTTP or shell tool. Slug is immutable after creation.'
                            : 'Update the tool. Slug + kind are immutable.'}
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
                  {editing.mode === 'edit' && canDelete && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive-ink"
                      onClick={() => setDeleteTarget(editing.tool)}
                      aria-label={`Delete ${editing.tool.slug}`}
                      title="Delete tool"
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </div>

              <form onSubmit={submit} noValidate className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field data-invalid={!!errors.name || undefined}>
                    <FieldLabel htmlFor="name">Name</FieldLabel>
                    <Input
                      id="name"
                      value={form.name}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          name: e.target.value,
                          slug: slugTouched
                            ? f.slug
                            : slugify(e.target.value, { allowUnderscore: true, maxLength: 64 }),
                        }))
                      }
                      required
                      autoFocus
                      disabled={isReadOnly}
                      aria-invalid={!!errors.name || undefined}
                      aria-describedby={errors.name ? 'name-error name-hint' : 'name-hint'}
                    />
                    <FieldHint id="name">Human-readable label for this list.</FieldHint>
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
                      }}
                      pattern="[a-z0-9_\-]+"
                      required
                      disabled={editing.mode === 'edit'}
                      aria-invalid={!!errors.slug || undefined}
                      aria-describedby={errors.slug ? 'slug-error slug-hint' : 'slug-hint'}
                    />
                    <FieldHint id="slug">
                      The name the model calls this tool by. Fixed once created.
                    </FieldHint>
                    <FieldError id="slug-error">{errors.slug}</FieldError>
                  </Field>
                </div>

                <Field data-invalid={!!errors.description || undefined}>
                  <FieldLabel htmlFor="description">Description (the model reads this)</FieldLabel>
                  <Input
                    id="description"
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="What this tool does, when to use it"
                    required
                    disabled={isReadOnly}
                    aria-invalid={!!errors.description || undefined}
                    aria-describedby={
                      errors.description ? 'description-error description-hint' : 'description-hint'
                    }
                  />
                  <FieldHint
                    id="description"
                    warn="Vague wording here is the usual reason a tool never gets picked."
                  >
                    This is how the model decides when to reach for this tool.
                  </FieldHint>
                  <FieldError id="description-error">{errors.description}</FieldError>
                </Field>

                {isReadOnly && editTool ? (
                  <Field>
                    <FieldLabel>Handler</FieldLabel>
                    {editTool.handler.kind === 'recipe' ? (
                      <>
                        <div className="space-y-1 rounded-md border border-input bg-muted/40 px-3 py-2 font-mono text-xs">
                          {editTool.handler.steps.map((s, i) => (
                            <div key={i} className="truncate">
                              <span className="text-muted-foreground">{i}.</span> {s.tool}
                              {s.as ? (
                                <span className="text-muted-foreground"> → ${s.as}</span>
                              ) : null}
                            </div>
                          ))}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          A chain of {editTool.handler.steps.length} existing tools; data flows
                          between steps server-side. Delete and recreate via the Toolsmith to change
                          it.
                        </p>
                      </>
                    ) : editTool.handler.kind === 'mcp' ? (
                      <>
                        <div className="rounded-md border border-input bg-muted/40 px-3 py-2 font-mono text-xs">
                          mcp · {editTool.handler.group} · {editTool.handler.toolName}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {editTool.handler.vanishedAt
                            ? 'The remote server no longer lists this tool; its sync disabled it. '
                            : ''}
                          Mirrored from the connector&apos;s remote server. Change the connector and
                          re-run its sync to change it; delete the connector to remove it.
                        </p>
                      </>
                    ) : (
                      <>
                        <div className="rounded-md border border-input bg-muted/40 px-3 py-2 font-mono text-xs">
                          builtin ·{' '}
                          {editTool.handler.kind === 'builtin' ? editTool.handler.ref : ''}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Code-backed; the implementation is fixed. Edit it in{' '}
                          <code>packages/tools/src/builtins*.ts</code>.
                        </p>
                      </>
                    )}
                  </Field>
                ) : (
                  <>
                    <Field>
                      <FieldLabel htmlFor="kind">Kind</FieldLabel>
                      {/* Was a raw `<select>` carrying hand-copied input
                          classes: no focus ring, no invalid state, and it
                          drifts from every other control the moment a token
                          changes (§6d). */}
                      <Select
                        value={form.kind}
                        onValueChange={(v) => setForm((f) => ({ ...f, kind: v as FormKind }))}
                        disabled={editing.mode === 'edit'}
                      >
                        <SelectTrigger id="kind">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="http">HTTP — fire a request</SelectItem>
                          <SelectItem value="shell">
                            Shell — run a command (auto-confirms required)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FieldHint
                        id="kind"
                        warn="Shell runs on the brain itself, so it always asks before firing."
                      >
                        How this tool does its work. Fixed once created.
                      </FieldHint>
                    </Field>

                    {form.kind === 'http' ? (
                      <>
                        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                          <Field data-invalid={!!errors.url || undefined}>
                            <FieldLabel htmlFor="url">URL template</FieldLabel>
                            <Input
                              id="url"
                              value={form.url}
                              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                              placeholder="https://api.example.com/route/{origin}/{destination}"
                              required
                              aria-invalid={!!errors.url || undefined}
                              aria-describedby={errors.url ? 'url-error url-hint' : 'url-hint'}
                            />
                            <FieldHint id="url">
                              Where the request goes. <code>{'{param}'}</code> slots fill from the
                              model&apos;s input.
                            </FieldHint>
                            <FieldError id="url-error">{errors.url}</FieldError>
                          </Field>
                          <Field>
                            <FieldLabel htmlFor="method">Method</FieldLabel>
                            <Select
                              value={form.method}
                              onValueChange={(v) =>
                                setForm((f) => ({ ...f, method: v as FormState['method'] }))
                              }
                            >
                              <SelectTrigger id="method">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const).map((m) => (
                                  <SelectItem key={m} value={m}>
                                    {m}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FieldHint id="method">HTTP verb for the call.</FieldHint>
                          </Field>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field data-invalid={!!errors['http-headers'] || undefined}>
                            <FieldLabel htmlFor="http-headers">
                              Headers (JSON object, optional)
                            </FieldLabel>
                            <Textarea
                              id="http-headers"
                              value={form.headersJson}
                              onChange={(e) =>
                                setForm((f) => ({ ...f, headersJson: e.target.value }))
                              }
                              rows={3}
                              className="font-mono"
                              placeholder={
                                '{\n  "authorization": "Bearer {{secret:mapbox/default}}"\n}'
                              }
                              aria-invalid={!!errors['http-headers'] || undefined}
                              aria-describedby={
                                errors['http-headers']
                                  ? 'http-headers-error http-headers-hint'
                                  : 'http-headers-hint'
                              }
                            />
                            <FieldHint
                              id="http-headers"
                              warn="Never paste a raw key here — use a secret reference."
                            >
                              Sent with every call.
                            </FieldHint>
                            <FieldError id="http-headers-error">
                              {errors['http-headers']}
                            </FieldError>
                          </Field>
                          <Field data-invalid={!!errors['http-query'] || undefined}>
                            <FieldLabel htmlFor="http-query">
                              Query params (JSON object, optional)
                            </FieldLabel>
                            <Textarea
                              id="http-query"
                              value={form.queryJson}
                              onChange={(e) =>
                                setForm((f) => ({ ...f, queryJson: e.target.value }))
                              }
                              rows={3}
                              className="font-mono"
                              placeholder={'{\n  "access_token": "{{secret:mapbox/default}}"\n}'}
                              aria-invalid={!!errors['http-query'] || undefined}
                              aria-describedby={
                                errors['http-query']
                                  ? 'http-query-error http-query-hint'
                                  : 'http-query-hint'
                              }
                            />
                            <FieldHint id="http-query">
                              Appended to the URL as <code>?key=value</code>.
                            </FieldHint>
                            <FieldError id="http-query-error">{errors['http-query']}</FieldError>
                          </Field>
                        </div>
                        <Field>
                          <FieldLabel htmlFor="http-body">Body template (optional)</FieldLabel>
                          <Textarea
                            id="http-body"
                            value={form.bodyTemplate}
                            onChange={(e) =>
                              setForm((f) => ({ ...f, bodyTemplate: e.target.value }))
                            }
                            rows={3}
                            className="font-mono"
                            placeholder={'{"query": {q}, "limit": {limit}}'}
                          />
                          <FieldHint id="http-body">
                            <code>{'{param}'}</code> placeholders fill from the model&apos;s input
                            (URL-encoded in the URL, JSON-encoded in the body);{' '}
                            <code>{'{{secret:service/label}}'}</code> pulls from the API-key vault
                            at call time. No body template → non-GET calls send the whole input as
                            JSON. Tip: the API Console (System → API Console) builds these visually.
                          </FieldHint>
                        </Field>
                      </>
                    ) : (
                      <Field data-invalid={!!errors.cmd || undefined}>
                        <FieldLabel htmlFor="cmd">Command template</FieldLabel>
                        <Textarea
                          id="cmd"
                          aria-invalid={!!errors.cmd || undefined}
                          aria-describedby={errors.cmd ? 'cmd-error' : undefined}
                          value={form.cmd}
                          onChange={(e) => setForm((f) => ({ ...f, cmd: e.target.value }))}
                          rows={3}
                          required
                          className="font-mono"
                          placeholder={'echo "hello ${input.name}"'}
                        />
                        <FieldHint
                          id="cmd"
                          aria-invalid={!!errors.cmd || undefined}
                          aria-describedby={errors.cmd ? 'cmd-error' : undefined}
                          warn="This runs on the brain itself — keep it to something you'd type yourself."
                        >
                          Use <code>{'${input.<field>}'}</code> placeholders. Values are
                          shell-escaped before substitution. 30s timeout, 10KB output cap.
                        </FieldHint>
                        <FieldError id="cmd-error">{errors.cmd}</FieldError>
                      </Field>
                    )}
                  </>
                )}

                <Field data-invalid={!!errors.schema || undefined}>
                  <FieldLabel htmlFor="schema">Input schema (JSON Schema)</FieldLabel>
                  <Textarea
                    id="schema"
                    aria-invalid={!!errors.schema || undefined}
                    aria-describedby={errors.schema ? 'schema-error' : undefined}
                    value={form.inputSchemaJson}
                    onChange={(e) => setForm((f) => ({ ...f, inputSchemaJson: e.target.value }))}
                    rows={isReadOnly ? 10 : 6}
                    readOnly={isReadOnly}
                    className={cn(
                      'w-full rounded-md border border-input px-3 py-2 text-sm font-mono',
                      isReadOnly ? 'bg-muted/40 text-muted-foreground' : 'bg-background',
                    )}
                  />
                  <FieldHint id="schema">
                    {isReadOnly
                      ? 'What the model passes to this tool (read-only).'
                      : 'Sent verbatim to the model so it knows what to pass.'}
                  </FieldHint>
                  <FieldError id="schema-error">{errors.schema}</FieldError>
                </Field>

                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={form.requiresConfirm}
                    onCheckedChange={(v) => setForm((f) => ({ ...f, requiresConfirm: v }))}
                  />
                  Requires operator confirm
                </label>

                <div className="flex justify-end gap-2 border-t border-border pt-3">
                  <Button type="button" variant="outline" onClick={close}>
                    Cancel
                  </Button>
                  <SubmitButton pending={saveMutation.isPending}>
                    {editing.mode === 'create' ? 'Create tool' : 'Save tool'}
                  </SubmitButton>
                </div>
              </form>

              {editing.mode === 'edit' &&
                (() => {
                  const allGroups = groupsQuery.data ?? [];
                  const holding = groupsHolding(allGroups, editing.tool.slug);
                  return (
                    <>
                      <ExternalAccessSection
                        tool={editing.tool}
                        onChanged={(t) => {
                          queryClient.invalidateQueries({ queryKey: ['tools'] });
                          setEditing({ mode: 'edit', tool: t });
                        }}
                        note={
                          groupsQuery.isSuccess ? (
                            <ConnectorOffNote
                              group={connectorOff(allGroups, editing.tool.handler)}
                            />
                          ) : null
                        }
                      />
                      <ToolGroupsOfTool
                        groups={holding}
                        pending={groupsQuery.isPending}
                        error={groupsQuery.isError ? groupsQuery.error.message : null}
                      />
                    </>
                  );
                })()}
            </div>
          )
        }
      />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteTarget?.slug}”?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
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

function ToolCard({
  tool,
  selected,
  onClick,
}: {
  tool: ToolSummary;
  selected: boolean;
  onClick: () => void;
}) {
  const badge = toolAccessBadge(tool);
  return (
    <ListCard onClick={onClick} selected={selected} dimmed={!tool.enabled}>
      <div className="flex items-center gap-2">
        <code className="truncate font-mono text-sm font-medium">{tool.slug}</code>
        <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          {tool.handler.kind}
        </span>
        {!tool.enabled && (
          <span className="shrink-0 rounded-sm bg-muted px-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            off
          </span>
        )}
        {badge && (
          <span
            className={
              badge.tone === 'warning'
                ? 'shrink-0 rounded-sm bg-warning/15 px-1 text-[10px] uppercase tracking-wider text-warning-ink'
                : 'shrink-0 rounded-sm bg-muted px-1 text-[10px] uppercase tracking-wider text-muted-foreground'
            }
            title={badge.title}
          >
            {badge.label}
          </span>
        )}
        {tool.requiresConfirm && (
          <span
            className="shrink-0 rounded-sm bg-destructive/15 px-1 text-[10px] uppercase tracking-wider text-destructive-ink"
            title="Requires operator confirm"
          >
            confirm
          </span>
        )}
      </div>
      {tool.description && <ListCardSnippet>{tool.description}</ListCardSnippet>}
    </ListCard>
  );
}
