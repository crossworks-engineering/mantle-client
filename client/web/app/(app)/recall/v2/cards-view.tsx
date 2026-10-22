'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useDefaultLayout } from 'react-resizable-panels';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@mantle/web-ui/ui/resizable';

const LIST = 'cards';
const EDITOR = 'editor';
const INSPECTOR = 'inspector';

/** The frame's own width (not the window's: the folders, the rails and
 *  Maximise all change it) decides how many columns fit: list, editor and
 *  inspector from here, list and editor from TWO, the list stacked over the
 *  editor below that. */
const THREE = 880;
const TWO = 560;

type Mode = 'three' | 'two' | 'stack';

/** What `useDefaultLayout` reads on the server (see `MeasuredPane`). */
const NO_STORAGE = { getItem: () => null, setItem: () => {} };

function useWidth(ref: React.RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);
  // Measured before the first paint too, so the frame never flashes the
  // stacked layout on a screen with room for columns (and a page the browser
  // is not painting, which delivers no resize observations, still lays out).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/**
 * The Cards view's frame: the card list, the editor, and the inspector, each
 * edge draggable and the widths remembered (per column count).
 *
 * The editor panel is the SAME element in every layout, so a change of
 * width (Maximise, a dragged rail) never remounts it and never loses unsaved
 * text. The inspector column is a slot the card editor portals into:
 * `children` gets its element, or null when there is no room for a third
 * column, and the inspector then follows the text in the editor's scroll.
 */
export function CardsView({
  list,
  children,
}: {
  list: ReactNode;
  children: (inspector: HTMLElement | null) => ReactNode;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const width = useWidth(frame);
  const mode: Mode = width === null || width < TWO ? 'stack' : width < THREE ? 'two' : 'three';
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const ids = mode === 'three' ? [LIST, EDITOR, INSPECTOR] : [LIST, EDITOR];
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: `recall-cards:${mode}`,
    panelIds: ids,
    onlySaveAfterUserInteractions: true,
    storage: typeof window === 'undefined' ? NO_STORAGE : window.localStorage,
  });
  const stacked = mode === 'stack';

  return (
    <div ref={frame} className="h-full min-h-0">
      <ResizablePanelGroup
        orientation={stacked ? 'vertical' : 'horizontal'}
        id={`recall-cards:${mode}`}
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
        className="h-full items-stretch overflow-hidden"
      >
        <ResizablePanel
          id={LIST}
          defaultSize={stacked ? '35%' : '240px'}
          minSize={stacked ? '15%' : '180px'}
          maxSize={stacked ? '70%' : '480px'}
        >
          {list}
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel id={EDITOR} minSize={stacked ? '30%' : '360px'}>
          <div className="relative h-full min-h-0">{children(mode === 'three' ? slot : null)}</div>
        </ResizablePanel>
        {mode === 'three' && <ResizableHandle withHandle />}
        {mode === 'three' && (
          <ResizablePanel id={INSPECTOR} defaultSize="320px" minSize="260px" maxSize="560px">
            <div ref={setSlot} className="relative h-full min-h-0 overflow-y-auto scrollbar-thin" />
          </ResizablePanel>
        )}
      </ResizablePanelGroup>
    </div>
  );
}
