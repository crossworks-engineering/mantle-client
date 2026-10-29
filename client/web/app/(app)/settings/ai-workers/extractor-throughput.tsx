'use client';

import { useEffect, useState, useTransition } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, apiSend } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { Input } from '@mantle/web-ui/ui/input';
import { Label } from '@mantle/web-ui/ui/label';
import { FieldHint, hintId } from '@mantle/web-ui/ui/field-hint';
import { useToast } from '@mantle/web-ui/ui/toast';
import { play } from '@/lib/sounds/play';

/** GET /api/embedding/extraction. Local type: the brain route is new and the
 *  shape is small, so it does not need a contract package bump. */
export type ExtractionStatus = {
  concurrency: { saved: number | null; effective: number; default: number; max: number };
  queue: {
    running: number;
    waiting: number;
    retrying: number;
    doneLast10Min: number;
    deadLettered: number;
  };
};

export const EXTRACTION_STATUS_KEY = ['embedding', 'extraction'] as const;

export function useExtractionStatus() {
  return useQuery({
    queryKey: EXTRACTION_STATUS_KEY,
    queryFn: () => apiFetch<ExtractionStatus>('/api/embedding/extraction'),
    refetchInterval: 10_000,
  });
}

/** One line: what the extractor is doing now. */
export function ExtractorQueueStatus({ status }: { status: ExtractionStatus | undefined }) {
  if (!status) return null;
  const q = status.queue;
  const parts = [
    `${q.running} working now`,
    `${q.waiting} waiting`,
    `${q.doneLast10Min} done in the last 10 min`,
  ];
  if (q.retrying > 0) parts.push(`${q.retrying} retrying`);
  if (q.deadLettered > 0) parts.push(`${q.deadLettered} failed`);
  return (
    <p className="text-xs text-muted-foreground" aria-live="polite">
      {parts.join(' · ')}
    </p>
  );
}

/** Set how many files the extractor indexes at once. Saves only this one
 *  value; the brain applies it within 30 seconds, no restart. */
export function ExtractorThroughput() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const statusQuery = useExtractionStatus();
  const status = statusQuery.data;
  const [value, setValue] = useState('');
  const [pending, startTransition] = useTransition();

  // Fill the field once the saved value arrives; later polls leave edits alone.
  const saved = status?.concurrency.saved;
  const loaded = status !== undefined;
  useEffect(() => {
    if (loaded) setValue(saved == null ? '' : String(saved));
  }, [loaded, saved]);

  function save() {
    const trimmed = value.trim();
    const concurrency = trimmed === '' ? null : Number.parseInt(trimmed, 10);
    startTransition(async () => {
      try {
        const res = await apiSend<{ ok: true; effective: number } | { ok: false; error: string }>(
          '/api/embedding/extraction',
          'PATCH',
          { concurrency },
        );
        if (res.ok) {
          play('success');
          toast.success(`Extractor set to ${res.effective} at once. It applies within 30 seconds.`);
          // The Embedding page seeds its form from this row: drop its cache so
          // it never shows (and re-saves) the old count.
          queryClient.removeQueries({ queryKey: ['embedding'], exact: true });
          await queryClient.invalidateQueries({ queryKey: EXTRACTION_STATUS_KEY });
        } else {
          play('danger');
          toast.error(`Save failed: ${res.error}`);
        }
      } catch (err) {
        play('danger');
        toast.error(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  }

  const max = status?.concurrency.max ?? 16;
  const def = status?.concurrency.default ?? 2;
  return (
    <section className="space-y-2 rounded-md border border-border p-4">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor="extractor_concurrency" className="text-sm font-semibold">
          Files indexed at once
        </Label>
        {status ? (
          <span className="text-xs text-muted-foreground">
            Running with {status.concurrency.effective}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Input
          id="extractor_concurrency"
          type="number"
          min={1}
          max={max}
          className="w-24"
          value={value}
          placeholder={`default ${def}`}
          onChange={(e) => setValue(e.target.value)}
          aria-describedby={hintId('extractor_concurrency')}
        />
        <Button type="button" size="sm" onClick={save} disabled={pending || !loaded}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
      <FieldHint
        id="extractor_concurrency"
        warn="Past what the box has cores for, everything slows down together."
      >
        1 to {max}. Blank uses the default ({def}). It applies within 30 seconds, no restart. A box
        that sends extraction to a hosted model can run 8 or more. A CPU-only box should stay at 1
        or 2.
      </FieldHint>
      <ExtractorQueueStatus status={status} />
    </section>
  );
}
