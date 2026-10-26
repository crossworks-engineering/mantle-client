'use client';

import type { ReactNode } from 'react';
import { GripVertical, X } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import { cn } from '@mantle/web-ui/lib/utils';
import { specOf, type DeskWidgetId } from '@/lib/home-desk';
import { useDeskGrid } from './desk-grid';

/**
 * One widget's frame on the desk: a title bar to carry it by (with a grip
 * that also moves and resizes it from the keyboard), the widget's own
 * actions, its body, and a corner grip to resize it. `bare` drops the card
 * so a widget can be its own object on the desk (the sticky notes).
 */
export function DeskWidget({
  id,
  title,
  icon,
  actions,
  onRemove,
  bare = false,
  className,
  bodyClassName,
  children,
}: {
  id: DeskWidgetId;
  title: string;
  icon?: ReactNode;
  actions?: ReactNode;
  onRemove?: () => void;
  bare?: boolean;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  const { nudge, startResize, carrying, narrow } = useDeskGrid();
  const carried = carrying === id;
  return (
    <section
      aria-label={title}
      className={cn(
        'group/widget relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl',
        bare
          ? 'text-foreground'
          : 'border border-border/70 bg-card/85 text-card-foreground shadow-sm backdrop-blur-md',
        carried && 'ring-2 ring-primary/50',
        className,
      )}
    >
      <header
        data-desk-handle
        className={cn(
          'flex h-9 shrink-0 items-center gap-1.5 pl-1 pr-1.5',
          // touch-none: on a tablet a drag on the title bar carries the
          // widget instead of scrolling the desk.
          !narrow && 'cursor-grab touch-none active:cursor-grabbing',
        )}
      >
        {narrow ? (
          <span className="w-1" />
        ) : (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Move ${title}. Arrow keys move it, Shift and an arrow resize it.`}
            onKeyDown={(e) => nudge(id, e)}
            // The grip carries too: a press on it is a press on the title bar.
            data-desk-grip
            className="size-6 cursor-grab text-muted-foreground/60 opacity-0 transition-opacity focus-visible:opacity-100 group-hover/widget:opacity-100"
          >
            <GripVertical aria-hidden />
          </Button>
        )}
        {icon ? (
          <span className="flex size-4 items-center justify-center text-muted-foreground [&>svg]:size-4">
            {icon}
          </span>
        ) : null}
        <h2 className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
        <div className="flex items-center gap-0.5" data-no-drag>
          {actions}
          {onRemove ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-6 opacity-0 transition-opacity group-hover/widget:opacity-100 focus-visible:opacity-100"
              aria-label={`Take ${title} off the desk`}
              onClick={onRemove}
            >
              <X />
            </Button>
          ) : null}
        </div>
      </header>
      <div className={cn('relative min-h-0 flex-1 overflow-y-auto scrollbar-thin', bodyClassName)}>
        {children}
      </div>
      {narrow ? null : (
        <div
          aria-hidden
          onPointerDown={(e) => startResize(id, e)}
          className={cn(
            'absolute bottom-0 right-0 z-10 size-4 touch-none opacity-0 transition-opacity group-hover/widget:opacity-100',
            specOf(id).autoHeight ? 'cursor-ew-resize' : 'cursor-se-resize',
          )}
        >
          <svg viewBox="0 0 16 16" className="size-4 text-muted-foreground/70">
            <path d="M14 6 6 14M14 10l-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
        </div>
      )}
    </section>
  );
}

/** A widget's own small header action. */
export function WidgetAction({
  label,
  onClick,
  children,
  pressed,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  pressed?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-6"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
