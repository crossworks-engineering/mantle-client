'use client';

import { useState } from 'react';
import { KINDS } from '@mantle/content-core/journal-options';
import { Field, FieldError, FieldLabel } from '@mantle/web-ui/ui/field';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { Textarea } from '@mantle/web-ui/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@mantle/web-ui/ui/select';
import { apiSend, ApiError } from '@mantle/web-ui/api-fetch';
import { useToast } from '@mantle/web-ui/ui/toast';
import type { JournalRow } from '@mantle/client-types';
import { play } from '@/lib/sounds/play';

const USER_KINDS = KINDS.filter((k) => k.lane === 'user');

/**
 * Answer one open question (a kind='gap' journal entry). POSTs
 * /api/journal/:id/resolve — the gap is marked resolved and the answer lands
 * as a new user-lane entry every agent carries from then on. Shared by the
 * /journal Questions view and the dashboard "Questions for you" card.
 */
export function GapAnswerForm({
  gap,
  compact = false,
  onResolved,
}: {
  gap: JournalRow;
  /** Dashboard card mode: tighter spacing, no kind select (defaults to context). */
  compact?: boolean;
  onResolved?: (result: { gap: JournalRow; answer: JournalRow }) => void;
}) {
  const toast = useToast();
  const [answer, setAnswer] = useState('');
  const [answerKind, setAnswerKind] = useState('context');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!answer.trim()) {
      setError('Write an answer first');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      let result: { gap: JournalRow; answer: JournalRow };
      try {
        result = await apiSend<{ gap: JournalRow; answer: JournalRow }>(
          `/api/journal/${gap.id}/resolve`,
          'POST',
          { answer: answer.trim(), answerKind },
        );
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return; // already bounced to /login
        play('danger');
        toast.error(e instanceof Error ? e.message : 'Could not save the answer');
        return;
      }
      play('success');
      toast.success('Answered — every agent now carries this');
      setAnswer('');
      onResolved?.(result);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      noValidate
      className={compact ? 'space-y-2' : 'space-y-3'}
    >
      <Field data-invalid={!!error || undefined}>
        <FieldLabel htmlFor={`gap-answer-${gap.id}`} className={compact ? 'sr-only' : undefined}>
          Your answer
        </FieldLabel>
        <Textarea
          id={`gap-answer-${gap.id}`}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Answer in one or two durable sentences…"
          aria-invalid={!!error || undefined}
          aria-describedby={error ? `gap-answer-${gap.id}-error` : undefined}
          className={compact ? 'min-h-[4rem] resize-y text-sm' : 'min-h-[6rem] resize-y'}
        />
        <FieldError id={`gap-answer-${gap.id}-error`}>{error}</FieldError>
      </Field>
      <div className="flex items-center justify-between gap-2">
        {compact ? (
          <span />
        ) : (
          <Select value={answerKind} onValueChange={setAnswerKind}>
            <SelectTrigger size="sm" className="w-40" aria-label="Save the answer as">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {USER_KINDS.map((k) => (
                <SelectItem key={k.key} value={k.key}>
                  {k.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <SubmitButton pending={saving} size="sm">
          Answer question
        </SubmitButton>
      </div>
    </form>
  );
}
