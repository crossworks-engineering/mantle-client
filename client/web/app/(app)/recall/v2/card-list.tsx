'use client';

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
import { useEffect, useMemo, useRef, useState } from 'react';
import { RECALL_MAX_MAP_NODES } from '@mantle/content-core/recall-compile';
import {
  ArrowDown,
  ArrowUp,
  CircleAlert,
  FileText,
  Flag,
  GripVertical,
  Plus,
  Search,
  Sparkles,
} from 'lucide-react';
import type { RecallNodeDTO } from '@mantle/web-ui/types/recall-v2';
import { Button } from '@mantle/web-ui/ui/button';
import { Input } from '@mantle/web-ui/ui/input';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { cn } from '@mantle/web-ui/lib/utils';
import {
  CARD_KIND_LABEL,
  RECALL_ENTRY_SLUG,
  cardAttention,
  cardKindOf,
  dropCard,
  moveCard,
  unreachableSlugs,
  type CardKind,
} from '@/lib/recall-v2';

/** A filter box shows once the list is longer than a glance. */
const FILTER_FROM = 8;

/** The glyph in front of each title: what kind of card it is. */
export function CardKindIcon({ kind, className }: { kind: CardKind; className?: string }) {
  const Icon = kind === 'entry' ? Flag : kind === 'knowledge' ? FileText : Sparkles;
  return (
    <Icon
      aria-label={CARD_KIND_LABEL[kind]}
      className={cn(
        'size-3.5 shrink-0',
        kind === 'entry' && 'text-primary-ink',
        kind === 'prompt' && 'text-info-ink',
        kind === 'requested' && 'text-warning-ink',
        kind === 'knowledge' && 'text-muted-foreground',
        className,
      )}
    />
  );
}

/**
 * The card column, in order, entry first. Drag a card by its grip, or use
 * the up and down buttons (they are also the keyboard path). The entry card
 * never moves and nothing can be dropped above it. Every move sends the
 * FULL order: the brain leaves unlisted cards at their old rank.
 *
 * A row is the title alone, wrapped, after a glyph for its kind; the slug is
 * in the inspector. A card that wants attention (no walk reaches it, a prompt
 * request) carries a mark, and the header counts them: pressing the count
 * shows only those. While either filter is on the order cannot change.
 */
