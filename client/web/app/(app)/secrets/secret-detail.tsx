'use client';

import { useState, useTransition } from 'react';
import { Check, Copy, Eye, EyeOff, KeyRound, Loader2, Pencil } from 'lucide-react';
import { FormShell } from '@mantle/web-ui/ui/form-shell';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { Button } from '@mantle/web-ui/ui/button';
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
import { useToast } from '@mantle/web-ui/ui/toast';
import { apiSend } from '@mantle/web-ui/api-fetch';
import { formatDateTime } from '@mantle/web-ui/lib/format-datetime';
import {
  SecretForm,
  type Field,
  type Kind,
  type SecretBody,
  type SecretFormValues,
} from './secret-form';
import { copyText } from '@mantle/web-ui/lib/secure-context-fallbacks';
import { play } from '@/lib/sounds/play';
import { HeaderPill, ItemHeader } from '@/components/layout/item-header';
import { AccessSlot } from '@/components/share/access-slot';
import { itemAccess, readOnlyNote, type ItemCaps } from '@/lib/item-access';
import { secretFailureText, withKeptCaps } from '@/lib/secrets-screen';

/** What the Access panel says under its rows on a secret. */
export const SECRET_ACCESS_HINT =
  'People in a workspace you share this with can reveal its value. Each reveal is logged.';

export type SecretRow = {
  id: string;
  title: string;
  description: string;
  kind: Kind;
  tags: string[];
  hasNote: boolean;
  fieldCount: number;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
  // What the login may do with it (the brain's caps, as on every item) and
  // who it is shared with (a list row's marks). A brain that sends none
  // leaves every control on and refuses in its own words.
} & ItemCaps & { workspaces?: unknown; hasLink?: boolean };

type Payload = { note: string; fields: Field[] };

/**
 * A secret's detail: the item header (contract 2026-10-21), then reveal
 * (decrypt on demand), edit and delete. Used in the master-detail right pane
 * and on the /secrets/[id] deep-link page. Callbacks let the host keep its
 * list and route in sync. Mount with `key={secret.id}` so another secret
 * resets the revealed and edit state.
 *
 * What the login may do is what the brain says on the row (`itemAccess`):
 * whoever reads it reveals it; Edit needs `mayEdit` (a grant with Write on);
 * Delete, Move and Access need `mayManage`. The screen adds no rule.
 *
 * A revealed value lives in this component's state only: never in the query
 * cache, the address, a toast or an error text, and always inside a
 * `data-secret` box, which an agent's look paints over (docs/agent-ui.md).
 */
