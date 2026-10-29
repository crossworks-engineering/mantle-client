'use client';

import { ItemHeader } from '@/components/layout/item-header';
import { HeaderTitleField } from '@/components/layout/header-fields';
import { Check, NotebookPen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { KINDS } from '@mantle/content-core/journal-options';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@mantle/web-ui/ui/field';
import { Textarea } from '@mantle/web-ui/ui/textarea';
import { apiSend, ApiError } from '@mantle/web-ui/api-fetch';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@mantle/web-ui/ui/select';
import { DateTimePicker } from '@mantle/web-ui/ui/date-time-picker';
import { TagInput } from '@/components/tag-input';
import { useToast } from '@mantle/web-ui/ui/toast';
import type { JournalRow } from '@mantle/client-types';
import { play } from '@/lib/sounds/play';

// Wire shape is the GET /api/journal mapper's output — single source of truth.
// Re-exported so the list client keeps importing it from here; drift is a
// compile error.
export type { JournalRow };

const USER_KINDS = KINDS.filter((k) => k.lane === 'user');
const AGENT_KINDS = KINDS.filter((k) => k.lane === 'agent');

/**
 * Journal entry editor — a small, plain-text paragraph plus a kind. No
 * markdown editor by design: entries are short and atomic so they chunk
 * cleanly into the context blocks. The kind picks the lane: user kinds feed
 * the "About the user" block, agent kinds the per-turn "Working notes".
 * Handles create (`entry=null` → POST) and edit (PATCH). ⌘/Ctrl+S saves, Esc
 * cancels. Reports `dirty` up so the host can guard unsaved changes.
 */
export function JournalEditor({
  entry,
  defaultKind = 'context',
  onSaved,
  onCancel,
  onDirtyChange,
}: {
  entry: JournalRow | null;
  /** Kind pre-selected on create — the hosting view passes its own lane's
   *  default ('context' on You, 'lesson' on Agent notes). */
  defaultKind?: string;
  onSaved: (saved: JournalRow) => void;
  onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const toast = useToast();
  const creating = entry === null;
  const [title, setTitle] = useState(entry?.title ?? '');
  const [body, setBody] = useState(entry?.body ?? '');
  const [kind, setKind] = useState(entry?.kind ?? defaultKind);
  const [entryDate, setEntryDate] = useState<Date | null>(
    entry?.entryDate ? new Date(entry.entryDate) : null,
  );
  const [tags, setTags] = useState<string[]>(entry?.tags ?? []);
  const [saving, setSaving] = useState(false);
  /** Validation message for the body, the only required field. */
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(entry?.title ?? '');
    setBody(entry?.body ?? '');
    setKind(entry?.kind ?? defaultKind);
    setEntryDate(entry?.entryDate ? new Date(entry.entryDate) : null);
    setTags(entry?.tags ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-seed only on identity switch; keying on the fields would clobber in-progress edits when the parent re-passes the same entry
  }, [entry?.id]);

  const initialDate = entry?.entryDate ? new Date(entry.entryDate).getTime() : null;
  const dirty = creating
    ? body.trim() !== '' || tags.length > 0
    : title !== (entry?.title ?? '') ||
      body !== (entry?.body ?? '') ||
      kind !== (entry?.kind ?? defaultKind) ||
      (entryDate?.getTime() ?? null) !== initialDate ||
      tags.join(' ') !== (entry?.tags ?? []).join(' ');

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  async function save() {
    if (!body.trim()) {
      // §6b: on the field, not in a toast. A toast for a validation failure
      // announces itself once and then leaves no trace beside the empty control
      // the user has to go back and fill.
      setError('Write something first');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const payload = {
        body: body.trim(),
        title: title.trim() || undefined,
        kind,
        entryDate: entryDate ? entryDate.toISOString() : '',
        tags,
      };
      let saved: JournalRow;
      try {
        // `apiSend`, NOT a bare `fetch` — on the detached topology a raw fetch
        // goes to the CLIENT origin, which has no /api routes at all.
        ({ journal: saved } = await apiSend<{ journal: JournalRow }>(
          creating ? '/api/journal' : `/api/journal/${entry!.id}`,
          creating ? 'POST' : 'PATCH',
          payload,
        ));
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return; // already bounced to /login
        play('danger');
        toast.error(e instanceof Error ? e.message : 'Save failed');
        return;
      }
      play('success');
      toast.success(creating ? 'Journal entry saved' : 'Saved');
      onSaved(saved);
    } finally {
      setSaving(false);
    }
  }

  // ⌘/Ctrl+S save · Esc cancel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      } else if (e.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, body, kind, entryDate, tags, creating]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      noValidate
    >
      {/* Sticky against the PANE's scroller now (MasterDetail owns it), not an
          inner one of its own — two nested scrollers put two bars side by side
          and made the sticky header stick to the wrong one. */}
      {/* The item header (contract 2026-10-21): the same one row as the
          entry's read view, in edit mode. The title is edited in place; Save
          the one word button; the pressed pencil leaves editing (Cancel). */}
      <ItemHeader
        sticky
        section="Journal"
        visual={<NotebookPen className="size-4" aria-hidden />}
        title={
          <HeaderTitleField
            value={title}
            onChange={setTitle}
            placeholder="Title (optional)"
            label="Journal entry title"
          />
        }
        textActions={
          <SubmitButton pending={saving} size="sm">
            <Check />
            Save journal entry
          </SubmitButton>
        }
        edit={{
          onSelect: onCancel,
          pressed: true,
          label: creating ? 'Cancel the new entry (Esc)' : 'Done editing: discard unsaved (Esc)',
        }}
        infoLabel="About this entry"
      />

      <div className="px-4 py-4">
        <FieldGroup>
          <Field data-invalid={!!error || undefined}>
            {/* The body has no visible label by design — it is the whole point
                of the screen and the placeholder carries the prompt. The label
                exists for screen readers only. */}
            <FieldLabel htmlFor="journal-body" className="sr-only">
              Journal entry
            </FieldLabel>
            <Textarea
              id="journal-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="A short, durable note — who you are, what you expect, what was learned…"
              autoFocus
              aria-invalid={!!error || undefined}
              aria-describedby={error ? 'journal-body-error' : undefined}
              className="min-h-[10rem] resize-y text-base leading-relaxed"
            />
            <FieldError id="journal-body-error">{error}</FieldError>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="journal-kind">Kind</FieldLabel>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger id="journal-kind">
                  <SelectValue placeholder="What is this?" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>About you</SelectLabel>
                    {USER_KINDS.map((k) => (
                      <SelectItem key={k.key} value={k.key}>
                        {k.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectGroup>
                    <SelectLabel>Agent notes</SelectLabel>
                    {AGENT_KINDS.map((k) => (
                      <SelectItem key={k.key} value={k.key}>
                        {k.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="journal-date">When (optional)</FieldLabel>
              <DateTimePicker
                id="journal-date"
                value={entryDate}
                onChange={setEntryDate}
                placeholder="Defaults to now"
                clearable
              />
            </Field>
          </div>

          <Field>
            <FieldLabel asChild>
              <span>Tags</span>
            </FieldLabel>
            <TagInput value={tags} onChange={setTags} placeholder="Add tags — comma or Enter…" />
          </Field>
        </FieldGroup>
      </div>
    </form>
  );
}
