'use client';

import { useEffect, useState } from 'react';
import { Check, FileText } from 'lucide-react';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { TagInput } from '@/components/tag-input';
import { HeaderPill, ItemHeader } from '@/components/layout/item-header';
import { HeaderTitleField } from '@/components/layout/header-fields';
import { AccessSlot } from '@/components/share/access-slot';
import { itemAccess } from '@/lib/item-access';
import { MarkdownEditor } from '@/components/markdown-editor';
import { useToast } from '@mantle/web-ui/ui/toast';
import { ApiError, apiSend } from '@mantle/web-ui/api-fetch';

export type NoteRow = {
  id: string;
  title: string;
  content: string;
  tags: string[];
  summary: string | null;
  createdAt: string;
  updatedAt: string;
  // No audience, inherited or embedded since W5b2 (contract 34): the list's
  // workspace chips and hasLink say who reads it.
};

/**
 * Full-bleed note editor — fills the height + width of its pane (no boxed
 * `max-w-3xl` frame, no fixed editor height). Handles both create (`note=null`
 * → POST) and edit (PATCH). ⌘/Ctrl+S saves, Esc cancels. Reports `dirty` up so
 * the host can guard against discarding unsaved changes when switching notes.
 */
export function NoteEditor({
  note,
  shares,
  onSaved,
  onCancel,
  onDelete,
  onDirtyChange,
}: {
  note: NoteRow | null;
  /** The share marks for Access (`shareMarksOf`). */
  shares?: unknown;
  onSaved: (saved: NoteRow) => void;
  onCancel: () => void;
  /** The header's Delete (an existing note the login may delete). */
  onDelete?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const toast = useToast();
  const creating = note === null;
  const [title, setTitle] = useState(note?.title ?? '');
  const [content, setContent] = useState(note?.content ?? '');
  const [tags, setTags] = useState<string[]>(note?.tags ?? []);
  const [saving, setSaving] = useState(false);

  // Re-seed when the target note changes (e.g. switching which note is edited).
  useEffect(() => {
    setTitle(note?.title ?? '');
    setContent(note?.content ?? '');
    setTags(note?.tags ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-seed only on identity switch; keying on the fields would clobber in-progress edits when the parent re-passes the same note
  }, [note?.id]);

  const dirty = creating
    ? title.trim() !== '' || content.trim() !== '' || tags.length > 0
    : title !== (note?.title ?? '') ||
      content !== (note?.content ?? '') ||
      tags.join('\0') !== (note?.tags ?? []).join('\0');

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  async function save() {
    if (!title.trim()) {
      toast.error('Title is required');
      return;
    }
    setSaving(true);
    try {
      // Through the API client, not a bare fetch: the brain may sit on
      // another origin (a detached frontend, the desktop app).
      let saved: NoteRow;
      try {
        ({ note: saved } = await apiSend<{ note: NoteRow }>(
          creating ? '/api/notes' : `/api/notes/${note!.id}`,
          creating ? 'POST' : 'PATCH',
          { title: title.trim(), content, tags },
        ));
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return;
        toast.error(err instanceof Error ? err.message : 'Save failed');
        return;
      }
      toast.success(creating ? 'Note created' : 'Saved');
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
  }, [title, content, tags, creating]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="flex h-full min-h-0 flex-col"
    >
      {/* The item header (contract 2026-10-21): the same one row as the
          read view, in edit mode. The title is edited in place; tags behind
          Info; Save the one word button; the pressed pencil leaves editing
          (Cancel); Focus is the shell's maximise, the same slot as anywhere. */}
      <ItemHeader
        section="Notes"
        visual={<FileText className="size-4" aria-hidden />}
        title={
          <HeaderTitleField
            value={title}
            onChange={setTitle}
            placeholder="Untitled note"
            label="Note title"
            // A new note starts in its title. An existing one does not: a
            // focused long title scrolls to its end and reads cut from the left.
            autoFocus={creating}
          />
        }
        badges={dirty ? <HeaderPill>unsaved</HeaderPill> : null}
        textActions={
          <SubmitButton pending={saving} size="sm">
            <Check />
            {creating ? 'Create note' : 'Save note'}
          </SubmitButton>
        }
        access={
          note ? (
            <AccessSlot
              type="note"
              nodeId={note.id}
              canShare={itemAccess(note).share}
              shares={shares ?? note}
            />
          ) : undefined
        }
        onDelete={onDelete}
        deleteDisabled={!creating && !onDelete}
        deleteLabel="Delete note"
        edit={{
          onSelect: onCancel,
          pressed: true,
          label: creating ? 'Cancel the new note (Esc)' : 'Done editing: discard unsaved (Esc)',
        }}
        info={{
          rows: [
            {
              label: 'Tags',
              value: <TagInput value={tags} onChange={setTags} placeholder="Add tags…" />,
            },
          ],
        }}
        infoLabel="About this note"
      />

      <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-3">
        <MarkdownEditor
          value={content}
          onChange={setContent}
          placeholder="Write in markdown…"
          className="min-h-0 flex-1"
          // Fill the pane at md+ (bounded height); fall back to a usable min
          // height on mobile where the column stacks and height is unbounded.
          height="flex-1 min-h-[24rem] md:min-h-0"
        />
      </div>
    </form>
  );
}
