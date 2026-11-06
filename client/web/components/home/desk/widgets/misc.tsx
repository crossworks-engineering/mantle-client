'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BarChart3, Layers, ListTodo, NotebookPen } from 'lucide-react';
import { ApiError, apiSend } from '@mantle/web-ui/api-fetch';
import { Badge } from '@mantle/web-ui/ui/badge';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { Textarea } from '@mantle/web-ui/ui/textarea';
import { useToast } from '@mantle/web-ui/ui/toast';
import type { TreeKind } from '@mantle/web-ui/types/tree';
import { treeKey } from '@/components/item-tree/tree-api';
import {
  isPrivateWorkspace,
  sortWorkspaces,
  workspaceHref,
  workspaceLabel,
  type ShellWorkspace,
} from '@/lib/workspaces';
import { KIND_LABELS, type DeskWidgetId } from '@/lib/home-desk';
import { DeskWidget } from '../desk-widget';
import { KIND_ICONS } from './items';

// ── Quick note and Quick task ──────────────────────────────────────────────

/** An item's title and body from what was jotted: the first line titles it,
 *  `fallback` when that line is empty. */
export function splitJot(
  text: string,
  fallback = 'Quick note',
): { title: string; content: string } {
  const trimmed = text.trim();
  const [first, ...rest] = trimmed.split('\n');
  const title =
    (first ?? '')
      .trim()
      .replace(/^#+\s*/, '')
      .slice(0, 120) || fallback;
  return { title, content: rest.join('\n').trim() };
}

/** What a jot widget makes: its words, where it posts and what it refreshes. */
type JotKind = {
  title: string;
  icon: ReactNode;
  /** The first line's stand-in when it is empty. */
  fallback: string;
  /** The create route. apiFetch names the switcher's workspace on it
   *  (lib/create-workspace.ts), so the item lands there. */
  route: string;
  body: (jot: { title: string; content: string }) => Record<string, string>;
  /** The lists to refresh once it is made. */
  kind: 'notes' | 'tasks';
  add: string;
  added: string;
  failed: string;
};

const JOTS = {
  note: {
    title: 'Quick note',
    icon: <NotebookPen />,
    fallback: 'Quick note',
    route: '/api/notes',
    body: (j) => j,
    kind: 'notes',
    add: 'Add note',
    added: 'Note added',
    failed: 'Could not add the note',
  },
  task: {
    title: 'Quick task',
    icon: <ListTodo />,
    fallback: 'Quick task',
    route: '/api/tasks',
    body: (j) => ({ title: j.title, body: j.content }),
    kind: 'tasks',
    add: 'Add task',
    added: 'Task added',
    failed: 'Could not add the task',
  },
} satisfies Record<string, JotKind>;

/** The request a jot sends: its route and body, or null when nothing was
 *  jotted. */
export function jotRequest(
  jot: keyof typeof JOTS,
  text: string,
): { route: string; body: Record<string, string> } | null {
  if (!text.trim()) return null;
  const k: JotKind = JOTS[jot];
  return { route: k.route, body: k.body(splitJot(text, k.fallback)) };
}

/**
 * Jot it down without leaving the Desk: the first line is the title, the rest
 * the body. ⌘/Ctrl+Enter adds it; it lands in the switcher's workspace and
 * the open lists of its kind refresh.
 */
function JotWidget({
  id,
  jot,
  onRemove,
}: {
  id: DeskWidgetId;
  jot: keyof typeof JOTS;
  onRemove: () => void;
}) {
  const k: JotKind = JOTS[jot];
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);

  const submit = async () => {
    const req = jotRequest(jot, text);
    if (!req || pending) return;
    setPending(true);
    try {
      await apiSend(req.route, 'POST', req.body);
      setText('');
      toast.success(k.added);
      await Promise.all([
        qc.invalidateQueries({ queryKey: [k.kind] }),
        qc.invalidateQueries({ queryKey: treeKey(k.kind) }),
      ]);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      toast.error(err instanceof Error ? err.message : k.failed);
    } finally {
      setPending(false);
    }
  };

  return (
    <DeskWidget id={id} title={k.title} icon={k.icon} onRemove={onRemove}>
      <form
        className="flex h-full flex-col gap-2 px-3 pb-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="Jot it down… the first line becomes the title"
          aria-label={k.title}
          className="min-h-0 flex-1 resize-none bg-background/60 scrollbar-thin"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="hidden text-xs text-muted-foreground sm:inline">⌘ Enter to add</span>
          <SubmitButton size="sm" pending={pending} disabled={!text.trim()}>
            {k.add}
          </SubmitButton>
        </div>
      </form>
    </DeskWidget>
  );
}

/** A note from the Desk; it appears on the sticky notes at once. */
export function QuickNoteWidget({ id, onRemove }: { id: DeskWidgetId; onRemove: () => void }) {
  return <JotWidget id={id} jot="note" onRemove={onRemove} />;
}

/** A task from the Desk, the twin of Quick note. */
export function QuickTaskWidget({ id, onRemove }: { id: DeskWidgetId; onRemove: () => void }) {
  return <JotWidget id={id} jot="task" onRemove={onRemove} />;
}

// ── At a glance ────────────────────────────────────────────────────────────

/** How much of each kind this workspace holds, each a way into its screen. */
export function GlanceWidget({
  id,
  counts,
  kinds,
  onRemove,
}: {
  id: DeskWidgetId;
  counts: Record<string, number> | null;
  kinds: readonly TreeKind[];
  onRemove: () => void;
}) {
  const NODE: Partial<Record<TreeKind, string>> = {
    pages: 'page',
    notes: 'note',
    files: 'file',
    tables: 'table',
    draw: 'draw',
  };
  const shown = kinds.filter((k) => NODE[k] !== undefined);
  return (
    <DeskWidget id={id} title="At a glance" icon={<BarChart3 />} onRemove={onRemove}>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(4.75rem,1fr))] gap-2 px-3 pb-3">
        {shown.map((k) => {
          const Icon = KIND_ICONS[k];
          const n = counts?.[NODE[k]!];
          return (
            <li key={k}>
              <Link
                href={`/${k}`}
                className="flex flex-col gap-0.5 rounded-lg bg-foreground/[0.04] px-2.5 py-2 hover:bg-accent hover:text-accent-foreground"
              >
                <Icon className="size-4 text-muted-foreground" />
                <span className="text-xl font-semibold leading-tight tabular-nums">
                  {typeof n === 'number' ? n : '–'}
                </span>
                <span className="truncate text-xs text-muted-foreground">{KIND_LABELS[k]}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </DeskWidget>
  );
}

// ── Workspaces ─────────────────────────────────────────────────────────────

export function WorkspacesWidget({
  id,
  workspaces,
  onRemove,
}: {
  id: DeskWidgetId;
  workspaces: readonly ShellWorkspace[];
  onRemove: () => void;
}) {
  const sorted = sortWorkspaces(workspaces.map((w) => ({ ...w, archived: false })));
  return (
    <DeskWidget id={id} title="Workspaces" icon={<Layers />} onRemove={onRemove}>
      {sorted.length === 0 ? (
        <p className="px-3 text-sm text-muted-foreground">You are not in a workspace yet.</p>
      ) : (
        <ul className="px-1.5 pb-2">
          {sorted.map((w) => (
            <li key={w.id}>
              <Link
                href={workspaceHref(w.id)}
                className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
              >
                <span className="min-w-0 flex-1 truncate">{workspaceLabel(w)}</span>
                {w.moderator && !isPrivateWorkspace(w) ? (
                  <Badge variant="outline">Moderator</Badge>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </DeskWidget>
  );
}
