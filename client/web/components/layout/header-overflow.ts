'use client';

import { useEffect, useState, type RefObject } from 'react';

/** One header tool button: `icon-sm` is 36px, the group's gap is 4px. */
export const TOOL_WIDTH = 36;
export const TOOL_GAP = 4;
/** What the title keeps before a tool folds into More: about twelve
 *  characters of a 15px title beside its glyph. */
export const TITLE_RESERVE = 200;

/**
 * How many of `count` tools fit in `available` pixels, from the front of the
 * list (priority+, item header contract 2026-10-21). The rest fold into More,
 * so the last tool (Delete) is the first to go.
 */
export function fitTools(
  available: number,
  count: number,
  toolWidth = TOOL_WIDTH,
  gap = TOOL_GAP,
): number {
  if (count <= 0 || available <= 0) return 0;
  const fits = Math.floor((available + gap) / (toolWidth + gap));
  return Math.max(0, Math.min(count, fits));
}

/**
 * The tools that stay inline in a header row: the row's width less its
 * padding, the title's reserve and the parts that never fold (the word
 * buttons and the fixed slots on the right). Measured, never per-screen
 * breakpoints: the same header sits in panes of every width. Every tool
 * shows until the first measure.
 */
export function useHeaderOverflow(
  rowRef: RefObject<HTMLElement | null>,
  fixedRefs: RefObject<HTMLElement | null>[],
  count: number,
): number {
  const [visible, setVisible] = useState(count);
  useEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === 'undefined') {
      setVisible(count);
      return;
    }
    const measure = () => {
      const style = getComputedStyle(row);
      const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const gap = parseFloat(style.columnGap) || 0;
      const fixed = fixedRefs.reduce((sum, r) => sum + (r.current?.offsetWidth ?? 0) + gap, 0);
      setVisible(fitTools(row.clientWidth - padding - TITLE_RESERVE - fixed - gap, count));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    for (const r of fixedRefs) if (r.current) ro.observe(r.current);
    return () => ro.disconnect();
    // The refs are stable; `count` changes when a mode adds tools.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);
  return visible;
}
