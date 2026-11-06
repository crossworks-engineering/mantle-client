'use client';

import { useEffect, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import {
  ChevronsUpDown,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@mantle/web-ui/ui/dropdown-menu';
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

/** A theme's three colours as a pie, a third each, clockwise from the top.
 *  One SVG with no border and nothing light behind it: the first colour is
 *  the whole disc, the other two slices lie on it, so only the disc's own
 *  edge meets the card and no fringe shows. */
export function ThemePie({
  colors: [a, b, c],
  className,
}: {
  colors: readonly [string, string, string];
  className?: string;
}) {
  return (
    <svg viewBox="0 0 2 2" aria-hidden className={cn('size-5 shrink-0', className)}>
      <circle cx="1" cy="1" r="1" fill={a} />
      <path d="M1 1 L1.866 1.5 A1 1 0 0 1 0.134 1.5 Z" fill={b} />
      <path d="M1 1 L0.134 1.5 A1 1 0 0 1 1 0 Z" fill={c} />
    </svg>
  );
}

/**
 * The room's look in one place: light, dark or the system's, and the colour
 * theme from a menu that shows each theme's colours (the worn one marked),
 * with the sparkles for a random one.
 */
export function ThemeWidget({ id, onRemove }: { id: DeskWidgetId; onRemove: () => void }) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { colorTheme, setColorTheme, shuffleNow } = useColorTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const mode = resolvedTheme === 'dark' ? 'dark' : 'light';
  const worn = mounted ? COLOR_THEMES.find((t) => t.id === colorTheme) : undefined;
  // The menu opens on the worn theme: focused, so the arrows start there,
  // and centred in the list's own scroll (never the desk's).
  const menu = useRef<HTMLDivElement>(null);
  const openOnWorn = (open: boolean) => {
    if (!open) return;
    requestAnimationFrame(() => {
      const list = menu.current;
      const on = list?.querySelector<HTMLElement>('[data-state="checked"]');
      if (!list || !on) return;
      list.scrollTop = on.offsetTop - (list.clientHeight - on.offsetHeight) / 2;
      on.focus({ preventScroll: true });
    });
  };

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
          <DropdownMenu onOpenChange={openOnWorn}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                aria-label={`Colour theme: ${mounted ? themeLabel(colorTheme) : ''}`}
                className="min-w-0 flex-1 justify-start gap-2 px-2"
              >
                {worn ? <ThemePie colors={worn.swatches[mode]} /> : null}
                <span className="min-w-0 flex-1 truncate text-left">
                  {mounted ? themeLabel(colorTheme) : '\u00a0'}
                </span>
                <ChevronsUpDown className="text-muted-foreground" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              ref={menu}
              align="end"
              className="relative max-h-80 w-56 overflow-y-auto scrollbar-thin"
            >
              <DropdownMenuRadioGroup
                value={mounted ? colorTheme : ''}
                onValueChange={(v) => setColorTheme(v)}
              >
                {COLOR_THEMES.map((t) => (
                  <DropdownMenuRadioItem key={t.id} value={t.id} className="gap-2">
                    {/* The theme's own three colours: data from the theme
                        registry, not a colour chosen here. */}
                    <ThemePie colors={t.swatches[mode]} />
                    <span className="min-w-0 flex-1 truncate">{t.label}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
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
