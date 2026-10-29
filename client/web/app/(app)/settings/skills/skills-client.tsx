'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import type { SkillDTO, SkillBackrefs } from '@mantle/client-types';
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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@mantle/web-ui/ui/field';
import { FieldHint } from '@mantle/web-ui/ui/field-hint';
import { useToast } from '@mantle/web-ui/ui/toast';
import {
  ListCard,
  ListCardMeta,
  ListCardSnippet,
  ListCardTitle,
} from '@mantle/web-ui/ui/list-card';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import { slugify } from '@mantle/web-ui/slugify';
import { play } from '@/lib/sounds/play';

// Row + backref shapes come from the shared client-types package (the wire
// contract), so this screen never imports @mantle/db just to name them.
type SkillSummary = SkillDTO;

type FormState = {
  slug: string;
  name: string;
  description: string;
  instructions: string;
  /** Free-form JSON the skill author types. Validated on submit;
   *  parsed value stored on the row. Empty string = default to `{}`. */
  defaultStateText: string;
  enabled: boolean;
};

const emptyForm = (): FormState => ({
  slug: '',
  name: '',
  description: '',
  instructions: '',
  defaultStateText: '{}',
  enabled: true,
});

function fromSkill(s: SkillSummary): FormState {
  return {
    slug: s.slug,
    name: s.name,
    description: s.description,
    instructions: s.instructions,
    defaultStateText: JSON.stringify(s.defaultState ?? {}, null, 2),
    enabled: s.enabled,
  };
}

/** Which controls are currently at fault. Keys are the control ids. */
type SkillErrors = {
  name?: string;
  slug?: string;
  description?: string;
  defaultState?: string;
};

