'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Ban } from 'lucide-react';
import { cn } from '@mantle/web-ui/lib/utils';
import { Button } from '@mantle/web-ui/ui/button';
import { Input } from '@mantle/web-ui/ui/input';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@mantle/web-ui/ui/popover';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@mantle/web-ui/ui/tabs';
import { APP_TINTS, LUCIDE_ICON_PREFIX, type AppTint } from '@mantle/client-types/app-nav';
import { EMOJI_SECTIONS } from '../emoji-picker';
import { APP_ICONS, APP_ICON_CATEGORIES } from './app-icons';
import { AppTile, TINT_CLASSES } from './app-tile';

export type AppLook = { icon?: string; color?: AppTint | null };

const EMOJI = EMOJI_SECTIONS.flatMap((s) => s.items);

/**
 * The look fields without a surface: the colour row, then the icon and emoji
 * tabs with their search, and the reset. The popover below (an existing app
 * or folder) and the new-folder dialog (folder-dialogs.tsx) render this one
 * component, so there is one grid, one search and one set of controls. Each
 * choice reports at once through `onChange`; what to do with it (save, or
 * hold until the dialog submits) is the caller's.
 */
export function AppLookFields({
  icon,
  color,
  onChange,
  surface = 'popover',
  autoFocusSearch = false,
}: {
  icon: string | null | undefined;
  color: AppTint | null | undefined;
  onChange: (look: AppLook) => void;
  /** What it sits on: the selected swatch's ring is offset in that colour. */
  surface?: 'popover' | 'dialog';
  /** The popover moves focus to the search; a dialog keeps it on its name. */
  autoFocusSearch?: boolean;
}) {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const isLucide = !!icon?.startsWith(LUCIDE_ICON_PREFIX);
  const [tab, setTab] = useState<'icons' | 'emoji'>(icon && !isLucide ? 'emoji' : 'icons');
  const ringOffset = surface === 'dialog' ? 'ring-offset-background' : 'ring-offset-popover';

  const iconHits = useMemo(
    () =>
      query ? Object.keys(APP_ICONS).filter((n) => n.replace(/-/g, ' ').includes(query)) : null,
    [query],
  );
  const emojiHits = useMemo(
    () => (query ? EMOJI.filter((x) => x.k.includes(query)) : null),
    [query],
  );

  const iconCell = (name: string) => {
    const Icon = APP_ICONS[name]!;
    const value = `${LUCIDE_ICON_PREFIX}${name}`;
    return (
      <RowButton
        key={name}
        onClick={() => onChange({ icon: value })}
        title={name.replace(/-/g, ' ')}
        aria-label={name.replace(/-/g, ' ')}
        aria-pressed={icon === value}
        className={cn(
          'flex aspect-square items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
          icon === value && 'bg-accent text-accent-foreground',
        )}
      >
        <Icon className="size-4" />
      </RowButton>
    );
  };

  const emojiCell = (x: { e: string; k: string }) => (
    <RowButton
      key={x.e}
      onClick={() => onChange({ icon: x.e })}
      title={x.k.split(' ')[0]}
      aria-pressed={icon === x.e}
      className={cn(
        'flex aspect-square items-center justify-center rounded text-lg transition-colors hover:bg-accent hover:text-accent-foreground',
        icon === x.e && 'bg-accent text-accent-foreground',
      )}
    >
      {x.e}
    </RowButton>
  );

  return (
    <>
      <p className="mb-1.5 text-xs text-muted-foreground">Colour</p>
      <div className="mb-3 grid grid-cols-7 gap-1.5" role="radiogroup" aria-label="Colour">
        <RowButton
          role="radio"
          aria-checked={!color}
          aria-label="No colour"
          title="No colour"
          onClick={() => onChange({ color: null })}
          className={cn(
            'flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground ring-offset-2',
            ringOffset,
            !color && 'ring-2 ring-ring',
          )}
        >
          <Ban className="size-3.5" />
        </RowButton>
        {APP_TINTS.map((t) => (
          <RowButton
            key={t}
            role="radio"
            aria-checked={color === t}
            aria-label={t}
            title={t}
            onClick={() => onChange({ color: t })}
            className={cn(
              'size-7 rounded-md ring-offset-2',
              ringOffset,
              TINT_CLASSES[t],
              color === t && 'ring-2 ring-ring',
            )}
          >
            <span className="mx-auto block size-2.5 rounded-full bg-current" />
          </RowButton>
        ))}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'icons' | 'emoji')}>
        <div className="mb-2 flex items-center gap-2">
          <TabsList className="h-8">
            <TabsTrigger value="icons" className="text-xs">
              Icons
            </TabsTrigger>
            <TabsTrigger value="emoji" className="text-xs">
              Emoji
            </TabsTrigger>
          </TabsList>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            // Inside a form (the dialog), Enter here must not submit it.
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.preventDefault();
            }}
            placeholder={tab === 'icons' ? 'Search icons' : 'Search emoji'}
            aria-label={tab === 'icons' ? 'Search icons' : 'Search emoji'}
            className="h-8 flex-1"
            autoFocus={autoFocusSearch}
          />
        </div>
        <TabsContent value="icons" className="mt-0">
          <div className="max-h-56 overflow-y-auto scrollbar-thin">
            {iconHits ? (
              iconHits.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">No icons match.</p>
              ) : (
                <div className="grid grid-cols-8 gap-0.5">{iconHits.map(iconCell)}</div>
              )
            ) : (
              APP_ICON_CATEGORIES.map((c) => (
                <div key={c.label} className="mb-1.5">
                  <p className="px-1 pb-1 text-[11px] font-medium text-muted-foreground">
                    {c.label}
                  </p>
                  <div className="grid grid-cols-8 gap-0.5">{c.names.map(iconCell)}</div>
                </div>
              ))
            )}
          </div>
        </TabsContent>
        <TabsContent value="emoji" className="mt-0">
          <div className="max-h-56 overflow-y-auto scrollbar-thin">
            {emojiHits ? (
              emojiHits.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">No emoji match.</p>
              ) : (
                <div className="grid grid-cols-8 gap-0.5">{emojiHits.map(emojiCell)}</div>
              )
            ) : (
              EMOJI_SECTIONS.map((s) => (
                <div key={s.name} className="mb-1.5">
                  <p className="px-1 pb-1 text-[11px] font-medium text-muted-foreground">
                    {s.name}
                  </p>
                  <div className="grid grid-cols-8 gap-0.5">{s.items.map(emojiCell)}</div>
                </div>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>

      {icon && (
        <div className="mt-2 flex justify-end border-t border-border pt-2">
          <Button variant="ghost" size="2xs" onClick={() => onChange({ icon: '' })}>
            Reset icon
          </Button>
        </div>
      )}
    </>
  );
}

/**
 * Pick an app's (or folder's) face: a colour, then an icon from the curated
 * lucide set or an emoji. Each choice applies immediately and the popover
 * stays open, so colour and icon can be tried together against the preview.
 */
export function AppLookPicker({
  icon,
  color,
  kind = 'app',
  label,
  onChange,
  trigger,
  anchor,
  virtualAnchor,
  open: openProp,
  onOpenChange,
  align = 'start',
  side,
  defaultIcon,
}: {
  icon: string | null | undefined;
  color: AppTint | null | undefined;
  kind?: 'app' | 'folder' | 'group';
  /** What the preview shows with no icon picked, when the thing has a
   *  default of its own (a workspace's kind icon). */
  defaultIcon?: string;
  /** Shown beside the preview tile. */
  label: string;
  onChange: (look: AppLook) => void;
  /** The button that opens it (uncontrolled use)… */
  trigger?: ReactNode;
  /** …or, opened from elsewhere (a row's menu), the element to sit beside. */
  anchor?: ReactNode;
  /** …or a DOM element to sit beside, without wrapping it. */
  virtualAnchor?: HTMLElement | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
}) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (o: boolean) => {
    setOpenState(o);
    onOpenChange?.(o);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {trigger ? (
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      ) : virtualAnchor !== undefined ? (
        <PopoverAnchor virtualRef={{ current: virtualAnchor }} />
      ) : (
        <PopoverAnchor asChild>{anchor}</PopoverAnchor>
      )}
      <PopoverContent
        align={align}
        side={side}
        className="w-80 p-3"
        // Close on a click outside or Escape, never on focus moving: a row
        // menu that opens this picker refocuses itself while it animates
        // closed, which read as "focus left" and shut the picker instantly.
        onFocusOutside={(e) => e.preventDefault()}
      >
        <div className="mb-3 flex items-center gap-3">
          <AppTile icon={icon || defaultIcon} color={color} kind={kind} size="lg" />
          <p className="min-w-0 truncate text-sm font-medium">{label}</p>
        </div>
        <AppLookFields icon={icon} color={color} onChange={onChange} autoFocusSearch />
      </PopoverContent>
    </Popover>
  );
}
