'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Crop, Loader2 } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@mantle/web-ui/ui/dialog';
import { Textarea } from '@mantle/web-ui/ui/textarea';
import { useToast } from '@mantle/web-ui/ui/toast';
import { createWorkspace } from '@/lib/create-workspace';
import {
  captureDesktop,
  captureErrorMessage,
  desktopCanCapture,
  dragRect,
  grabFrame,
  saveScreenshot,
  screenshotMeta,
  shareThisTab,
  stopStream,
  usableRect,
  webCanCapture,
  type Point,
  type Rect,
} from '@/lib/area-capture';
import { useDockActions, useDockSession } from './assistant-dock';

type Shot = { png: Blob; url: string; rect: Rect; view: { w: number; h: number } };

type Phase =
  | { at: 'idle' }
  | { at: 'selecting' }
  | { at: 'grabbing'; rect: Rect }
  | { at: 'preview'; shot: Shot };

/** Two animation frames: the overlay is gone from the screen before the
 *  pixels are read, so it is never in the picture. */
const afterPaint = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

/**
 * The rail's "Capture an area for the assistant" button, and everything it
 * opens: the dimmed drag-to-select layer, the capture (lib/area-capture.ts)
 * and the preview where the user adds a note and picks Attach to chat or
 * Save only. Nothing is saved or sent until one of those two is pressed.
 */
export function CaptureButton({ canAttach }: { canAttach: boolean }) {
  const toast = useToast();
  const { attachContext, openAssistant } = useDockActions();
  const { pinnedContext } = useDockSession();
  const [phase, setPhase] = useState<Phase>({ at: 'idle' });
  const stream = useRef<MediaStream | null>(null);
  const pinned = useRef(pinnedContext);
  pinned.current = pinnedContext;

  // Read after mount: the server render has no window, and the first client
  // render must match it.
  const [supported, setSupported] = useState(false);
  useEffect(() => setSupported(desktopCanCapture() || webCanCapture()), []);

  const end = useCallback(() => {
    stopStream(stream.current);
    stream.current = null;
    setPhase((p) => {
      if (p.at === 'preview') URL.revokeObjectURL(p.shot.url);
      return { at: 'idle' };
    });
  }, []);

  // A share left open (the tab closed mid-select, an unmount) stops with it.
  useEffect(() => () => stopStream(stream.current), []);

  const start = useCallback(async () => {
    if (phase.at !== 'idle') return;
    if (!desktopCanCapture()) {
      // The browser asks first, inside this click (a user gesture), so the
      // share bar has settled before the user drags.
      try {
        stream.current = await shareThisTab();
        // Ending the share from the browser's own bar cancels the capture.
        stream.current.getVideoTracks()[0]?.addEventListener('ended', end, { once: true });
      } catch (err) {
        toast.error(captureErrorMessage(err));
        return;
      }
    }
    setPhase({ at: 'selecting' });
  }, [phase.at, end, toast]);

  const grab = useCallback(
    async (rect: Rect) => {
      setPhase({ at: 'grabbing', rect });
      await afterPaint();
      const view = { w: window.innerWidth, h: window.innerHeight };
      try {
        const png = stream.current
          ? await grabFrame(stream.current, rect, view)
          : await captureDesktop(rect);
        stopStream(stream.current);
        stream.current = null;
        setPhase({ at: 'preview', shot: { png, url: URL.createObjectURL(png), rect, view } });
      } catch (err) {
        toast.error(captureErrorMessage(err));
        end();
      }
    },
    [end, toast],
  );

  const save = useCallback(
    async (shot: Shot, note: string, attach: boolean) => {
      const item = pinned.current[0] ?? null;
      const meta = screenshotMeta({
        pathname: window.location.pathname,
        title: document.title,
        item: item ? { id: item.id, label: item.label } : null,
        workspaceId: createWorkspace(),
        rect: shot.rect,
        view: shot.view,
        dpr: window.devicePixelRatio,
        desktop: desktopCanCapture(),
        note,
      });
      const saved = await saveScreenshot(shot.png, meta);
      if (attach) {
        attachContext({ id: saved.file.id, kind: 'file', label: saved.file.filename });
        openAssistant();
      }
      // Private to this login wherever it landed (Admin's Auto-filed too).
      toast.success(
        `Screenshot saved${saved.landedIn ? ` in ${saved.landedIn.name}` : ''}${attach ? ' and attached to the chat' : ''}. Only you can see it.`,
      );
      end();
    },
    [attachContext, openAssistant, end, toast],
  );

  if (!supported) return null;

  return (
    <>
      <Button
        onClick={() => void start()}
        size="icon"
        variant="ghost"
        className="size-8"
        aria-label="Capture an area for the assistant"
        title="Capture an area for the assistant"
        data-tour="capture"
        disabled={phase.at !== 'idle'}
      >
        <Crop aria-hidden />
      </Button>
      {phase.at === 'selecting' && <SelectLayer onPick={grab} onCancel={end} />}
      {phase.at === 'preview' && (
        <CapturePreview shot={phase.shot} canAttach={canAttach} onSave={save} onCancel={end} />
      )}
    </>
  );
}