export function CardList({
  nodes,
  openSlug,
  onOpen,
  onReorder,
  onAdd,
  busy,
  full,
}: {
  nodes: RecallNodeDTO[];
  openSlug: string | null;
  onOpen: (slug: string) => void;
  onReorder: (slugs: string[]) => void;
  onAdd: () => void;
  busy: boolean;
  full: boolean;
}) {
  const [filter, setFilter] = useState('');
  const [onlyAttention, setOnlyAttention] = useState(false);
  const attention = useMemo(() => {
    const away = unreachableSlugs(nodes);
    return new Map(nodes.map((n) => [n.slug, cardAttention(n, away)]));
  }, [nodes]);
  const needing = nodes.filter((n) => attention.get(n.slug)).length;
  // The toggle lets go by itself once nothing needs attention any more.
  const attentionOn = onlyAttention && needing > 0;
  const needle = filter.trim().toLowerCase();
  const shown = nodes.filter(
    (n) =>
      (!attentionOn || attention.get(n.slug)) &&
      (!needle || n.title.toLowerCase().includes(needle) || n.slug.toLowerCase().includes(needle)),
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(e: DragEndEvent) {
    if (!e.over) return;
    const slugs = dropCard(nodes, String(e.active.id), String(e.over.id));
    if (slugs) onReorder(slugs);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="text-xs font-semibold tracking-wider whitespace-nowrap text-muted-foreground uppercase">
          {nodes.length} {nodes.length === 1 ? 'card' : 'cards'}
        </span>
        <Button
          size="2xs"
          variant="outline"
          onClick={onAdd}
          disabled={full}
          title={full ? `A map holds at most ${RECALL_MAX_MAP_NODES} cards.` : undefined}
        >
          <Plus /> Card
        </Button>
      </div>
      {needing > 0 && (
        <div className="px-2 pb-1">
          <Button
            size="2xs"
            variant="ghost"
            aria-pressed={attentionOn}
            onClick={() => setOnlyAttention(!attentionOn)}
            title={attentionOn ? 'Show every card' : 'Show only the cards that need attention'}
            className={cn(
              'gap-1 text-warning-ink',
              attentionOn && 'bg-warning/15 hover:bg-warning/20',
            )}
          >
            <CircleAlert />
            {needing} need{needing === 1 ? 's' : ''} attention
          </Button>
        </div>
      )}
      {nodes.length > FILTER_FROM && (
        <div className="relative px-2 pb-2">
          <Search
            className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter cards"
            aria-label="Filter cards"
            className="h-8 pl-7 text-sm"
          />
        </div>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={nodes.map((n) => n.slug)} strategy={verticalListSortingStrategy}>
          <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2 scrollbar-thin">
            {shown.map((n, i) => (
              <CardRow
                key={n.id}
                index={i}
                node={n}
                attention={attention.get(n.slug) ?? null}
                locked={needle !== '' || attentionOn}
                open={n.slug === openSlug}
                onOpen={onOpen}
                onMove={(dir) => {
                  const slugs = moveCard(nodes, n.slug, dir);
                  if (slugs) onReorder(slugs);
                }}
                canUp={moveCard(nodes, n.slug, -1) !== null}
                canDown={moveCard(nodes, n.slug, 1) !== null}
                busy={busy}
              />
            ))}
            {shown.length === 0 && (
              <li className="px-2 py-3 text-xs text-muted-foreground">No card matches.</li>
            )}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function CardRow({
  index,
  node,
  attention,
  locked,
  open,
  onOpen,
  onMove,
  canUp,
  canDown,
  busy,
}: {
  index: number;
  node: RecallNodeDTO;
  /** Why the card wants the owner's eye, or null. */
  attention: string | null;
  /** A filter is typed: the shown order is not the map's, so no moves. */
  locked: boolean;
  open: boolean;
  onOpen: (slug: string) => void;
  onMove: (dir: -1 | 1) => void;
  canUp: boolean;
  canDown: boolean;
  busy: boolean;
}) {
  const entry = node.slug === RECALL_ENTRY_SLUG;
  const fixed = entry || locked;
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: node.slug, disabled: fixed || busy });

  // Keep the keyboard where it was across a move. The row is re-ordered in
  // the DOM, and a button that just became disabled (the card reached the
  // top, or the bottom) drops focus to the page; the other one takes it.
  const upRef = useRef<HTMLButtonElement>(null);
  const downRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef<-1 | 1 | null>(null);
  useEffect(() => {
    const dir = refocus.current;
    if (dir === null) return;
    refocus.current = null;
    const want = dir === -1 ? (canUp ? upRef : downRef) : canDown ? downRef : upRef;
    want.current?.focus();
  }, [index, canUp, canDown]);

  function move(dir: -1 | 1) {
    // Not `disabled` while a write runs: that would drop focus on every move.
    if (busy) return;
    refocus.current = dir;
    onMove(dir);
  }

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('group relative flex items-start gap-1', isDragging && 'z-10 opacity-80')}
    >
      {fixed ? (
        <span className="size-6 shrink-0" aria-hidden />
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon-2xs"
          ref={setActivatorNodeRef}
          {...listeners}
          {...attributes}
          aria-label={`Drag to reorder ${node.title}`}
          className="mt-1 shrink-0 cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
        >
          <GripVertical />
        </Button>
      )}
      <RowButton
        onClick={() => onOpen(node.slug)}
        aria-current={open ? 'true' : undefined}
        // The item tree's row treatment (style guide §2a): the selected row
        // takes the accent, a hover a faint wash, never a solid fill.
        className={cn(
          'flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm',
          open || isDragging
            ? 'bg-accent font-medium text-accent-foreground'
            : 'text-foreground/90 hover:bg-foreground/[0.06]',
        )}
      >
        <CardKindIcon kind={cardKindOf(node)} className="mt-[0.2rem]" />
        <span className="min-w-0 flex-1 break-words">{node.title}</span>
        {attention && (
          <span title={attention} className="mt-[0.2rem] shrink-0">
            <CircleAlert className="size-3.5 text-warning-ink" aria-hidden />
            <span className="sr-only">{attention}</span>
          </span>
        )}
      </RowButton>
      {!fixed && (
        // Shown on hover or focus where there is a pointer that hovers; always
        // shown on touch, which has no hover to reveal them.
        <div className="flex shrink-0 flex-col opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:hover)]:opacity-0">
          <Button
            ref={upRef}
            variant="ghost"
            size="icon-2xs"
            aria-label={`Move ${node.title} up`}
            aria-disabled={busy || undefined}
            disabled={!canUp}
            onClick={() => move(-1)}
          >
            <ArrowUp />
          </Button>
          <Button
            ref={downRef}
            variant="ghost"
            size="icon-2xs"
            aria-label={`Move ${node.title} down`}
            aria-disabled={busy || undefined}
            disabled={!canDown}
            onClick={() => move(1)}
          >
            <ArrowDown />
          </Button>
        </div>
      )}
    </li>
  );
}
