'use client';

/**
 * The group info field (plan section 24), shared by the New message form
 * and a group's details: a textarea under the group's name, "Info", with
 * the counter against the brain's 2000 characters. The text is sent
 * trimmed; nothing sends null.
 */
import type { KeyboardEvent } from 'react';
import { Field, FieldLabel } from '@mantle/web-ui/ui/field';
import { Textarea } from '@mantle/web-ui/ui/textarea';
import { cn } from '@mantle/web-ui/lib/utils';
import { INFO_MAX, infoCounter } from '@/lib/messenger/group-info';

export const INFO_PLACEHOLDER = 'What this group is for and its rules';

export function GroupInfoField({
  id,
  value,
  onChange,
  autoFocus,
  disabled,
  onKeyDown,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const counter = infoCounter(value);
  return (
    <Field>
      <FieldLabel htmlFor={id}>Info</FieldLabel>
      <Textarea
        id={id}
        value={value}
        rows={4}
        maxLength={INFO_MAX}
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={INFO_PLACEHOLDER}
        aria-describedby={`${id}-count`}
        aria-invalid={counter.over || undefined}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        className="min-h-20 resize-y"
      />
      <span
        id={`${id}-count`}
        className={cn(
          'self-end text-xs tabular-nums',
          counter.over ? 'text-destructive-ink' : 'text-muted-foreground',
        )}
        aria-live="polite"
      >
        {counter.text}
      </span>
    </Field>
  );
}
