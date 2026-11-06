'use client';

import { useLayoutEffect, useState, type RefObject } from 'react';

/** The room the labels must have, as a share of their natural width plus a
 *  few pixels: they fold to icons early rather than touch. */
export const FOLD_BELOW = 1.1;
/** They come back only with more room again, so a drag along the edge does
 *  not flick between the two. */
export const UNFOLD_AT = 1.2;
export const FIT_SLACK = 8;

/**
 * Whether the view tabs show as icons: `available` is the group's width,
 * `need` the labels' natural width with each tab's padding and border.
 * Both are measured in the user's own font, so no breakpoint is tuned to one
 * font or size. Between the two thresholds the tabs keep what they were.
 */
export function tabsCompact(available: number, need: number, wasCompact: boolean): boolean {
  if (available <= 0 || need <= 0) return wasCompact;
  if (available < need * FOLD_BELOW + FIT_SLACK) return true;
  if (available >= need * UNFOLD_AT + FIT_SLACK) return false;
  return wasCompact;
}

const px = (v: string) => parseFloat(v) || 0;

/**
 * Measures the tab group (`groupRef`) against a hidden copy of its labels
 * (`labelsRef`: one span per tab, in the tabs' font) and says when the
 * labels no longer fit. The copy keeps its width while the tabs show icons,
 * and its resize catches a font or font size change. `shown` is false while
 * the tabs are not on screen (a search hides them), so a remount measures.
 */
export function useCompactTabs(
  groupRef: RefObject<HTMLElement | null>,
  labelsRef: RefObject<HTMLElement | null>,
  shown = true,
): boolean {
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => {
    const group = groupRef.current;
    const labels = labelsRef.current;
    if (!group || !labels || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const tab = group.firstElementChild;
      const s = tab ? getComputedStyle(tab) : null;
      const chrome = s
        ? px(s.paddingLeft) + px(s.paddingRight) + px(s.borderLeftWidth) + px(s.borderRightWidth)
        : 0;
      const need = labels.getBoundingClientRect().width + chrome * labels.childElementCount;
      const available = group.clientWidth;
      setCompact((was) => tabsCompact(available, need, was));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(group);
    ro.observe(labels);
    return () => ro.disconnect();
    // The refs are stable; their elements change only when `shown` does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);
  return compact;
}