export function SecretDetail({
  secret,
  shares,
  onUpdated,
  onDeleted,
}: {
  secret: SecretRow;
  /** The share marks for Access (`shareMarksOf`): the row it was opened
   *  from. Absent: the secret's own marks, else its grants. */
  shares?: unknown;
  onUpdated?: (s: SecretRow) => void;
  onDeleted?: () => void;
}) {
  const toast = useToast();
  const [meta, setMeta] = useState(secret);
  const [revealed, setRevealed] = useState<Payload | null>(null);
  const [visibleIdx, setVisibleIdx] = useState<Set<number>>(new Set());
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editInitial, setEditInitial] = useState<SecretFormValues | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const access = itemAccess(meta);
  const readNote = readOnlyNote(access);

  const fetchPayload = async (): Promise<Payload | null> => {
    try {
      const { payload } = await apiSend<{ payload: Payload }>(
        `/api/secrets/${meta.id}/reveal`,
        'POST',
      );
      return payload;
    } catch (err) {
      toast.error(secretFailureText(err, 'reveal'));
      return null;
    }
  };

  const reveal = async () => {
    setLoading(true);
    try {
      const payload = await fetchPayload();
      if (!payload) return;
      setRevealed(payload);
      setVisibleIdx(new Set(payload.fields.map((_, i) => i))); // one click = show all
    } finally {
      setLoading(false);
    }
  };

  const hide = () => {
    setRevealed(null);
    setVisibleIdx(new Set());
    setCopiedIdx(null);
  };

  const toggleField = (i: number) =>
    setVisibleIdx((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  const copyField = async (i: number, value: string) => {
    await copyText(value);
    setCopiedIdx(i);
    setTimeout(() => setCopiedIdx((c) => (c === i ? null : c)), 1500);
  };

  const startEdit = async () => {
    setLoading(true);
    try {
      const payload = revealed ?? (await fetchPayload());
      if (!payload) return;
      setRevealed(payload);
      setEditInitial({
        title: meta.title,
        description: meta.description,
        kind: meta.kind,
        tags: meta.tags,
        note: payload.note,
        fields: payload.fields.length > 0 ? payload.fields : [{ label: '', value: '' }],
      });
      setEditing(true);
    } finally {
      setLoading(false);
    }
  };

  const saveEdit = async (body: SecretBody) => {
    let updated: SecretRow;
    try {
      ({ secret: updated } = await apiSend<{ secret: SecretRow }>(
        `/api/secrets/${meta.id}`,
        'PATCH',
        body,
      ));
    } catch (err) {
      play('danger');
      toast.error(secretFailureText(err, 'save'));
      return;
    }
    play('success');
    // A brain that answers a save without caps: keep the ones on screen.
    updated = withKeptCaps(updated, meta);
    setMeta(updated);
    setRevealed({ note: body.note, fields: body.fields });
    setVisibleIdx(new Set(body.fields.map((_, i) => i)));
    setEditing(false);
    onUpdated?.(updated);
  };

  const confirmDelete = async () => {
    setDeleteOpen(false);
    try {
      await apiSend(`/api/secrets/${meta.id}`, 'DELETE');
    } catch (err) {
      toast.error(secretFailureText(err, 'delete'));
      return;
    }
    toast.success(`Deleted “${meta.title}”`);
    startTransition(() => onDeleted?.());
  };

  // The item header, read and edit mode alike. Every control on it is a
  // person's own act (`data-agent-risk`): Edit reads the value, and no agent
  // changes who reads a secret or removes one.
  const header = (
    <ItemHeader
      data-agent-risk="person"
      edit={
        !access.edit
          ? { disabled: true }
          : editing
            ? { onSelect: () => setEditing(false), pressed: true, label: 'Stop editing' }
            : { onSelect: startEdit, label: 'Edit secret' }
      }
      section="Secrets"
      visual={<KeyRound className="size-4" aria-hidden />}
      title={meta.title || 'Untitled secret'}
      badges={<HeaderPill title="The kind of secret">{meta.kind}</HeaderPill>}
      access={
        <AccessSlot
          type="secret"
          nodeId={meta.id}
          canShare={access.share}
          shares={shares ?? meta}
          hint={SECRET_ACCESS_HINT}
        />
      }
      onDelete={access.manage ? () => setDeleteOpen(true) : undefined}
      deleteDisabled={!access.manage}
      deleteLabel="Delete secret"
      move={access.move ? { kind: 'secrets', item: { id: meta.id, title: meta.title } } : null}
      info={{
        description: meta.description || undefined,
        tags: meta.tags,
        rows: [
          ...(readNote ? [{ label: 'Access', value: readNote }] : []),
          ...(meta.summary && !meta.description ? [{ label: 'Indexed', value: meta.summary }] : []),
          { label: 'Updated', value: formatDateTime(meta.updatedAt) },
          { label: 'Created', value: formatDateTime(meta.createdAt) },
        ],
      }}
      infoLabel="About this secret"
    />
  );

  if (editing && editInitial) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {header}
        {/* Same boxed composer as the "New secret" pane (§6c): create and
            edit are the same form, so they get the same surface. */}
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-6">
          <FormShell>
            <div className="flex items-center gap-2">
              <Pencil className="size-5 text-primary-ink" aria-hidden />
              <h3 className="text-lg font-semibold">Edit secret</h3>
            </div>
            <SecretForm
              initial={editInitial}
              submitLabel="Save secret"
              submitting={pending}
              onSubmit={saveEdit}
              onCancel={() => setEditing(false)}
            />
          </FormShell>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto scrollbar-thin px-6 py-5">
        {/* Reveal panel */}
        {!revealed ? (
          <div className="rounded-md border border-border bg-muted/20 p-6 text-center">
            <p className="mb-3 text-sm text-muted-foreground">
              {meta.fieldCount} field{meta.fieldCount === 1 ? '' : 's'}
              {meta.hasNote ? ' + note' : ''} · sealed
            </p>
            {/* data-agent-risk: Reveal reads the value; it must stay out of an
              agent's turn (lib/agent-ui). */}
            <Button data-agent-risk="person" onClick={reveal} disabled={loading}>
              {loading ? <Loader2 className="animate-spin" /> : <Eye />}
              {loading ? 'Decrypting…' : 'Reveal'}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={hide}>
                <EyeOff /> Hide
              </Button>
            </div>

            {/* data-secret: an agent driving the window never reads a
              revealed value (ui_look blanks the area; docs/agent-ui.md). */}
            {revealed.fields.length > 0 && (
              <div data-secret="" className="rounded-md border border-border">
                {revealed.fields.map((f, i) => {
                  const visible = visibleIdx.has(i);
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0"
                    >
                      <div className="w-24 shrink-0 truncate text-xs font-medium uppercase tracking-wider text-muted-foreground sm:w-32">
                        {f.label || '(unlabeled)'}
                      </div>
                      <code className="min-w-0 flex-1 truncate font-mono text-sm">
                        {visible ? f.value : '•'.repeat(Math.min(f.value.length, 24))}
                      </code>
                      <RowButton
                        onClick={() => toggleField(i)}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={visible ? 'Hide field' : 'Show field'}
                      >
                        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </RowButton>
                      <RowButton
                        onClick={() => copyField(i, f.value)}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label="Copy"
                      >
                        {copiedIdx === i ? (
                          <Check className="size-4 text-success-ink" />
                        ) : (
                          <Copy className="size-4" />
                        )}
                      </RowButton>
                    </div>
                  );
                })}
              </div>
            )}

            {revealed.note && (
              <div className="space-y-1.5">
                {/* A caption, not a <Label>: this is read-only output with no
                  control to label, and a dangling <label> is worse than none. */}
                <p className="text-sm font-medium">Note</p>
                <pre
                  data-secret=""
                  className="whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 font-mono text-sm"
                >
                  {revealed.note}
                </pre>
              </div>
            )}

            {revealed.fields.length === 0 && !revealed.note && (
              <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                No fields or note.
                {access.edit ? ' Click the pencil to add some.' : ''}
              </p>
            )}
          </div>
        )}
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{meta.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The encrypted value will be wiped. This cannot be undone.
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
    </div>
  );
}
