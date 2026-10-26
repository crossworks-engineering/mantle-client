'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, type ComponentType, type MouseEvent } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AppWindow,
  ArrowUpRight,
  Brain,
  CalendarDays,
  Contact,
  File,
  FileText,
  KeyRound,
  ListChecks,
  PenTool,
  Pin,
  PinOff,
  Presentation,
  Sigma,
  StickyNote,
  Table2,
} from 'lucide-react';
import { apiFetch, apiSend } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { Checkbox } from '@mantle/web-ui/ui/checkbox';
import { Skeleton } from '@mantle/web-ui/ui/skeleton';
import { useToast } from '@mantle/web-ui/ui/toast';
import { cn } from '@mantle/web-ui/lib/utils';
import type { AppTint } from '@mantle/client-types/app-nav';
import type { TreeItem, TreeKind } from '@mantle/web-ui/types/tree';
import { AppTile, TINT_CLASSES } from '@/components/app-nav/app-tile';
import { setTreeItemPinned, treeKey } from '@/components/item-tree/tree-api';
import { itemRestore } from '@/lib/last-opened';
import { noteListAnswer } from '@/lib/workspace-filter';
import { KIND_LABELS, deskItemHref, type DeskWidgetId } from '@/lib/home-desk';
import { useDeskGrid } from '../desk-grid';
import { DeskWidget } from '../desk-widget';
import { useKindItems, type DeskListItem, type DeskPin } from '../desk-data';

type Icon = ComponentType<{ className?: string }>;

export const KIND_ICONS: Record<TreeKind, Icon> = {
  files: File,
  notes: StickyNote,
  pages: FileText,
  draw: PenTool,
  tables: Table2,
  formulas: Sigma,
  apps: AppWindow,
  tasks: ListChecks,
  events: CalendarDays,
  contacts: Contact,
  secrets: KeyRound,
  recall: Brain,
  present: Presentation,
} as Record<TreeKind, Icon>;

/** A desk icon's tile colour when its item has none: one per kind, so the
 *  icons read at a glance (pages blue, tasks green, apps violet...). */
const KIND_TINT: Record<TreeKind, AppTint> = {
  files: 'slate',
  notes: 'amber',
  pages: 'blue',
  draw: 'pink',
  tables: 'teal',
  formulas: 'indigo',
  apps: 'violet',
  tasks: 'green',
  events: 'orange',
  contacts: 'cyan',
  secrets: 'slate',
  recall: 'sky',
  present: 'red',
} as Record<TreeKind, AppTint>;

/** Open an item: its route, or for a file, its folder with it selected. */
function useOpenItem() {
  const router = useRouter();
  const toast = useToast();
  return (kind: TreeKind, id: string) => async (e: MouseEvent) => {
    if (deskItemHref(kind, id) !== null) return; // the Link does it
    e.preventDefault();
    const out = await itemRestore('files', id, (url) => apiFetch(url));
    if (typeof out === 'object') router.push(out.href);
    else toast.error('That file could not be opened.');
  };
}

function itemLink(kind: TreeKind, id: string): string {
  return deskItemHref(kind, id) ?? `/${kind}`;
}

function usePinToggle(kind: TreeKind) {
  const qc = useQueryClient();
  const toast = useToast();
  return async (item: DeskListItem) => {
    try {
      await setTreeItemPinned(item.id, !item.pinned);
      await qc.invalidateQueries({ queryKey: treeKey(kind) });
    } catch {
      toast.error(item.pinned ? 'Could not unpin it' : 'Could not pin it');
    }
  };
}

function relTime(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function OpenScreen({ kind }: { kind: TreeKind }) {
  return (
    <Button variant="ghost" size="icon" className="size-6" asChild>
      <Link
        href={`/${kind}`}
        aria-label={`Open ${KIND_LABELS[kind]}`}
        title={`Open ${KIND_LABELS[kind]}`}
      >
        <ArrowUpRight />
      </Link>
    </Button>
  );
}

function ListSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-2 px-3 py-1">
      {Array.from({ length: Math.min(rows, 5) }, (_, i) => (
        <Skeleton key={i} className="h-6 w-full" />
      ))}
    </div>
  );
}

