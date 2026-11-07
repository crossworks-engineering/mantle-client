'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { Input } from '@mantle/web-ui/ui/input';
import { SecretInput } from '@mantle/web-ui/ui/secret-input';
import { Textarea } from '@mantle/web-ui/ui/textarea';
// `Field` here is a SECRET's label/value pair, so the UI primitive is aliased
// rather than the domain type renamed — the domain name is the one on the wire.
import {
  Field as FormField,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@mantle/web-ui/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@mantle/web-ui/ui/select';
import { TagInput } from '@/components/tag-input';

export const KINDS = ['password', 'token', 'server', 'card', 'note', 'other'] as const;
export type Kind = (typeof KINDS)[number];
export type Field = { label: string; value: string };

/** Editable form state (tags as string[] for <TagInput>). */
export type SecretFormValues = {
  title: string;
  description: string;
  kind: Kind;
  tags: string[];
  note: string;
  fields: Field[];
};

/** Cleaned payload sent to the API (create + edit share this shape). */
export type SecretBody = {
  title: string;
  description: string;
  kind: Kind;
  tags: string[];
  note: string;
  fields: Field[];
};

export const emptySecretForm = (): SecretFormValues => ({
  title: '',
  description: '',
  kind: 'password',
  tags: [],
  note: '',
  fields: [{ label: '', value: '' }],
});

/**
 * Shared secret editor body — used by the master-detail "create" pane and the
 * SecretDetail "edit" mode. Owns its own field state + title validation; the
 * parent does the actual fetch in `onSubmit` and switches view on success.
 */
export function SecretForm({
  initial,
  submitLabel,
  submitting,
  onSubmit,
  onCancel,
}: {
  initial: SecretFormValues;
  submitLabel: string;
  submitting?: boolean;
  onSubmit: (body: SecretBody) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<SecretFormValues>(initial);
  const [error, setError] = useState<string | null>(null);

  const setField = (i: number, patch: Partial<Field>) => {
    const next = [...form.fields];
    next[i] = { ...next[i]!, ...patch };
    setForm({ ...form, fields: next });
  };
  const removeField = (i: number) => {
    const next = form.fields.filter((_, j) => j !== i);
    setForm({ ...form, fields: next.length === 0 ? [{ label: '', value: '' }] : next });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const title = form.title.trim();
    if (!title) {
      setError('Title is required');
      return;
    }
    await onSubmit({
      title,
      description: form.description.trim(),
      kind: form.kind,
      tags: form.tags.map((t) => t.trim().toLowerCase()).filter(Boolean),
      note: form.note,
      fields: form.fields.filter((f) => f.label.trim() || f.value.length > 0),
    });
  };

  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <FormField data-invalid={!!error || undefined}>
          <FieldLabel htmlFor="secret-title">Title</FieldLabel>
          <Input
            id="secret-title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="e.g. Contabo VPS — production"
            autoFocus
            aria-invalid={!!error || undefined}
            aria-describedby={error ? 'secret-title-error' : undefined}
          />
          <FieldError id="secret-title-error">{error}</FieldError>
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField>
            <FieldLabel htmlFor="secret-kind">Kind</FieldLabel>
            {/* Was a raw `<select>`: no focus ring, no invalid state (§6d). */}
            <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v as Kind })}>
              <SelectTrigger id="secret-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField>
            <FieldLabel asChild>
              <span>Tags</span>
            </FieldLabel>
            <TagInput
              value={form.tags}
              onChange={(tags) => setForm({ ...form, tags })}
              placeholder="Add tags…"
            />
          </FormField>
        </div>

        <FormField>
          <FieldLabel htmlFor="secret-description">Description</FieldLabel>
          <Textarea
            id="secret-description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Short, safe-to-index description so you (and the assistant) can find this."
            rows={2}
            aria-describedby="secret-description-description"
          />
          <FieldDescription id="secret-description-description">
            Title, description, and tags are indexed by the extractor. The fields + note below are
            sealed (AES-256-GCM) and only shown on reveal.
          </FieldDescription>
        </FormField>

        {/* The encrypted pairs. A boxed sub-group rather than a Field, because
            it holds a repeating pair of controls plus its own Add button — and a
            Field would stretch that button to full width (§6a). */}
        <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Fields (encrypted)</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                setForm({ ...form, fields: [...form.fields, { label: '', value: '' }] })
              }
            >
              <Plus /> Add field
            </Button>
          </div>
          {form.fields.map((f, i) => (
            <div key={i} className="flex gap-2">
              <Input
                placeholder="Label (e.g. username)"
                value={f.label}
                onChange={(e) => setField(i, { label: e.target.value })}
                aria-label={`Field ${i + 1} label`}
                className="w-1/3"
              />
              <SecretInput
                placeholder="Value"
                noun="value"
                autoComplete="off"
                value={f.value}
                onChange={(e) => setField(i, { value: e.target.value })}
                aria-label={`Field ${i + 1} value`}
              />
              {/* `icon-sm` IS size-9 — the hand-written `size-9` was the §5
                  violation, not the dimension. */}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="shrink-0"
                onClick={() => removeField(i)}
                aria-label="Remove field"
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>

        <FormField>
          <FieldLabel htmlFor="secret-note">Note (encrypted)</FieldLabel>
          <Textarea
            data-secret=""
            id="secret-note"
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            placeholder="Free-form notes. Sealed alongside the fields."
            rows={6}
            className="font-mono"
          />
        </FormField>

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <SubmitButton pending={submitting}>{submitLabel}</SubmitButton>
        </div>
      </FieldGroup>
    </form>
  );
}
