'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import type { Editor } from '@tiptap/react';
import { Expand, ExternalLink, Presentation } from 'lucide-react';
import { CanvasSandbox } from '@mantle/share-ui/canvas-sandbox';
import { apiFetch, apiUrl, withAuth } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { useToast } from '@mantle/web-ui/ui/toast';
import { cn } from '@mantle/web-ui/lib/utils';
import { ItemHeader, type HeaderTool } from '@/components/layout/item-header';

/**
 * A Present canvas embedded in a page (markdown `![Title](present:<id>)`, an
 * image node with `presentId`, image.ts).
 *
 * The page shows the canvas's SNAPSHOT: a plain figure the schema renders the
 * same way in the editor, the read-only PageView and the share surface. Its
 * state is stamped here, from what the brain says of the canvas for THIS
 * reader (GET /api/presents/:id/poster?meta=1, in the reader's scope):
 *
 *   live    the reader may open the canvas; the picture is its latest save
 *   stale   the same, but the canvas has been saved since the picture
 *   none    the reader may open it; no picture has been drawn yet
 *   hidden  the brain answers no canvas for this reader: a placeholder, no
 *           picture, no title from the canvas, no way through
 *
 * A click on a canvas the reader may open shows the LIVE canvas over the
 * page's display area (`CanvasEmbedHost`), in the same sandbox and with the
 * same frame ticket and proof as the Present workspace: the canvas's own
 * rights decide, never the page's. In the editor only the caption bar
 * opens it, so a click on the picture still selects the block.
 */

/** What the brain answers about a canvas for this reader. */
type EmbedFacts = { title: string; rev: number; posterRev: number | null; current: boolean };
export type CanvasEmbedState = 'loading' | 'live' | 'stale' | 'none' | 'hidden';

/** Facts per canvas, kept a short while: a page with the same canvas twice,
 *  or a re-render, asks once. A save elsewhere shows on the next look. */
const FACTS_TTL_MS = 30_000;
const facts = new Map<string, { at: number; p: Promise<EmbedFacts | null> }>();

function factsOf(presentId: string): Promise<EmbedFacts | null> {
  const hit = facts.get(presentId);
  if (hit && Date.now() - hit.at < FACTS_TTL_MS) return hit.p;
  const p = apiFetch<EmbedFacts>(
    `/api/presents/${encodeURIComponent(presentId)}/poster?meta=1`,
  ).catch(() => null);
  facts.set(presentId, { at: Date.now(), p });
  return p;
}

/** Forget what was asked, so the next stamp asks again (a save came in). */
export function forgetCanvasEmbedFacts(): void {
  facts.clear();
}

export function canvasEmbedState(f: EmbedFacts | null): CanvasEmbedState {
  if (!f) return 'hidden';
  if (f.posterRev === null) return 'none';
  return f.current ? 'live' : 'stale';
}

/** The caption bar's words for each state (read by the CSS, image.ts). */
const NOTE: Record<CanvasEmbedState, string> = {
  loading: 'Canvas',
  live: 'Canvas: open it live',
  stale: 'Canvas: a newer version exists, open it to see',
  none: 'Canvas: no picture yet, open it live',
  hidden: 'A canvas you cannot open',
};

/**
 * Stamp every canvas embed under `root` with its state. Returns the cancel
 * that keeps late answers off a DOM the caller has left. ProseMirror ignores
 * attribute changes inside a leaf node's DOM, so this is no edit.
 */
export function stampCanvasEmbeds(root: ParentNode): () => void {
  let live = true;
  const figures = root.querySelectorAll<HTMLElement>('figure[data-present-id]');
  for (const fig of figures) {
    const id = fig.getAttribute('data-present-id');
    if (!id) continue;
    const bar = fig.querySelector<HTMLElement>('figcaption');
    if (fig.getAttribute('data-canvas-state') === 'loading') {
      bar?.setAttribute('data-note', NOTE.loading);
    }
    void factsOf(id).then((f) => {
      // Re-read the id: ProseMirror recycles DOM across edits.
      if (!live || fig.getAttribute('data-present-id') !== id) return;
      const state = canvasEmbedState(f);
      fig.setAttribute('data-canvas-state', state);
      bar?.setAttribute('data-note', NOTE[state]);
      if (state === 'hidden') {
        // Nothing of the canvas for a reader who may not read it: the
        // picture (a 404) goes, and only the placeholder shows.
        fig.querySelector('img')?.removeAttribute('src');
        fig.removeAttribute('title');
      } else {
        fig.setAttribute('title', 'Open the live canvas');
      }
    });
  }
  return () => {
    live = false;
  };
}

/** The canvas a click under `root` asks to open, or null. In the editor
 *  only the caption bar opens it. */
export function canvasToOpen(target: EventTarget | null, editing: boolean): string | null {
  if (!(target instanceof Element)) return null;
  const fig = target.closest<HTMLElement>('figure[data-present-id]');
  if (!fig) return null;
  if (editing && !target.closest('[data-canvas-open]')) return null;
  const state = fig.getAttribute('data-canvas-state') as CanvasEmbedState | null;
  if (state !== 'live' && state !== 'stale' && state !== 'none') return null;
  return fig.getAttribute('data-present-id');
}

