'use client';

/**
 * A group's handle and intake form, in its details (fleet chat, plan
 * sections 2 to 4). The handle is the group's address on the box, shown as
 * @qa: every login may post to it, a line that names it writes a copy here,
 * and a Reply on the copy goes back. The intake form (a bug report, a
 * feature request or a request) is asked of who posts to it. Its admins set
 * both (PATCH /api/messenger/c/:id, `messenger_update`); everyone else reads
 * them. Shown only by a brain that has handles (the conversation carries
 * the `handle` key).
 */
import { useEffect, useState } from 'react';
import { AtSign } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import { Field, FieldError, FieldLabel } from '@mantle/web-ui/ui/field';
import { Input } from '@mantle/web-ui/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@mantle/web-ui/ui/select';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import type { MessengerConversation, MessengerPatchRequest } from '@/lib/messenger/dto';
import { handleError } from '@/lib/messenger/fleet';
import {
  INTAKE_NAMES,
  MESSENGER_INTAKE_KINDS,
  normalizeHandle,
  type MessengerIntakeKind,
} from '@/lib/messenger/intake';

const NONE = 'none';

export function GroupHandleSection({
  conversation,
  editable,
  onSave,
}: {
  conversation: MessengerConversation;
  /** An admin who has not left. */
  editable: boolean;
  /** true when it was saved. */
  onSave: (patch: MessengerPatchRequest) => Promise<boolean>;
}) {
  const handle = conversation.handle ?? null;
  const intake = conversation.intake ?? null;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(handle ?? '');
  const [form, setForm] = useState<MessengerIntakeKind | null>(intake);
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (!editable) setEditing(false);
  }, [editable]);
  const error = tried ? handleError(text) : null;

  const save = async () => {
    setTried(true);
    if (handleError(text)) return;
    const next = normalizeHandle(text) ?? null;
    const patch: MessengerPatchRequest = {};
    if (next !== handle) patch.handle = next;
    if (form !== intake) patch.intake = form;
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const ok = await onSave(patch);
    setSaving(false);
    if (ok) setEditing(false);
  };

  return (
    <section aria-labelledby="chat-handle" className="space-y-2" data-testid="chat-handle">
      <div className="flex items-center justify-between gap-2">
        <h4 id="chat-handle" className="text-sm font-semibold">
          Handle
        </h4>
        {editable && !editing ? (
          <Button
            variant="outline"
            size="xs"
            aria-label={handle ? "Edit the group's handle" : 'Add a handle to the group'}
            onClick={() => {
              setText(handle ?? '');
              setForm(intake);
              setTried(false);
              setEditing(true);
            }}
          >
            {handle ? 'Edit' : 'Add'}
          </Button>
        ) : null}
      </div>
      {editing ? (
        <form
          className="space-y-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !e.defaultPrevented && !saving) {
              e.preventDefault();
              setEditing(false);
            }
          }}
        >
          <Field data-invalid={!!error || undefined}>
            <FieldLabel htmlFor="chat-handle-text">Handle</FieldLabel>
            <div className="flex items-center gap-1">
              <AtSign className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <Input
                id="chat-handle-text"
                value={text}
                maxLength={31}
                autoFocus
                placeholder="qa"
                aria-invalid={!!error || undefined}
                aria-describedby="chat-handle-hint"
                onChange={(e) => setText(e.target.value)}
              />
            </div>
            <span id="chat-handle-hint" className="text-xs text-muted-foreground">
              Everyone on this box can post to it. Leave it empty to clear it.
            </span>
            <FieldError>{error}</FieldError>
          </Field>
          <Field>
            <FieldLabel htmlFor="chat-intake">Intake form</FieldLabel>
            <Select
              value={form ?? NONE}
              onValueChange={(v) => setForm(v === NONE ? null : (v as MessengerIntakeKind))}
            >
              <SelectTrigger id="chat-intake" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {MESSENGER_INTAKE_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {INTAKE_NAMES[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">
              The questions who posts to the handle answers first.
            </span>
          </Field>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
            <SubmitButton size="sm" pending={saving}>
              Save handle
            </SubmitButton>
          </div>
        </form>
      ) : handle ? (
        <p className="text-sm" data-testid="chat-handle-text">
          <span className="font-medium">@{handle}</span>
          {intake ? (
            <span className="text-muted-foreground">, {INTAKE_NAMES[intake]} form</span>
          ) : null}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          {editable
            ? 'An address on this box, like @qa. Everyone can post to it, and a Reply here goes back.'
            : 'None.'}
        </p>
      )}
    </section>
  );
}
