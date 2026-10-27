'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, ScanSearch } from 'lucide-react';
import { apiFetch } from '@mantle/web-ui/api-fetch';
import { useAssetUrl } from '@mantle/web-ui/hooks/use-asset-url';
import { cn } from '@mantle/web-ui/lib/utils';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import type {
  PresentCheckItemDTO,
  PresentChecksDTO,
  PresentCircuitChecksDTO,
} from '@mantle/client-types';

/** The query key of a canvas's image check overview. */
export const presentChecksKey = (id: string) => ['presents', id, 'checks'] as const;

const KIND: Record<PresentCheckItemDTO['kind'], string> = {
  join: 'join',
  end: 'pipe end',
  link: 'sheet link',
  valve: 'valve type',
};

/** What an answer says, as a pill: ink roles only (a status fill used as
 *  text can vanish on some themes). */
const ANSWER: Record<PresentCheckItemDTO['answer'], { label: string; tone: string }> = {
  yes: { label: 'checked by image', tone: 'border-success-ink/40 text-success-ink' },
  no: { label: 'image says no', tone: 'border-destructive-ink/40 text-destructive-ink' },
  unsure: { label: 'unsure', tone: 'border-muted-foreground/40 text-muted-foreground' },
};

/** The short note on the folded row (the brain's full note shows open). */
const FOLDED_NOTE = 'Image checks help; they are not a guarantee. Verify on the drawing.';

/** "12 checked by image · 1 image says no · 2 unsure", the parts there are. */
export function countsLine(c: PresentCircuitChecksDTO['counts']): string {
  const parts = [
    c.checked ? `${c.checked} checked by image` : '',
    c.no ? `${c.no} image says no` : '',
    c.unsure ? `${c.unsure} unsure` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'no image checks yet';
}

/**
 * The image check overview of a traced P&ID canvas, under its frame (DWG
 * phase 6 v2): what the brain's Checks tabs hold for the circuit the
 * drawing was traced from (GET /api/presents/:id/checks). Outside the
 * frame, so the canvas stays a plain Present; Page embeds and share links
 * show the drawing only. Hidden for any canvas the brain says is not a
 * traced P&ID, and folded by default: one row with the counts.
 *
 * Image checks help; they are not a guarantee: the folded row says so
 * (FOLDED_NOTE, on its own line on a narrow screen), and the brain's note
 * and limits say so first once open. Crops are ordinary files, loaded and
 * opened with the reader's own rights.
 */
export function PresentChecksPanel({ presentId, rev }: { presentId: string; rev: number }) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    // The rev: a new save (a new trace) reads the overview again.
    queryKey: [...presentChecksKey(presentId), rev],
    queryFn: () =>
      apiFetch<{ checks: PresentChecksDTO }>(`/api/presents/${presentId}/checks`).then(
        (r) => r.checks,
      ),
    staleTime: 30_000,
    // A brain without the route (older than phase 6) answers 404: no panel,
    // and no retries.
    retry: false,
  });
  const checks = query.data;
  if (!checks?.traced || !checks.circuits.length) return null;
  const summary = checks.circuits
    .map((c) => `Circuit ${c.circuit}: ${countsLine(c.counts)}`)
    .join(' · ');

  return (
    <section aria-label="Image checks" className="shrink-0 border-t border-border bg-background">
      <RowButton
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={FOLDED_NOTE}
        className="flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 px-4 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-foreground/[0.04]"
      >
        <ScanSearch className="size-3.5 shrink-0" aria-hidden />
        <span className="font-medium text-foreground">Image checks</span>
        <span className="min-w-0 truncate">{summary}</span>
        <span className="order-last w-full min-w-0 truncate md:order-none md:w-auto md:shrink">
          <span className="hidden md:inline">· </span>
          {FOLDED_NOTE}
        </span>
        <ChevronRight
          className={cn('ml-auto size-3.5 shrink-0 transition-transform', open && 'rotate-90')}
          aria-hidden
        />
      </RowButton>
      {open && (
        <div className="max-h-[40vh] overflow-y-auto px-4 pb-3 scrollbar-thin">
          <p className="pb-1 text-xs text-muted-foreground">{checks.note}</p>
          {checks.limits.length > 0 && (
            <ul className="space-y-0.5 pb-2 text-xs text-muted-foreground">
              {checks.limits.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
          {checks.circuits.map((c) => (
            <CircuitChecks key={c.circuit} circuit={c} />
          ))}
        </div>
      )}
    </section>
  );
}

function CircuitChecks({ circuit }: { circuit: PresentCircuitChecksDTO }) {
  if (!circuit.items.length)
    return (
      <p className="py-2 text-xs text-muted-foreground">
        Circuit {circuit.circuit}: no image checks yet.
      </p>
    );
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {circuit.items.map((it, i) => (
        <CheckRow key={`${it.tableId}:${it.checkedAt}:${i}`} item={it} />
      ))}
      {circuit.more ? (
        <li className="px-3 py-2 text-xs text-muted-foreground">
          {circuit.more} more in the drawing tables&apos; Checks tabs.
        </li>
      ) : null}
    </ul>
  );
}

/** A crop's thumbnail, linked to the file. A crop the reader may not open
 *  (not shared with them, or gone) says so in place of a broken image. */
function CropThumb({ id, label }: { id: string; label: string }) {
  const toAsset = useAssetUrl();
  const [failed, setFailed] = useState(false);
  const box = 'block size-16 overflow-hidden rounded-md border border-border bg-muted/30';
  if (failed)
    return (
      <span
        className={cn(
          box,
          'flex items-center p-1 text-center text-xs leading-tight text-muted-foreground',
        )}
      >
        crop unavailable (not shared with you, or gone)
      </span>
    );
  return (
    <a
      href={toAsset(`/api/files/files/${id}?raw=1`)}
      target="_blank"
      rel="noreferrer"
      className={box}
      aria-label={label}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={toAsset(`/api/files/files/${id}?thumb=1`)}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className="size-full object-cover"
      />
    </a>
  );
}

function CheckRow({ item }: { item: PresentCheckItemDTO }) {
  const answer = ANSWER[item.answer];
  const when = new Date(item.checkedAt);
  return (
    <li className="flex gap-3 px-3 py-2">
      <div className="flex shrink-0 gap-1">
        {item.crops.slice(0, 2).map((id, i) => (
          <CropThumb
            key={id}
            id={id}
            label={`Open crop ${i + 1} of the ${KIND[item.kind]} check`}
          />
        ))}
      </div>
      <div className="min-w-0 flex-1 space-y-1 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4',
              answer.tone,
            )}
          >
            {answer.label}
          </span>
          <span className="text-muted-foreground">
            {KIND[item.kind]} · {item.sheet}
          </span>
        </div>
        <p className="text-foreground">{item.question}</p>
        {item.alternative && (
          <p className="text-foreground">
            The image names: <span className="font-medium">{item.alternative}</span>
          </p>
        )}
        {item.reason && <p className="text-muted-foreground">{item.reason}</p>}
        <p className="text-xs text-muted-foreground">
          {item.model}
          {Number.isNaN(when.getTime()) ? '' : ` · ${when.toLocaleString()}`}
        </p>
      </div>
    </li>
  );
}
