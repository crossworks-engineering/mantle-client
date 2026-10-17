'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dices, Loader2, Save, X } from 'lucide-react';
import { apiFetch, apiSend } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { Skeleton } from '@mantle/web-ui/ui/skeleton';
import { Slider } from '@mantle/web-ui/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@mantle/web-ui/ui/toggle-group';
import { useToast } from '@mantle/web-ui/ui/toast';
import { NeatBackdrop } from '@mantle/web-ui/neat-backdrop';
import {
  NEAT_SPEED_MAX,
  decodeNeatSpec,
  encodeNeatSpec,
  randomNeatSpec,
  type NeatBackgroundSpec,
  type NeatTone,
} from '@mantle/share-ui/neat-background';

/**
 * The Neat background generator (Settings → Appearance) — one animated
 * gradient for the whole brain, drawn from the live theme tokens.
 *
 * The user never edits colours or wave maths: GENERATE re-rolls a seed, the
 * two knobs that survive are the ones with an obvious effect (tone, motion),
 * and everything else derives deterministically from the seed. That is the
 * whole interaction: roll until one lands, save it.
 *
 * The preview carries sample content ON the gradient — a floating card and a
 * line of plain text — because "does this fight the text" is the question the
 * screen exists to answer, and a bare swatch cannot answer it.
 *
 * Saved as a spec to `PUT /api/profile/neat-background` (brain-level, like
 * the colour theme), read back from the public /api/appearance — the same
 * route the login screen will resolve it from. The cache is patched in place
 * on save rather than invalidated: /api/appearance is served with a 30s
 * public cache, so a refetch inside that window would report the old value
 * and make the save look lost.
 */

type AppearancePayload = {
  neatBackground?: string | null;
};

const TONE_LABELS: ReadonlyArray<{ value: NeatTone; label: string }> = [
  { value: 'darker', label: 'Darker' },
  { value: 'auto', label: 'Auto' },
  { value: 'lighter', label: 'Lighter' },
];

export function NeatGenerator() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const appearance = useQuery({
    queryKey: ['appearance'],
    queryFn: () => apiFetch<AppearancePayload>('/api/appearance'),
  });

  const saved = appearance.data ? decodeNeatSpec(appearance.data.neatBackground) : null;
  // The draft starts as the saved background (so the preview opens truthful)
  // or a first roll; null means the query hasn't answered yet.
  const [draft, setDraft] = useState<NeatBackgroundSpec | null>(null);
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);
  if (draft === null && appearance.isSuccess) {
    setDraft(saved ?? randomNeatSpec());
  }

  const dirty = draft !== null && (!saved || encodeNeatSpec(draft) !== encodeNeatSpec(saved));

  const patchCache = (value: string | null) => {
    queryClient.setQueryData<AppearancePayload>(['appearance'], (old) => ({
      ...(old ?? {}),
      neatBackground: value,
    }));
  };

  const save = async () => {
    if (!draft) return;
    setBusy('save');
    try {
      const encoded = encodeNeatSpec(draft);
      await apiSend('/api/profile/neat-background', 'PUT', { neatBackground: encoded });
      patchCache(encoded);
      toast.success('Background saved.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the background.');
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('remove');
    try {
      // '' is the deliberate clear, the same contract as /api/profile/backgrounds.
      await apiSend('/api/profile/neat-background', 'PUT', { neatBackground: '' });
      patchCache(null);
      toast.success('Background removed — surfaces fall back to the plain fill.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove the background.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Background generator
        </h2>
        <p className="text-xs text-muted-foreground">
          An animated gradient drawn from the current colour theme — it follows every theme and
          light/dark mode, and stays close to the page surface so text on it keeps reading. Roll
          until one lands, then save it for the whole brain: it paints the sign-in screen, the area
          behind every screen&apos;s content, and public share pages.{' '}
          <Link href="/settings/appearance/drift" className="underline underline-offset-2">
            Try Drift, its replacement
          </Link>
          .
        </p>
      </div>

      {draft === null ? (
        <Skeleton className="aspect-[21/9] w-full rounded-xl" />
      ) : (
        <>
          {/* The preview IS the renderer the real surfaces will use, with
              sample content on top so legibility is judged, not hoped for. */}
          <div className="relative aspect-[21/9] w-full overflow-hidden rounded-xl border border-border bg-background">
            <NeatBackdrop spec={draft} resolution={0.75} />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-64 max-w-[80%] rounded-xl border border-border bg-card/80 p-4 backdrop-blur-sm">
                <p className="text-sm font-medium text-card-foreground">Text stays readable</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  This panel sits on the gradient the way content will.
                </p>
              </div>
            </div>
            <p className="absolute bottom-2.5 left-4 text-xs text-muted-foreground">
              Plain text directly on the background
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => setDraft(randomNeatSpec(draft))}
            >
              <Dices />
              Generate
            </Button>

            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={draft.tone}
              onValueChange={(tone) => {
                if (tone) setDraft({ ...draft, tone: tone as NeatTone });
              }}
              aria-label="Tone relative to the page surface"
            >
              {TONE_LABELS.map((t) => (
                <ToggleGroupItem key={t.value} value={t.value}>
                  {t.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>

            <div className="flex w-44 items-center gap-2">
              <span className="text-xs text-muted-foreground">Motion</span>
              <Slider
                value={[draft.speed]}
                min={0}
                max={NEAT_SPEED_MAX}
                step={0.5}
                onValueChange={(v) => setDraft({ ...draft, speed: v[0] ?? draft.speed })}
                aria-label="Animation speed"
              />
            </div>

            <div className="ml-auto flex items-center gap-2">
              {saved && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  disabled={busy !== null}
                  onClick={() => void remove()}
                >
                  {busy === 'remove' ? <Loader2 className="animate-spin" /> : <X />}
                  Remove
                </Button>
              )}
              <Button size="sm" disabled={busy !== null || !dirty} onClick={() => void save()}>
                {busy === 'save' ? <Loader2 className="animate-spin" /> : <Save />}
                Save background
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
