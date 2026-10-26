'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BarChart3, Layers, NotebookPen } from 'lucide-react';
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

// ── Quick note ─────────────────────────────────────────────────────────────

/** A note's title and body from what was jotted: the first line titles it. */
export function splitJot(text: string): { title: string; content: string } {
  const trimmed = text.trim();
  const [first, ...rest] = trimmed.split('\n');
  const title =
    (first ?? '')
      .trim()
      .replace(/^#+\s*/, '')
      .slice(0, 120) || 'Quick note';
  return { title, content: rest.join('\n').trim() };
}

/**
 * Jot it down without leaving Home: the first line is the title, the rest
 * the note. ⌘/Ctrl+Enter adds it; it lands in the switcher's workspace and
 * appears on the sticky notes at once.
 */
export function QuickNoteWidget({
  id,
  ws,
  onRemove,
}: {
  id: DeskWidgetId;
  ws: string | null;
  onRemove: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);

  const submit = async () => {
    if (!text.trim() || pending) return;
    setPending(true);
    try {
      const url = ws ? `/api/notes?ws=${encodeURIComponent(ws)}` : '/api/notes';
      await apiSend(url, 'POST', splitJot(text));
      setText('');
      toast.success('Note added');
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['notes'] }),
        qc.invalidateQueries({ queryKey: treeKey('notes') }),
      ]);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      toast.error(err instanceof Error ? err.message : 'Could not add the note');
    } finally {
      setPending(false);
    }
  };

  return (
    <DeskWidget id={id} title="Quick note" icon={<NotebookPen />} onRemove={onRemove}>
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
          aria-label="Quick note"
          className="min-h-0 flex-1 resize-none bg-background/60 scrollbar-thin"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="hidden text-xs text-muted-foreground sm:inline">⌘ Enter to add</span>
          <SubmitButton size="sm" pending={pending} disabled={!text.trim()}>
            Add note
          </SubmitButton>
        </div>
      </form>
    </DeskWidget>
  );
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
