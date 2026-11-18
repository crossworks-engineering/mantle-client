'use client';

/**
 * The Files screen's one drop zone: the hook that follows a drag of files
 * over the whole screen, and the overlay that says where they will go. The
 * rules (what counts as a file drag, the enter/leave count, which folder a
 * drop lands in) are lib/file-drop.ts.
 */
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { ChevronRight, Upload } from 'lucide-react';
import { dragDepth, dropPathAt, isFileDrag } from '@/lib/file-drop';

export type FileDropBind = {
  onDragEnter: (e: DragEvent<HTMLElement>) => void;
  onDragOver: (e: DragEvent<HTMLElement>) => void;
  onDragLeave: (e: DragEvent<HTMLElement>) => void;
  onDrop: (e: DragEvent<HTMLElement>) => void;
};

/**
 * `over`: the folder path a drop would land in while files are dragged over
 * the bound element, else null. `fallback` is the folder the screen is in;
 * an element with `data-drop-path` under the pointer names its own.
 */
export function useFileDrop({
  fallback,
  onDrop,
}: {
  fallback: string;
  onDrop: (data: DataTransfer, path: string) => void;
}): { over: string | null; bind: FileDropBind } {
  const depth = useRef(0);
  const [over, setOver] = useState<string | null>(null);
  const reset = useCallback(() => {
    depth.current = dragDepth(depth.current, 'end');
    setOver(null);
  }, []);

  // A drag cancelled with Escape, or dropped outside the screen, may leave
  // no `dragleave` behind on every browser: the window's end clears it.
  useEffect(() => {
    if (over === null) return;
    window.addEventListener('dragend', reset);
    window.addEventListener('drop', reset);
    return () => {
      window.removeEventListener('dragend', reset);
      window.removeEventListener('drop', reset);
    };
  }, [over, reset]);

  const at = (e: DragEvent<HTMLElement>) => dropPathAt(e.target, fallback);
  const bind: FileDropBind = {
    onDragEnter: (e) => {
      if (!isFileDrag(e.dataTransfer?.types)) return;
      depth.current = dragDepth(depth.current, 'enter');
      setOver(at(e));
    },
    onDragOver: (e) => {
      if (!isFileDrag(e.dataTransfer?.types)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      const path = at(e);
      setOver((prev) => (prev === path ? prev : path));
    },
    onDragLeave: (e) => {
      if (!isFileDrag(e.dataTransfer?.types)) return;
      depth.current = dragDepth(depth.current, 'leave');
      if (depth.current === 0) setOver(null);
    },
    onDrop: (e) => {
      if (!isFileDrag(e.dataTransfer?.types)) return;
      e.preventDefault();
      const path = at(e);
      reset();
      onDrop(e.dataTransfer, path);
    },
  };
  return { over, bind };
}

/** The drop zone over the content pane while files are dragged: an upload
 *  mark, the destination as a breadcrumb, and who else reads that folder. */
export function FileDropOverlay({
  crumbs,
  visibleTo,
}: {
  crumbs: readonly string[];
  visibleTo?: readonly string[] | null;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute inset-2 z-30 flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-primary/60 bg-background/90 p-6 text-center backdrop-blur-sm"
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary-ink">
        <Upload className="size-6" aria-hidden />
      </span>
      <span className="text-sm font-medium text-foreground">Drop to upload</span>
      <span className="flex max-w-full flex-wrap items-center justify-center gap-1 text-sm text-muted-foreground">
        <span>Uploading to:</span>
        {crumbs.map((c, i) => (
          <span key={`${i}:${c}`} className="flex min-w-0 items-center gap-1">
            {i > 0 && <ChevronRight className="size-3.5 shrink-0" aria-hidden />}
            <span
              className={
                i === crumbs.length - 1
                  ? 'truncate font-medium text-primary-ink'
                  : 'truncate text-foreground'
              }
            >
              {c}
            </span>
          </span>
        ))}
      </span>
      {visibleTo && visibleTo.length > 0 ? (
        <span className="text-xs text-muted-foreground">Also visible to: {visibleTo.join(', ')}</span>
      ) : null}
    </div>
  );
}