const OpenCanvas = createContext<((presentId: string) => void) | null>(null);

/**
 * The page display area a live canvas opens over. Wrap the pane that shows
 * a page (the list's preview, the editor's body); the canvas then fills it,
 * with its own header, until Back or Esc.
 */
export function CanvasEmbedHost({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <OpenCanvas.Provider value={setOpenId}>
      <div className={cn('relative', className)}>
        {children}
        {openId && (
          <CanvasEmbedView key={openId} presentId={openId} onClose={() => setOpenId(null)} />
        )}
      </div>
    </OpenCanvas.Provider>
  );
}

/** Listen for clicks under `root` that open a canvas (the editor with
 *  `editing`: only the caption bar). Returns the remove. */
function listenForCanvasClicks(
  root: HTMLElement,
  open: (presentId: string) => void,
  editing: boolean,
): () => void {
  const onClick = (e: MouseEvent) => {
    const id = canvasToOpen(e.target, editing);
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    open(id);
  };
  root.addEventListener('click', onClick, true);
  return () => root.removeEventListener('click', onClick, true);
}

/** The host's opener, or null outside a host (a page there opens nothing:
 *  the snapshot is all it shows). */
export function useCanvasEmbedOpener(): ((presentId: string) => void) | null {
  return useContext(OpenCanvas);
}

/** A read surface's canvas embeds under `rootRef`: stamped, and opened on
 *  a click. `version` changes when the HTML under it is replaced. */
export function useStaticCanvasEmbeds(
  rootRef: RefObject<HTMLElement | null>,
  version: unknown,
): void {
  const open = useCanvasEmbedOpener();
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const cancel = stampCanvasEmbeds(root);
    const unlisten = open ? listenForCanvasClicks(root, open, false) : () => {};
    return () => {
      cancel();
      unlisten();
    };
  }, [rootRef, open, version]);
}

/** The editor's canvas embeds: stamped on every update, opened from the
 *  caption bar. */
export function useCanvasEmbeds(editor: Editor | null): void {
  const open = useCanvasEmbedOpener();
  useEffect(() => {
    if (!editor) return;
    let cancel = () => {};
    const stamp = () => {
      cancel();
      cancel = stampCanvasEmbeds(editor.view.dom);
    };
    stamp();
    editor.on('update', stamp);
    const unlisten = open ? listenForCanvasClicks(editor.view.dom, open, true) : () => {};
    return () => {
      cancel();
      unlisten();
      editor.off('update', stamp);
    };
  }, [editor, open]);
}

/** The live canvas over the page's display area: the standard header, then
 *  the canvas in its sandbox. Decks keep their arrow keys (the frame takes
 *  focus) and Full screen. */
function CanvasEmbedView({ presentId, onClose }: { presentId: string; onClose: () => void }) {
  const toast = useToast();
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [title, setTitle] = useState('Canvas');
  const [frameUp, setFrameUp] = useState(false);

  useEffect(() => {
    let live = true;
    void factsOf(presentId).then((f) => {
      if (live && f?.title) setTitle(f.title);
    });
    return () => {
      live = false;
    };
  }, [presentId]);

  // Esc returns to the page while the focus is on the page side; inside the
  // frame the canvas has the keys (a deck's own Esc), and Back is there.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const fullScreen: HeaderTool = {
    key: 'full-screen',
    label: 'Full screen',
    icon: <Expand />,
    disabled: !frameUp,
    onSelect: () => {
      const frame = frameRef.current;
      if (!frame) return;
      frame
        .requestFullscreen()
        .then(() => frame.focus())
        .catch(() => toast.error('Full screen is not available here'));
    },
  };
  const inPresent: HeaderTool = {
    key: 'open-in-present',
    label: 'Open in Present',
    icon: <ExternalLink />,
    href: `/present/${encodeURIComponent(presentId)}`,
  };
  const ready = useCallback(() => {
    setFrameUp(true);
    // The canvas takes the keys at once: a deck's arrows work without a
    // click into it first.
    frameRef.current?.focus();
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={`Canvas: ${title}`}
      className="absolute inset-0 z-30 flex min-h-0 flex-col bg-background"
    >
      <ItemHeader
        section="Present"
        visual={<Presentation className="size-4 text-muted-foreground" aria-hidden />}
        title={title}
        focus={false}
        textActions={
          <Button variant="outline" size="sm" onClick={onClose}>
            Back to page
          </Button>
        }
        tools={[fullScreen, inPresent]}
      />
      <div className="relative min-h-0 flex-1">
        <CanvasSandbox
          presentId={presentId}
          apiBase={apiUrl(`/api/presents/${encodeURIComponent(presentId)}`)}
          fetcher={(input, init) => fetch(input, withAuth(init))}
          title={title}
          frameRef={frameRef}
          loader={<Spinner />}
          onReady={ready}
          onDown={() => setFrameUp(false)}
        />
      </div>
    </div>
  );
}
