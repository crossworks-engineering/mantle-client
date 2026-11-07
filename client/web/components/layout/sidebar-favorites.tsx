'use client';

import { useState, type ReactNode } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, GripVertical, MoreHorizontal, Star, StarOff } from 'lucide-react';
import { cn } from '@mantle/web-ui/lib/utils';
import { Button } from '@mantle/web-ui/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@mantle/web-ui/ui/dropdown-menu';
import { AppTile, TINT_CLASSES } from '@/components/app-nav/app-tile';
import { KIND_ICONS, KIND_TINT } from '@/lib/kind-look';
import type { NavFavoriteItem } from '@/lib/nav-favorites';

/**
 * The sidebar's Favorites group: an item's own look, the empty state, and
 * the rows' order (drag, or Move up and Move down in the row's menu). The
 * list itself is lib/nav-favorites.ts.
 */

/** A favorite item's icon at row size: its own icon on its own colour, or
 *  the kind's icon on the kind's tint (as its Desk icon shows it). */
export function FavoriteGlyph({
  item,
}: {
  item: Pick<NavFavoriteItem, 'kind' | 'icon' | 'color'>;
}) {
  const color = item.color ?? KIND_TINT[item.kind];
  if (item.icon) return <AppTile icon={item.icon} color={color} size="xs" />;
  const KindIcon = KIND_ICONS[item.kind];
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center rounded-[4px]',
        TINT_CLASSES[color],
      )}
    >
      <KindIcon className="size-2.5" />
    </span>
  );
}

export const FAVORITES_EMPTY = 'Add first favorite';

/** No favorites yet. Text, not a button: it says where the stars are. */
export function FavoritesEmpty() {
  return (
    <div
      data-testid="favorites-empty"
      className="flex items-start gap-3 rounded-md border border-dashed border-border px-3 py-2 text-sm group-data-[nav-collapsed=true]/shell:justify-center group-data-[nav-collapsed=true]/shell:border-0 group-data-[nav-collapsed=true]/shell:px-0"
      title={FAVORITES_EMPTY}
    >
      <Star className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 group-data-[nav-collapsed=true]/shell:sr-only">
        <p className="font-medium text-foreground">{FAVORITES_EMPTY}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Star a menu item, or use ... &gt; Add to favorites on a page, app or file.
        </p>
      </div>
    </div>
  );
}

/** The rows' order, by drag. `entries` are the stored entries, in order. */
export function FavoritesSortable({
  entries,
  onMove,
  children,
}: {
  entries: string[];
  onMove: (entry: string, to: string) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) onMove(String(active.id), String(over.id));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={entries} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

/**
 * One favorite, expanded: the link, a grip to drag it, and its menu (also
 * on right-click). Inside a FavoritesSortable. `sortable` false (the filter
 * is on) keeps the grip out: a filtered list has no order to change.
 */
export function FavoriteRow({
  entry,
  name,
  index,
  count,
  sortable,
  onMove,
  onRemove,
  children,
}: {
  entry: string;
  name: string;
  index: number;
  count: number;
  sortable: boolean;
  onMove: (to: number) => void;
  onRemove: () => void;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entry, disabled: !sortable });
  const control =
    'shrink-0 text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover/nav-row:opacity-100 group-focus-within/nav-row:opacity-100 [@media(hover:none)]:opacity-100';
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      data-favorite={entry}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuOpen(true);
      }}
      className={cn(
        'group/nav-row relative flex items-center gap-0.5 rounded-md',
        isDragging && 'z-10 bg-sidebar shadow-md',
      )}
    >
      {children}
      {sortable && count > 1 && (
        <Button
          ref={setActivatorNodeRef}
          variant="ghost"
          size="icon-2xs"
          type="button"
          aria-label={`Drag ${name} to reorder`}
          className={cn(control, 'cursor-grab touch-none rounded p-1 active:cursor-grabbing')}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-3.5" aria-hidden />
        </Button>
      )}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-2xs"
            type="button"
            aria-label={`More actions for ${name}`}
            className={cn(control, 'rounded p-1', menuOpen && 'opacity-100')}
          >
            <MoreHorizontal className="size-3.5" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="right" className="w-48">
          <DropdownMenuItem disabled={index === 0} onSelect={() => onMove(index - 1)}>
            <ArrowUp />
            Move up
          </DropdownMenuItem>
          <DropdownMenuItem disabled={index >= count - 1} onSelect={() => onMove(index + 1)}>
            <ArrowDown />
            Move down
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onRemove}>
            <StarOff />
            Remove from favorites
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
