'use client';

/**
 * The group info field (plan section 24), shared by the New message form
 * and a group's details: a textarea under the group's name, "Info", with
 * the counter against the brain's 2000 characters (spoken only near the
 * cap, as the composer's is). The text is sent trimmed: the create leaves
 * an empty one out, Details sends null to clear.
 */
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
  readOnly,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  /** While a save runs: the text stays, the focus too. */
  readOnly?: boolean;
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
        readOnly={readOnly}
        placeholder={INFO_PLACEHOLDER}
        aria-describedby={`${id}-count`}
        aria-invalid={counter.over || undefined}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-20 resize-y"
      />
      <span
        id={`${id}-count`}
        className={cn(
          'text-right text-xs tabular-nums',
          counter.over ? 'text-destructive-ink' : 'text-muted-foreground',
        )}
        aria-live={counter.near ? 'polite' : 'off'}
      >
        {counter.text}
      </span>
    </Field>
  );
}
