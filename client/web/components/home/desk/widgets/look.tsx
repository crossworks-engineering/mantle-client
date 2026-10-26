'use client';

import { useEffect, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import {
  Dices,
  Gauge,
  ImageOff,
  Monitor,
  Moon,
  Palette,
  Shapes,
  Sparkles,
  Sun,
  Wallpaper,
  Waves,
} from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@mantle/web-ui/ui/toggle-group';
import { useColorTheme } from '@mantle/web-ui/color-theme-provider';
import { DriftThemeBackdrop } from '@mantle/web-ui/drift-backdrop';
import { COLOR_THEMES, themeLabel } from '@mantle/web-ui/lib/themes';
import {
  DRIFT_SPEED_MAX,
  DRIFT_STYLES,
  randomDriftSpec,
  type DriftSpec,
} from '@mantle/share-ui/drift';
import { cn } from '@mantle/web-ui/lib/utils';
import {
  DRIFT_STYLE_LABELS,
  useSavedBackground,
} from '@/components/appearance/background-generator';
import type { DeskWidgetId } from '@/lib/home-desk';
import { DeskWidget, WidgetAction } from '../desk-widget';

// ── Theme ──────────────────────────────────────────────────────────────────

/**
 * The room's look in one place: light, dark or the system's, and the colour
 * theme as a strip of swatches (click one to wear it), with a dice for a
 * random one.
 */
export function ThemeWidget({ id, onRemove }: { id: DeskWidgetId; onRemove: () => void }) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { colorTheme, setColorTheme, shuffleNow } = useColorTheme();
  const [mounted, setMounted] = useState(false);
  const current = useRef<HTMLButtonElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => setMounted(true), []);
  // Centre the worn theme in the strip. The strip's own scroll only:
  // scrollIntoView would also scroll the desk to this widget on load.
  useEffect(() => {
    const el = strip.current;
    const on = current.current;
    if (!el || !on) return;
    // The strip is `relative`, so a swatch's offsetLeft is its place in it.
    el.scrollLeft = on.offsetLeft - (el.clientWidth - on.clientWidth) / 2;
  }, [colorTheme, mounted]);
  const mode = resolvedTheme === 'dark' ? 'dark' : 'light';

  return (
    <DeskWidget
      id={id}
      title="Theme"
      icon={<Palette />}
      onRemove={onRemove}
      actions={
        <WidgetAction label="Surprise me with a theme" onClick={shuffleNow}>
          <Sparkles />
        </WidgetAction>
      }
    >
      <div className="flex h-full flex-col justify-center gap-2 px-3 pb-3">
        <div className="flex items-center gap-2">
          <ToggleGroup
            type="single"
            size="sm"
            value={mounted ? (theme ?? 'system') : ''}
            onValueChange={(v) => v && setTheme(v)}
            aria-label="Light or dark"
          >
            <ToggleGroupItem value="light" aria-label="Light">
              <Sun />
            </ToggleGroupItem>
            <ToggleGroupItem value="dark" aria-label="Dark">
              <Moon />
            </ToggleGroupItem>
            <ToggleGroupItem value="system" aria-label="Same as the system">
              <Monitor />
            </ToggleGroupItem>
          </ToggleGroup>
          <span className="min-w-0 truncate text-sm text-muted-foreground">
            {mounted ? themeLabel(colorTheme) : ' '}
          </span>
        </div>
        <div
          ref={strip}
          className="relative flex gap-1.5 overflow-x-auto py-1 scrollbar-thin"
          role="listbox"
          aria-label="Colour theme"
        >
          {COLOR_THEMES.map((t) => {
            const [a, b, c] = t.swatches[mode];
            const on = mounted && t.id === colorTheme;
            return (
              <Button
                key={t.id}
                ref={on ? current : undefined}
                variant="ghost"
                size="icon"
                role="option"
                aria-selected={on}
                aria-label={t.label}
                title={t.label}
                onClick={() => setColorTheme(t.id)}
                className={cn(
                  'size-7 shrink-0 rounded-full p-0 ring-offset-2 ring-offset-card transition-transform hover:scale-110',
                  on && 'ring-2 ring-ring',
                )}
              >
                {/* The theme's own three colours: data from the theme
                    registry, not a colour chosen here. */}
                <span
                  aria-hidden
                  className="size-6 rounded-full border border-border/60"
                  style={{ background: `conic-gradient(${a} 0 33%, ${b} 0 66%, ${c} 0)` }}
                />
              </Button>
            );
          })}
        </div>
      </div>
    </DeskWidget>
  );
}

// ── Drift ──────────────────────────────────────────────────────────────────

/**
 * A window onto Drift, the moving background, running live on the desk.
 * Anyone can play with it: roll a new one, step through the shapes, speed it
 * up or calm it down; the window shows the result at once. An admin can then
 * hang it as the brain's background (or take the background down), the same
 * save the Appearance settings make.
 */
export function DriftWidget({
  id,
  canSave,
  onRemove,
}: {
  id: DeskWidgetId;
  canSave: boolean;
  onRemove: () => void;
}) {
  const { saved, busy, save, remove, isDirty } = useSavedBackground();
  const [draft, setDraft] = useState<DriftSpec | null>(null);
  if (draft === null && saved !== undefined) setDraft(saved ?? randomDriftSpec());
  const nextStyle = () =>
    draft &&
    setDraft({
      ...draft,
      style: DRIFT_STYLES[(DRIFT_STYLES.indexOf(draft.style) + 1) % DRIFT_STYLES.length] ?? 'mesh',
    });
  const speeds = [0.5, 2, Math.min(5, DRIFT_SPEED_MAX)];
  const nextSpeed = () => {
    if (!draft) return;
    const at = speeds.findIndex((s) => s >= draft.speed - 0.01);
    setDraft({ ...draft, speed: speeds[(at + 1) % speeds.length] ?? 2 });
  };
  const speedLabel = !draft
    ? ''
    : draft.speed <= 0.6
      ? 'Calm'
      : draft.speed <= 2.1
        ? 'Easy'
        : 'Lively';

  return (
    <DeskWidget
      id={id}
      title="Drift"
      icon={<Waves />}
      onRemove={onRemove}
      bodyClassName="overflow-hidden"
      actions={
        <WidgetAction
          label="Roll a new Drift"
          onClick={() => setDraft(randomDriftSpec(draft ?? undefined))}
        >
          <Dices />
        </WidgetAction>
      }
    >
      <div className="absolute inset-0 overflow-hidden rounded-b-xl">
        {draft ? (
          <DriftThemeBackdrop spec={draft} surface="app" className="absolute inset-0" />
        ) : null}
        <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-1 bg-gradient-to-t from-card/90 to-transparent p-2 pt-6">
          <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={nextStyle}>
            <Shapes /> {draft ? DRIFT_STYLE_LABELS[draft.style] : ''}
          </Button>
          <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={nextSpeed}>
            <Gauge /> {speedLabel}
          </Button>
          {canSave ? (
            <>
              <span className="flex-1" />
              {saved ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  disabled={busy !== null}
                  onClick={() => void remove()}
                  title="Take the background down"
                >
                  <ImageOff />
                </Button>
              ) : null}
              <Button
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={busy !== null || !draft || !isDirty(draft)}
                onClick={() => draft && void save(draft)}
                title="Use this as the background everywhere"
              >
                <Wallpaper /> Hang it
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </DeskWidget>
  );
}
