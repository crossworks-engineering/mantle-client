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
import { DriftThemeBackdrop } from '@mantle/web-ui/drift-backdrop';
import {
  DRIFT_SPEED_MAX,
  DRIFT_STYLES,
  decodeDriftSpec,
  encodeDriftSpec,
  randomDriftSpec,
  type DriftSpec,
  type DriftStyle,
  type DriftTone,
} from '@mantle/share-ui/drift';
import { play } from '@/lib/sounds/play';

/**
 * The background generator (Settings > Appearance): one animated Drift
 * background for the whole brain, drawn from the live theme tokens.
 *
 * The everyday knobs only: GENERATE re-rolls the seed, and the shape, tone
 * and motion have an obvious effect. Every other option keeps its value (the
 * Drift lab, linked below, sets them all and saves through the same path).
 *
 * The preview carries sample content ON the background, a floating card and a
 * line of plain text, because "does this fight the text" is the question the
 * screen exists to answer, and a bare swatch cannot answer it.
 *
 * Saved as a v2 spec to `PUT /api/profile/neat-background` (brain-level, like
 * the colour theme; the route keeps its first name), read back from the
 * public /api/appearance, the route the login screen resolves it from. A
 * Neat-era v1 spec opens here as silk and saves as v2. The cache is patched
 * in place on save rather than invalidated: /api/appearance is served with a
 * 30s public cache, so a refetch inside that window would report the old
 * value and make the save look lost.
 */

type AppearancePayload = {
  neatBackground?: string | null;
};

export const DRIFT_STYLE_LABELS: Record<DriftStyle, string> = {
  mesh: 'Mesh',
  silk: 'Silk',
  aurora: 'Aurora',
  dunes: 'Dunes',
  marble: 'Marble',
};

export const DRIFT_TONE_LABELS: ReadonlyArray<{ value: DriftTone; label: string }> = [
  { value: 'darker', label: 'Darker' },
  { value: 'auto', label: 'Auto' },
  { value: 'lighter', label: 'Lighter' },
];

/** The brain's saved background, decoded (v1 or v2), and the one save path
 *  the generator and the Drift lab share. `saved` is undefined until the
 *  appearance query answers, null when no background is set. */
export function useSavedBackground() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const appearance = useQuery({
    queryKey: ['appearance'],
    queryFn: () => apiFetch<AppearancePayload>('/api/appearance'),
  });
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);
  const saved: DriftSpec | null | undefined = appearance.isSuccess
    ? decodeDriftSpec(appearance.data.neatBackground)
    : undefined;

  const patchCache = (value: string | null) => {
    queryClient.setQueryData<AppearancePayload>(['appearance'], (old) => ({
      ...(old ?? {}),
      neatBackground: value,
    }));
  };

  const save = async (spec: DriftSpec) => {
    setBusy('save');
    try {
      const encoded = encodeDriftSpec(spec);
      await apiSend('/api/profile/neat-background', 'PUT', { neatBackground: encoded });
      patchCache(encoded);
      play('success');
      toast.success('Background saved.');
    } catch (err) {
      play('danger');
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
      toast.success('Background removed. Surfaces fall back to the plain fill.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove the background.');
    } finally {
      setBusy(null);
    }
  };

  const isDirty = (draft: DriftSpec | null) =>
    draft !== null && (!saved || encodeDriftSpec(draft) !== encodeDriftSpec(saved));

  return { saved, busy, save, remove, isDirty };
}

export function BackgroundGenerator() {
  const { saved, busy, save, remove, isDirty } = useSavedBackground();
  // The draft starts as the saved background (so the preview opens truthful)
  // or a first roll; null means the query hasn't answered yet.
  const [draft, setDraft] = useState<DriftSpec | null>(null);
  if (draft === null && saved !== undefined) {
    setDraft(saved ?? randomDriftSpec());
  }
  const dirty = isDirty(draft);

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Background generator
        </h2>
        <p className="text-xs text-muted-foreground">
          An animated background drawn from the current colour theme. It follows every theme and
          light/dark mode. Roll until one lands, then save it for the whole brain: it paints the
          area behind every screen&apos;s content, the sign-in and invite screens, and public share
          pages.{' '}
          <Link href="/settings/appearance/drift" className="underline underline-offset-2">
            Every option is in the Drift lab
          </Link>
          .
        </p>
      </div>

      {draft === null ? (
        <Skeleton className="aspect-[21/9] w-full rounded-xl" />
      ) : (
        <>
          {/* The preview IS the renderer the real surfaces use (the in-app
              surface), with sample content on top so legibility is judged,
              not hoped for. */}
          <div className="relative aspect-[21/9] w-full overflow-hidden rounded-xl border border-border bg-background">
            <DriftThemeBackdrop spec={draft} surface="app" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-64 max-w-[80%] rounded-xl border border-border bg-card/80 p-4 backdrop-blur-sm">
                <p className="text-sm font-medium text-card-foreground">Text stays readable</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  This panel sits on the background the way content will.
                </p>
              </div>
            </div>
            <p className="absolute bottom-2.5 left-4 text-xs text-muted-foreground">
              Plain text directly on the background
            </p>
          </div>
          {/* The preview paints the in-app look (the floored 'app' surface);
              the public screens paint the same spec in full colour, so say
              so rather than let the preview promise one look for both. */}
          <p className="text-xs text-muted-foreground">
            This is the in-app look, kept close to the page so text on it reads. The sign-in, invite
            and shared pages show it in full colour, with their text on a solid card.
          </p>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => setDraft(randomDriftSpec(draft))}
            >
              <Dices />
              Generate
            </Button>

            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={draft.style}
              onValueChange={(style) => {
                if (style) setDraft({ ...draft, style: style as DriftStyle });
              }}
              aria-label="Shape"
            >
              {DRIFT_STYLES.map((s) => (
                <ToggleGroupItem key={s} value={s}>
                  {DRIFT_STYLE_LABELS[s]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>

            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={draft.tone}
              onValueChange={(tone) => {
                if (tone) setDraft({ ...draft, tone: tone as DriftTone });
              }}
              aria-label="Tone relative to the page surface"
            >
              {DRIFT_TONE_LABELS.map((t) => (
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
                max={DRIFT_SPEED_MAX}
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
              <Button size="sm" disabled={busy !== null || !dirty} onClick={() => void save(draft)}>
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