export function SkillsClient() {
  const queryClient = useQueryClient();
  const toast = useToast();

  // ── Reads (TanStack Query) ────────────────────────────────────────────────
  // Query keys mirror the URL; invalidating ['skills'] re-validates both the
  // list and its backrefs (prefix match) — the client-side replacement for the
  // server's revalidatePath.
  const skillsQuery = useQuery({
    queryKey: ['skills'],
    queryFn: () => apiFetch<{ skills: SkillSummary[] }>('/api/skills').then((r) => r.skills),
  });
  const backrefsQuery = useQuery({
    queryKey: ['skills', 'backrefs'],
    queryFn: () =>
      apiFetch<{ backrefs: SkillBackrefs }>('/api/skills/backrefs').then((r) => r.backrefs),
  });
  const skills = useMemo(() => skillsQuery.data ?? [], [skillsQuery.data]);
  const heartbeatBackrefs = backrefsQuery.data ?? {};

  const [editing, setEditing] = useState<
    { mode: 'create' } | { mode: 'edit'; skill: SkillSummary } | null
  >(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState<SkillErrors>({});
  const clearError = (k: keyof SkillErrors) =>
    setErrors((cur) => {
      if (!cur[k]) return cur;
      const next = { ...cur };
      delete next[k];
      return next;
    });
  const [deleteTarget, setDeleteTarget] = useState<SkillSummary | null>(null);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: (vars: { mode: 'create' | 'edit'; id?: string; body: Record<string, unknown> }) =>
      vars.mode === 'create'
        ? apiSend('/api/skills', 'POST', vars.body)
        : apiSend(`/api/skills/${vars.id}`, 'PATCH', vars.body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
      setEditing(null);
      play('success');
    },
    onError: (e) => {
      play('danger');
      toast.error(e instanceof Error ? e.message : 'save failed');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiSend(`/api/skills/${id}`, 'DELETE'),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
      if (editing?.mode === 'edit' && editing.skill.id === id) setEditing(null);
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
  const openEdit = (s: SkillSummary) => {
    setForm(fromSkill(s));
    setSlugTouched(true);
    setEditing({ mode: 'edit', skill: s });
  };
  const close = () => setEditing(null);

  // Deep link: /settings/skills?selected=<id-or-slug> opens that skill's
  // editor once the list arrives (one-shot; selection stays client-state).
  const searchParams = useSearchParams();
  const deepLinkRef = useRef(searchParams.get('selected'));
  useEffect(() => {
    const want = deepLinkRef.current?.trim();
    if (!want || skills.length === 0) return;
    deepLinkRef.current = null;
    const hit = skills.find((s) => s.id === want || s.slug === want);
    if (hit) openEdit(hit);
  }, [skills]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;

    const next: SkillErrors = {};
    if (!form.name.trim()) next.name = 'A name is required.';
    if (!form.description.trim()) next.description = 'A one-sentence description is required.';
    if (editing.mode === 'create') {
      const slug = form.slug.trim();
      if (!slug) next.slug = 'A slug is required.';
      else if (!/^[a-z0-9_-]+$/.test(slug))
        next.slug = 'Lower-case letters, digits, hyphen and underscore only.';
    }

    // The default_state JSON. Empty or whitespace means `{}`; anything else has
    // to parse as a JSON OBJECT — not an array, not a primitive.
    //
    // Both failures used to be toasts, under a comment claiming they surfaced
    // "inline". They did not: a toast names a control, appears in a corner and
    // is gone before you can look for it — and this one carries a parser
    // message you need to READ against the text you just typed. It belongs
    // under the textarea (§6b).
    let defaultState: Record<string, unknown> = {};
    const raw = form.defaultStateText.trim();
    if (raw.length > 0) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
          next.defaultState = 'Default state must be a JSON object (e.g. {"answered": []}).';
        else defaultState = parsed as Record<string, unknown>;
      } catch (err) {
        next.defaultState = `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    if (Object.keys(next).length > 0) {
      setErrors(next);
      const first = (['name', 'slug', 'description', 'defaultState'] as const).find((k) => next[k]);
      if (first) document.getElementById(first)?.focus();
      return;
    }
    setErrors({});

    const body = {
      name: form.name.trim(),
      description: form.description.trim(),
      instructions: form.instructions,
      defaultState,
      enabled: form.enabled,
      ...(editing.mode === 'create' ? { slug: form.slug.trim() } : {}),
    };
    saveMutation.mutate(
      editing.mode === 'create'
        ? { mode: 'create', body }
        : { mode: 'edit', id: editing.skill.id, body },
    );
  };

  const confirmDelete = () => {
    const s = deleteTarget;
    if (!s) return;
    setDeleteTarget(null);
    deleteMutation.mutate(s.id, {
      onSuccess: () => toast.success(`Deleted ${s.name}`),
    });
  };

  return (
    <>
      <MasterDetail
        id="settings-skills"
        // The 360px this screen has always had.
        defaultListSize="360px"
        // No `detailFills`: the detail is a form — and this one has two
        // textareas, which the 672px default measure keeps readable (§8).
        list={
          <>
            <div className="flex items-center justify-between gap-2 border-b border-border p-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Skills
              </h2>
              <Button type="button" size="sm" onClick={openCreate}>
                <Plus /> New
              </Button>
            </div>
            <div className="space-y-2 p-3 md:flex-1 md:overflow-y-auto md:scrollbar-thin">
              {/* Subtle, non-blocking notice: the list still works without the
              heartbeat-usage badges if their fetch fails. */}
              {backrefsQuery.isError && (
                <p className="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">
                  <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                  Couldn’t load heartbeat usage — badges hidden.
                  <RowButton
                    onClick={() => backrefsQuery.refetch()}
                    className="ml-auto shrink-0 underline underline-offset-2 hover:text-foreground"
                  >
                    Retry
                  </RowButton>
                </p>
              )}
              {skillsQuery.isPending ? (
                <div className="flex flex-col items-center gap-3 px-4 py-10 text-sm text-muted-foreground">
                  <Spinner size={28} />
                  Loading skills…
                </div>
              ) : skillsQuery.isError ? (
                <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-6 text-center text-sm text-destructive-ink">
                  <p>Couldn’t load skills: {skillsQuery.error.message}</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => skillsQuery.refetch()}
                  >
                    Retry
                  </Button>
                </div>
              ) : skills.length === 0 ? (
                <p className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
                  No skills yet. Click <strong>New</strong> to author one.
                </p>
              ) : (
                skills.map((s) => {
                  const selected = editing?.mode === 'edit' && editing.skill.id === s.id;
                  const refs = heartbeatBackrefs[s.slug] ?? [];
                  const activeRefs = refs.filter((r) => r.status === 'active').length;
                  return (
                    <ListCard
                      key={s.id}
                      onClick={() => openEdit(s)}
                      selected={selected}
                      dimmed={!s.enabled}
                    >
                      <div className="flex items-center gap-2">
                        <ListCardTitle>{s.name}</ListCardTitle>
                        {!s.enabled && (
                          <span className="shrink-0 rounded-sm bg-muted px-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                            off
                          </span>
                        )}
                      </div>
                      <ListCardMeta className="font-mono">{s.slug}</ListCardMeta>
                      {s.description && <ListCardSnippet>{s.description}</ListCardSnippet>}
                      {refs.length > 0 && (
                        <div
                          className="mt-1 text-xs text-info-ink"
                          title={refs.map((r) => `${r.slug} [${r.status}]`).join('\n')}
                        >
                          ↳{' '}
                          {activeRefs > 0
                            ? `${activeRefs}/${refs.length} heartbeats active`
                            : `${refs.length} heartbeats`}
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
                    {editing.mode === 'create' ? 'New skill' : `Edit ${editing.skill.name}`}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {editing.mode === 'create'
                      ? 'A new skill. Slug is immutable after creation.'
                      : 'Update the skill. Slug is immutable.'}
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
                      onClick={() => setDeleteTarget(editing.skill)}
                      aria-label={`Delete ${editing.skill.name}`}
                      title="Delete skill"
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
                        What this skill is called in the list.
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
                        How agents and heartbeats reference it. Fixed once saved.
                      </FieldDescription>
                      <FieldError id="slug-error">{errors.slug}</FieldError>
                    </Field>
                  </div>

                  <Field data-invalid={!!errors.description || undefined}>
                    <FieldLabel htmlFor="description">
                      Description (1 sentence — when to use this skill)
                    </FieldLabel>
                    <Input
                      id="description"
                      value={form.description}
                      onChange={(e) => {
                        setForm((f) => ({ ...f, description: e.target.value }));
                        clearError('description');
                      }}
                      placeholder="Triage an inbox: classify each email + draft a brief reply"
                      aria-invalid={!!errors.description || undefined}
                      aria-describedby={
                        errors.description
                          ? 'description-error description-hint'
                          : 'description-hint'
                      }
                    />
                    <FieldDescription id="description-hint">
                      How an agent decides this skill is the right one to apply.
                    </FieldDescription>
                    <FieldError id="description-error">{errors.description}</FieldError>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="instructions">Instructions (markdown)</FieldLabel>
                    {/* Was a raw `<textarea>` carrying hand-copied input classes:
                      no focus ring, no invalid state, drifts from every other
                      control the moment the token changes (§6d). */}
                    <Textarea
                      id="instructions"
                      value={form.instructions}
                      onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
                      rows={10}
                      className="font-mono"
                      placeholder={
                        'Step 1: list pending emails with email_list.\nStep 2: for each, draft a reply with file_create under files/drafts/.\n...'
                      }
                    />
                    <FieldHint
                      id="instructions"
                      warn="It rides along on every turn of every agent that has it — keep it tight."
                    >
                      Appended verbatim to the system prompt of any agent this skill is attached to.
                      Reference tools by their slug; the agent will see them in its tool list.
                    </FieldHint>
                  </Field>

                  <Field data-invalid={!!errors.defaultState || undefined}>
                    <FieldLabel htmlFor="defaultState">
                      Default state (JSON template for heartbeats using this skill)
                    </FieldLabel>
                    <Textarea
                      id="defaultState"
                      value={form.defaultStateText}
                      onChange={(e) => {
                        setForm((f) => ({ ...f, defaultStateText: e.target.value }));
                        clearError('defaultState');
                      }}
                      rows={5}
                      className="font-mono"
                      placeholder={'{\n  "answered": [],\n  "expecting_reply": false\n}'}
                      aria-invalid={!!errors.defaultState || undefined}
                      aria-describedby={
                        errors.defaultState
                          ? 'defaultState-error defaultState-hint'
                          : 'defaultState-hint'
                      }
                    />
                    <FieldHint id="defaultState">
                      Heartbeats created against this skill copy this as their initial{' '}
                      <code>state</code>. Once a heartbeat exists, its own state is the source of
                      truth — edits here don&apos;t propagate. Leave empty for <code>{'{}'}</code>.
                      See how state works in{' '}
                      <a
                        href="https://docs.mantle-ai.tech/help/heartbeats/#technical"
                        className="underline"
                        target="_blank"
                        rel="noreferrer"
                      >
                        the heartbeat docs
                      </a>
                      .
                    </FieldHint>
                    <FieldError id="defaultState-error">{errors.defaultState}</FieldError>
                  </Field>

                  <div className="flex justify-end gap-2 border-t border-border pt-3">
                    <Button type="button" variant="outline" onClick={close}>
                      Cancel
                    </Button>
                    <SubmitButton pending={saveMutation.isPending}>
                      {editing.mode === 'create' ? 'Create skill' : 'Save skill'}
                    </SubmitButton>
                  </div>
                </FieldGroup>
              </form>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-10 text-center text-sm text-muted-foreground">
              Select a skill to edit, or create a new one.
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
                const refs = deleteTarget ? (heartbeatBackrefs[deleteTarget.slug] ?? []) : [];
                if (refs.length === 0) return 'This cannot be undone.';
                const active = refs.filter((r) => r.status === 'active').length;
                return `Referenced by ${refs.length} heartbeat${refs.length === 1 ? '' : 's'}${active > 0 ? ` — ${active} active will auto-pause on next fire` : ''}. This cannot be undone.`;
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