/** The dimmed layer the user drags a rectangle on. Esc, or a click without
 *  a drag, cancels. */
function SelectLayer({ onPick, onCancel }: { onPick: (rect: Rect) => void; onCancel: () => void }) {
  const [from, setFrom] = useState<Point | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  const view = () => ({ w: window.innerWidth, h: window.innerHeight });
  const at = (e: React.PointerEvent): Point => ({ x: e.clientX, y: e.clientY });

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Capture an area"
      data-capture-layer=""
      className="fixed inset-0 z-[70] cursor-crosshair touch-none select-none"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setFrom(at(e));
        setRect(dragRect(at(e), at(e), view()));
      }}
      onPointerMove={(e) => {
        if (from) setRect(dragRect(from, at(e), view()));
      }}
      onPointerUp={(e) => {
        if (!from) return;
        const r = dragRect(from, at(e), view());
        setFrom(null);
        if (usableRect(r)) onPick(r);
        else onCancel();
      }}
    >
      {rect && usableRect(rect) ? (
        <div
          // The scrim around the area is a shadow, so the area itself stays
          // clear: a raw black, as the dialog scrim's, because it dims
          // whatever is behind and belongs to no theme.
          className="absolute rounded-[2px] outline outline-2 outline-primary"
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.w,
            height: rect.h,
            boxShadow: '0 0 0 100vmax rgb(0 0 0 / 0.45)',
          }}
        >
          <span className="absolute -top-7 left-0 rounded border border-border bg-popover px-1.5 py-0.5 text-[11px] tabular-nums text-popover-foreground shadow-sm">
            {rect.w} × {rect.h}
          </span>
        </div>
      ) : (
        // The same scrim as the dialog's (dialog.tsx): it dims whatever is
        // behind, which belongs to no surface and no theme.
        // eslint-disable-next-line house/no-palette-literal
        <div className="absolute inset-0 bg-black/45" />
      )}
      {!from && (
        <p className="pointer-events-none absolute inset-x-0 top-[calc(var(--top-bar-h,0px)+1rem)] mx-auto w-fit rounded-md border border-border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md">
          Drag to capture an area. Esc cancels.
        </p>
      )}
    </div>,
    document.body,
  );
}

/** The capture, a note, and the ways on: Attach to chat (the default, where
 *  the chat takes attachments) or Save only. */
function CapturePreview({
  shot,
  canAttach,
  onSave,
  onCancel,
}: {
  shot: Shot;
  /** Whether the chat takes attachments (an Admin user's; a workspace chat
   *  takes text only, and its assistant cannot read the private file). */
  canAttach: boolean;
  onSave: (shot: Shot, note: string, attach: boolean) => Promise<void>;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'attach' | 'save' | null>(null);

  const run = async (attach: boolean) => {
    setBusy(attach ? 'attach' : 'save');
    try {
      await onSave(shot, note, attach);
    } catch (err) {
      toast.error(`The screenshot was not saved: ${captureErrorMessage(err)}`);
      setBusy(null);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Screenshot</DialogTitle>
          <DialogDescription>
            It shows whatever was in the area, so check it first. Nothing is saved or sent until you
            choose below. Once saved, only you can see it.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[50vh] justify-center overflow-auto rounded-md border border-border bg-muted/40 p-2 scrollbar-thin">
          {/* A local blob: next/image cannot optimise it, and need not. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={shot.url}
            alt="The captured area"
            className="h-auto max-w-full object-contain"
            style={{ aspectRatio: `${shot.rect.w} / ${shot.rect.h}` }}
          />
        </div>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add a note (optional)"
          aria-label="Note"
          maxLength={2000}
          rows={2}
        />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={!!busy}>
            Cancel
          </Button>
          <Button
            variant={canAttach ? 'outline' : 'default'}
            autoFocus={!canAttach}
            onClick={() => void run(false)}
            disabled={!!busy}
          >
            {busy === 'save' && <Loader2 className="animate-spin" aria-hidden />}
            {canAttach ? 'Save only' : 'Save'}
          </Button>
          {canAttach && (
            <Button autoFocus onClick={() => void run(true)} disabled={!!busy}>
              {busy === 'attach' && <Loader2 className="animate-spin" aria-hidden />}
              Attach to chat
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
