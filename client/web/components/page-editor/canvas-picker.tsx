'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { Loader2, Presentation } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@mantle/web-ui/ui/dialog';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { Input } from '@mantle/web-ui/ui/input';
import { apiFetch } from '@mantle/web-ui/api-fetch';
import { useAssetUrl } from '@mantle/web-ui/hooks/use-asset-url';
import { cn } from '@mantle/web-ui/lib/utils';

/**
 * The human entry point for embedding a Present canvas in a page (the
 * `/canvas` slash item). A page embeds a canvas as an image node with
 * `presentId` (markdown: `![Title](present:<id>)`); this dialog picks one.
 * Canvases are written by Presenter, so there is no "New" row: ask Presenter
 * in chat for a new one.
 *
 * Editor-only, as the drawing picker: the slash item dispatches a DOM event
 * on the editor and this component, mounted once by PageEditor, owns the
 * dialog.
 */
export const CANVAS_PICKER_EVENT = 'mantle:open-canvas-picker';

/** Ask the mounted CanvasPicker to open. Safe to call from a static slash item. */
export function openCanvasPicker(editor: Editor): void {
  editor.view.dom.dispatchEvent(new CustomEvent(CANVAS_PICKER_EVENT, { bubbles: true }));
}

type CanvasRow = { id: string; title: string; hasPoster: boolean; updatedAt: string };

export function CanvasPicker({ editor }: { editor: Editor }) {
  const toAsset = useAssetUrl();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<CanvasRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  // Newest fetch wins (a slow early query must not clobber a later one).
  const seqRef = useRef(0);

  useEffect(() => {
    const dom = editor.view.dom;
    const onOpen = () => {
      setQuery('');
      setSelected(0);
      setOpen(true);
    };
    dom.addEventListener(CANVAS_PICKER_EVENT, onOpen);
    return () => dom.removeEventListener(CANVAS_PICKER_EVENT, onOpen);
  }, [editor]);

  // The list route answers 50 a page, most recently edited first.
  useEffect(() => {
    if (!open) return;
    const seq = ++seqRef.current;
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(() => {
      const q = query.trim();
      apiFetch<{ presents?: CanvasRow[] }>(
        `/api/presents${q ? `?q=${encodeURIComponent(q)}` : ''}`,
        { signal: ctrl.signal },
      )
        .then((data) => {
          if (seq !== seqRef.current) return;
          setRows(data.presents ?? []);
          setLoading(false);
        })
        .catch(() => {
          if (seq !== seqRef.current) return;
          setRows([]);
          setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [open, query]);

  useEffect(() => setSelected(0), [rows]);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const embed = useCallback(
    (row: CanvasRow) => {
      setOpen(false);
      // The node markdownToDoc makes of `![Canvas](present:<id>)`. The alt is
      // page text every reader sees, so it is the word, never the canvas's
      // title: a reader who may not read the canvas learns nothing of it.
      editor
        .chain()
        .focus()
        .insertContent({ type: 'image', attrs: { src: null, alt: 'Canvas', presentId: row.id } })
        .run();
    },
    [editor],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (rows.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => (s + 1) % rows.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => (s - 1 + rows.length) % rows.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = rows[selected];
      if (row) embed(row);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md gap-3 p-4">
        <DialogHeader>
          <DialogTitle>Embed a canvas</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search canvases…"
        />
        <div ref={listRef} className="max-h-72 overflow-y-auto scrollbar-thin -mx-1 px-1">
          {rows.map((row, i) => (
            <RowButton
              key={row.id}
              data-index={i}
              onMouseEnter={() => setSelected(i)}
              onClick={() => embed(row)}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
                selected === i ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
              )}
            >
              <span
                className={cn(
                  'flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border',
                  selected === i
                    ? 'border-accent-foreground/25 bg-accent-foreground/10'
                    : 'border-border bg-background',
                )}
              >
                {row.hasPoster ? (
                  // The canvas's snapshot; assetUrl carries the `?at=` token a
                  // detached client's <img> needs.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={toAsset(`/api/presents/${encodeURIComponent(row.id)}/poster`)}
                    alt=""
                    className="size-full object-cover"
                  />
                ) : (
                  <Presentation className="size-4" aria-hidden />
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium leading-tight">
                  {row.title}
                </span>
                <span
                  className={cn(
                    'block truncate text-xs',
                    selected === i ? 'text-accent-foreground' : 'text-muted-foreground',
                  )}
                >
                  Edited {new Date(row.updatedAt).toLocaleDateString()}
                </span>
              </span>
            </RowButton>
          ))}
          {rows.length === 0 && (
            <div className="flex items-center gap-2 px-2.5 py-3 text-sm text-muted-foreground">
              {loading && <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />}
              {loading
                ? 'Searching…'
                : query.trim()
                  ? 'No matching canvases'
                  : 'No canvases yet. Ask Presenter in chat to make one.'}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
