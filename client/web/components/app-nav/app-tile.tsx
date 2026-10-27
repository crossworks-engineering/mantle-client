import { AppWindow, Folder, Users } from 'lucide-react';
import { cn } from '@mantle/web-ui/lib/utils';
import { LUCIDE_ICON_PREFIX, type AppTint } from '@mantle/client-types/app-nav';
import { APP_ICONS } from './app-icons';

/**
 * Tile classes per tint key. Literal strings on purpose: Tailwind v4 only
 * emits classes it can find verbatim, so `bg-app-tint-${key}` would render
 * nothing. The colours themselves are theme-mixed tokens (globals.css), which
 * is what keeps them legible on every theme and in both modes.
 */
export const TINT_CLASSES: Record<AppTint, string> = {
  slate: 'bg-app-tint-slate text-app-tint-slate-ink',
  red: 'bg-app-tint-red text-app-tint-red-ink',
  orange: 'bg-app-tint-orange text-app-tint-orange-ink',
  amber: 'bg-app-tint-amber text-app-tint-amber-ink',
  lime: 'bg-app-tint-lime text-app-tint-lime-ink',
  green: 'bg-app-tint-green text-app-tint-green-ink',
  teal: 'bg-app-tint-teal text-app-tint-teal-ink',
  cyan: 'bg-app-tint-cyan text-app-tint-cyan-ink',
  sky: 'bg-app-tint-sky text-app-tint-sky-ink',
  blue: 'bg-app-tint-blue text-app-tint-blue-ink',
  indigo: 'bg-app-tint-indigo text-app-tint-indigo-ink',
  violet: 'bg-app-tint-violet text-app-tint-violet-ink',
  pink: 'bg-app-tint-pink text-app-tint-pink-ink',
};

/** The neutral tile: no tint chosen. */
const NEUTRAL = 'bg-muted text-muted-foreground';

const SIZES = {
  // A workspace's mark beside a tree row's name (share marks, task ca907a89).
  xs: { tile: 'size-4 rounded-[4px] text-[9px]', icon: 'size-2.5' },
  sm: { tile: 'size-5 rounded-[5px] text-[11px]', icon: 'size-3' },
  md: { tile: 'size-6 rounded-md text-sm', icon: 'size-3.5' },
  lg: { tile: 'size-9 rounded-lg text-lg', icon: 'size-5' },
  // A circle the size of the rail's profile avatar (28px), so the workspace
  // switcher's face lines up with the login's face above it.
  avatar: { tile: 'size-7 rounded-full text-sm', icon: 'size-4' },
  // A chat group's face, the size of the people's avatars beside it.
  'face-xs': { tile: 'size-6 rounded-full text-xs', icon: 'size-3.5' },
  'face-sm': { tile: 'size-8 rounded-full text-base', icon: 'size-4' },
  'face-md': { tile: 'size-10 rounded-full text-lg', icon: 'size-5' },
} as const;

/**
 * An app, folder or chat group face: an icon (emoji or curated lucide) on a
 * tinted tile.
 * An icon this client doesn't know, or none at all, falls back to the default
 * glyph for the kind, so a stale stored name never renders as broken text.
 */
export function AppTile({
  icon,
  color,
  kind = 'app',
  size = 'md',
  className,
}: {
  icon?: string | null;
  color?: AppTint | null;
  kind?: 'app' | 'folder' | 'group';
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const s = SIZES[size];
  const Lucide = icon?.startsWith(LUCIDE_ICON_PREFIX)
    ? APP_ICONS[icon.slice(LUCIDE_ICON_PREFIX.length)]
    : undefined;
  const emoji = icon && !icon.startsWith(LUCIDE_ICON_PREFIX) ? icon : null;
  const Fallback = kind === 'folder' ? Folder : kind === 'group' ? Users : AppWindow;
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center leading-none',
        s.tile,
        color ? TINT_CLASSES[color] : NEUTRAL,
        className,
      )}
    >
      {Lucide ? (
        <Lucide className={s.icon} />
      ) : emoji ? (
        <span>{emoji}</span>
      ) : (
        <Fallback className={s.icon} />
      )}
    </span>
  );
}
