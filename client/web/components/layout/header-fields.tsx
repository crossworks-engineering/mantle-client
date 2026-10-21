'use client';

import type { KeyboardEvent } from 'react';
import { Button } from '@mantle/web-ui/ui/button';
import { Input } from '@mantle/web-ui/ui/input';
import { EmojiPicker } from '@/components/emoji-picker';
import { HeaderPill } from './item-header';

/**
 * The editors' parts of the item header (contract 2026-10-21): the title is
 * edited in place in the header row, the glyph is the icon picker, and the
 * draft state is the one pill. No title band under the header.
 */

/** The title, edited in place: no box, a bottom underline while focused (a
 *  2px transparent border is always reserved so focusing does not shift the
 *  row). It sizes to its text, so the pill stays beside it. Plain text when
 *  the login may not edit. */
export function HeaderTitleField({
  value,
  onChange,
  onKeyDown,
  placeholder,
  label,
  readOnly = false,
  autoFocus = false,
}: {
  value: string;
  onChange: (v: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  placeholder: string;
  label: string;
  readOnly?: boolean;
  autoFocus?: boolean;
}) {
  if (readOnly) return <>{value || placeholder}</>;
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      aria-label={label}
      autoFocus={autoFocus}
      className="h-7 min-w-24 max-w-full rounded-none border-x-0 border-t-0 border-b-2 border-transparent bg-transparent px-0 py-0 text-[0.9375rem] font-semibold shadow-none transition-colors [field-sizing:content] placeholder:text-muted-foreground/40 focus-visible:border-primary focus-visible:ring-0 md:text-[0.9375rem]"
    />
  );
}

/** The glyph as the icon picker (click to pick or remove). The emoji alone
 *  when the login may not edit. */
export function HeaderIconPicker({
  icon,
  fallback,
  onSelect,
  onClear,
  label,
  readOnly = false,
}: {
  icon: string | null;
  fallback: string;
  onSelect: (icon: string) => void;
  onClear: () => void;
  label: string;
  readOnly?: boolean;
}) {
  if (readOnly) return <span aria-hidden>{icon ?? fallback}</span>;
  return (
    <EmojiPicker
      value={icon}
      onSelect={onSelect}
      onClear={onClear}
      align="start"
      trigger={
        <Button
          type="button"
          variant="ghost"
          aria-label={label}
          title="Change icon"
          className="size-7 shrink-0 rounded-md p-0 text-base leading-none hover:bg-accent"
        >
          {icon ?? fallback}
        </Button>
      }
    />
  );
}

/** An editor's draft state as the header's one pill. */
export function DraftPill({
  committing,
  saving,
  dirty,
}: {
  committing: boolean;
  saving: boolean;
  dirty: boolean;
}) {
  if (committing) return <HeaderPill>committing…</HeaderPill>;
  if (saving) return <HeaderPill>saving…</HeaderPill>;
  if (dirty) {
    return (
      <HeaderPill title="Edits saved as a draft: Commit publishes them">uncommitted</HeaderPill>
    );
  }
  return <HeaderPill>committed</HeaderPill>;
}