/** A kind's pinned and latest items, one row each. */
export function KindWidget({
  id,
  kind,
  count,
  ws,
  hubNewest,
  onRemove,
}: {
  id: DeskWidgetId;
  kind: TreeKind;
  count: number;
  ws: string | null;
  hubNewest?: readonly TreeItem[];
  onRemove: () => void;
}) {
  const { items, isPending } = useKindItems(kind, count, ws, hubNewest);
  const open = useOpenItem();
  const togglePin = usePinToggle(kind);
  const KindIcon = KIND_ICONS[kind];
  return (
    <DeskWidget
      id={id}
      title={KIND_LABELS[kind]}
      icon={<KindIcon />}
      actions={<OpenScreen kind={kind} />}
      onRemove={onRemove}
    >
      {isPending ? (
        <ListSkeleton rows={count} />
      ) : items.length === 0 ? (
        <EmptyKind kind={kind} />
      ) : (
        <ul className="px-1.5 pb-2">
          {items.map((item) => (
            <li key={item.id} className="group/row flex items-center gap-1">
              <Link
                href={itemLink(kind, item.id)}
                onClick={open(kind, item.id)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
              >
                <AppTile icon={item.icon} color={item.color} size="sm" kind="app" />
                <span className="min-w-0 flex-1 truncate">{item.title || 'Untitled'}</span>
                {item.pinned ? (
                  <Pin className="size-3 shrink-0 text-muted-foreground" aria-label="Pinned" />
                ) : (
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {relTime(item.updatedAt)}
                  </span>
                )}
              </Link>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 shrink-0 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
                aria-label={item.pinned ? `Unpin ${item.title}` : `Pin ${item.title} to the desk`}
                title={item.pinned ? 'Unpin' : 'Pin to the desk'}
                onClick={() => void togglePin(item)}
              >
                {item.pinned ? <PinOff /> : <Pin />}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </DeskWidget>
  );
}

function EmptyKind({ kind }: { kind: TreeKind }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-4 pb-4 text-center">
      <p className="text-sm text-muted-foreground">Nothing here yet.</p>
      <Link
        href={`/${kind}`}
        className="text-sm text-primary-ink underline-offset-4 hover:underline"
      >
        Go to {KIND_LABELS[kind]}
      </Link>
    </div>
  );
}

// ── Tasks ──────────────────────────────────────────────────────────────────

/** Tasks with a box to tick: done is one click from the desk. */
export function TasksWidget({
  id,
  count,
  ws,
  onRemove,
}: {
  id: DeskWidgetId;
  count: number;
  ws: string | null;
  onRemove: () => void;
}) {
  const { items, isPending } = useKindItems('tasks', count, ws);
  const qc = useQueryClient();
  const toast = useToast();
  const toggle = async (item: TreeItem) => {
    const done = !item.meta?.done;
    try {
      await apiSend(`/api/tasks/${item.id}`, 'PATCH', done ? { status: 'done' } : { reopen: true });
      if (done) toast.success(`Done: ${item.title}`);
      await Promise.all([
        qc.invalidateQueries({ queryKey: treeKey('tasks') }),
        qc.invalidateQueries({ queryKey: ['tasks'] }),
      ]);
    } catch {
      toast.error('Could not update the task');
    }
  };
  return (
    <DeskWidget
      id={id}
      title="Tasks"
      icon={<ListChecks />}
      actions={<OpenScreen kind="tasks" />}
      onRemove={onRemove}
    >
      {isPending ? (
        <ListSkeleton rows={count} />
      ) : items.length === 0 ? (
        <EmptyKind kind="tasks" />
      ) : (
        <ul className="px-2 pb-2">
          {items.map((item) => {
            const done = !!item.meta?.done;
            const due = item.meta?.due ? new Date(item.meta.due) : null;
            const late = due !== null && !done && due.getTime() < Date.now();
            return (
              <li
                key={item.id}
                className="flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-foreground/[0.04]"
              >
                <Checkbox
                  checked={done}
                  onCheckedChange={() => void toggle(item)}
                  aria-label={done ? `Reopen ${item.title}` : `Mark ${item.title} done`}
                />
                <Link
                  href={itemLink('tasks', item.id)}
                  className={cn(
                    'min-w-0 flex-1 truncate text-sm hover:underline',
                    done && 'text-muted-foreground line-through',
                  )}
                >
                  {item.title || 'Untitled'}
                </Link>
                {item.pinned ? (
                  <Pin className="size-3 text-muted-foreground" aria-label="Pinned" />
                ) : null}
                {due ? (
                  <span
                    className={cn(
                      'shrink-0 text-xs tabular-nums',
                      late ? 'text-destructive-ink' : 'text-muted-foreground',
                    )}
                  >
                    {due.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </DeskWidget>
  );
}

// ── Sticky notes ───────────────────────────────────────────────────────────

type NoteRow = { id: string; title: string; content: string; updatedAt: string };

/** A widget's title bar (DeskWidget's h-9). */
const HEADER_PX = 36;

const STICKY_TINTS: readonly AppTint[] = ['amber', 'pink', 'sky', 'lime', 'violet', 'orange'];

/** A stable small number from an id, for each note's tilt and colour. */
function hash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Markdown down to the words, for a sticky's few lines. */
function plain(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[#>\-*+\s]+|[*_`~]/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The last notes as sticky notes stuck to the desk: pinned ones first, then
 * the newest. Each keeps its own colour (the note's, or one picked from its
 * id) and its own slight tilt, and straightens up under the pointer.
 */
export function StickyNotesWidget({
  id,
  count,
  ws,
  onRemove,
}: {
  id: DeskWidgetId;
  count: number;
  ws: string | null;
  onRemove: () => void;
}) {
  const pinned = useKindItems('notes', count, ws, undefined, false);
  const latest = useQuery({
    queryKey: ['notes', 'desk', ws ?? 'all'],
    queryFn: () => {
      const qs = new URLSearchParams(ws ? { ws } : { state: 'all' });
      return apiFetch<{ notes: NoteRow[] }>(`/api/notes?${qs.toString()}`).then((r) =>
        noteListAnswer(r, ws),
      );
    },
  });
  const pins = pinned.items.filter((i) => i.pinned);
  const byId = useMemo(
    () => new Map((latest.data?.notes ?? []).map((n) => [n.id, n])),
    [latest.data],
  );
  // A pinned note older than the newest page: fetched on its own.
  const missing = pins.filter((p) => !byId.has(p.id));
  const extra = useQueries({
    queries: missing.map((p) => ({
      queryKey: ['notes', 'desk-note', p.id],
      queryFn: () => apiFetch<{ note: NoteRow }>(`/api/notes/${p.id}`).then((r) => r.note),
      enabled: latest.isSuccess,
    })),
  });
  const notes = useMemo(() => {
    const out: Array<NoteRow & { pinned: boolean; color: AppTint | null }> = [];
    const seen = new Set<string>();
    for (const p of pins) {
      const row = byId.get(p.id) ?? extra.find((q) => q.data?.id === p.id)?.data;
      seen.add(p.id);
      out.push({
        id: p.id,
        title: p.title,
        content: row?.content ?? '',
        updatedAt: p.updatedAt,
        pinned: true,
        color: p.color,
      });
    }
    for (const n of latest.data?.notes ?? []) {
      if (out.length >= count) break;
      if (seen.has(n.id)) continue;
      out.push({ ...n, pinned: false, color: null });
    }
    return out.slice(0, count);
  }, [pins, byId, extra, latest.data, count]);

  // The notes take the room they need: the widget grows or shrinks to fit
  // them all (no scrolling inside), pushing what is below it down.
  const { fitHeight, rowH } = useDeskGrid();
  const board = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = board.current;
    if (!el) return;
    const fit = () => fitHeight(id, el.offsetHeight + HEADER_PX);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
    // rowH: a taller or shorter screen changes the rows, not the notes.
  }, [fitHeight, id, rowH]);

  return (
    <DeskWidget
      id={id}
      title="Notes"
      icon={<StickyNote />}
      actions={<OpenScreen kind="notes" />}
      onRemove={onRemove}
      bare
      bodyClassName="overflow-hidden"
    >
      <div ref={board}>
        {latest.isPending ? (
          <div className="flex gap-3 p-3">
            {Array.from({ length: Math.min(count, 4) }, (_, i) => (
              <Skeleton key={i} className="aspect-square w-36 rounded-sm" />
            ))}
          </div>
        ) : notes.length === 0 ? (
          <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
            No notes yet. Jot one in Quick note.
          </div>
        ) : (
          <ul className="grid auto-rows-fr grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-4 p-3 pt-2">
            {notes.map((n, i) => {
              const h = hash(n.id);
              const tint = n.color ?? STICKY_TINTS[h % STICKY_TINTS.length] ?? 'amber';
              const tilt = ((h >> 3) % 5) - 2; // -2..2 degrees
              const text = plain(n.content);
              return (
                <li key={n.id} className="min-h-0">
                  <Link
                    href={`/notes/${encodeURIComponent(n.id)}`}
                    style={{ transform: `rotate(${tilt * 0.9}deg)`, animationDelay: `${i * 60}ms` }}
                    className={cn(
                      'relative flex h-full min-h-28 flex-col gap-1 rounded-sm p-3 pt-4 shadow-md',
                      'transition-transform duration-200 ease-out hover:z-10 hover:!rotate-0 hover:scale-[1.04] hover:shadow-xl',
                      'animate-in fade-in zoom-in-95 fill-mode-both',
                      TINT_CLASSES[tint],
                    )}
                  >
                    {/* A strip of tape across the top. */}
                    <span
                      aria-hidden
                      className="absolute -top-2 left-1/2 h-4 w-12 -translate-x-1/2 rotate-[-3deg] rounded-[2px] bg-background/55 shadow-sm"
                    />
                    {n.pinned ? (
                      <Pin
                        className="absolute right-2 top-2 size-3 opacity-70"
                        aria-label="Pinned"
                      />
                    ) : null}
                    <span className="line-clamp-2 pr-3 text-sm font-semibold leading-snug">
                      {n.title || 'Untitled'}
                    </span>
                    {text ? (
                      <span className="line-clamp-5 text-xs leading-relaxed opacity-85">
                        {text}
                      </span>
                    ) : null}
                    <span className="mt-auto pt-1 text-[10px] uppercase tracking-wide opacity-60">
                      {relTime(n.updatedAt)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </DeskWidget>
  );
}

// ── Desk icons ─────────────────────────────────────────────────────────────

/**
 * A pinned item as an icon on the desk, the way a shortcut sits on a
 * computer's desktop: a tile and its name. Opens on click; carried by
 * dragging it anywhere (the grid tells a press from a drag).
 */
export function DeskIcon({ id, pin }: { id: DeskWidgetId; pin: DeskPin }) {
  const { kind, item } = pin;
  const open = useOpenItem();
  const { nudge, narrow } = useDeskGrid();
  const KindIcon = KIND_ICONS[kind];
  const lucideOrEmoji = item.icon;
  return (
    <Link
      href={itemLink(kind, item.id)}
      onClick={open(kind, item.id)}
      data-desk-handle
      draggable={false}
      // Alt and an arrow moves the icon from the keyboard (Enter opens it).
      onKeyDown={(e) => {
        if (e.altKey && !narrow) nudge(id, e);
      }}
      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight"
      title={`${item.title} (${KIND_LABELS[kind]})`}
      className={cn(
        'group/icon flex h-full w-full cursor-pointer select-none flex-col items-center justify-center gap-1.5 rounded-xl p-1 text-center outline-none hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing',
        // On a desk a drag carries the icon; on a phone a swipe scrolls.
        !narrow && 'touch-none',
      )}
    >
      <span className="relative transition-transform duration-150 group-hover/icon:-translate-y-0.5 group-active/icon:scale-95">
        {lucideOrEmoji ? (
          <AppTile
            icon={item.icon}
            color={item.color ?? KIND_TINT[kind]}
            size="lg"
            className="size-11 shadow-md"
          />
        ) : (
          <span
            className={cn(
              'flex size-11 items-center justify-center rounded-xl shadow-md',
              TINT_CLASSES[item.color ?? KIND_TINT[kind]],
            )}
          >
            <KindIcon className="size-5" />
          </span>
        )}
      </span>
      <span className="line-clamp-2 max-w-full rounded px-1 text-[11px] font-medium leading-tight text-foreground [text-shadow:0_1px_2px_var(--background)]">
        {item.title || 'Untitled'}
      </span>
    </Link>
  );
}
