'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import type { SectionId } from '@/lib/status';
import { StatusBoard } from './status-board';
import { StatusNav } from './status-nav';
import { SECTIONS } from './status-sections';
import { useStatus } from './use-status';

/**
 * The Status screen: master-detail like every other screen (style guide
 * §8), the section cards in the list column and the whole board in the
 * detail. `detailFills`: the board is gauges, charts and card grids, not a
 * measure of prose, so it takes the slack and reflows as the divider moves
 * (its grids follow the pane's own width, `@container/status`).
 *
 * The data is read ONCE here and handed to both columns, so the cards and
 * the board agree and the live history is kept in one place.
 */
export function StatusClient() {
  const status = useStatus();
  const [active, setActive] = useState<SectionId>('overview');
  // While a click's smooth scroll runs, the spy holds the clicked section,
  // so the selection does not flicker through every section passed.
  const pinned = useRef<{ id: SectionId; until: number } | null>(null);

  const jump = useCallback((id: SectionId) => {
    setActive(id);
    pinned.current = { id, until: Date.now() + 800 };
    const el = document.getElementById(`status-${id}`);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }, []);

  // Scroll spy: the topmost section whose top has passed the upper third of
  // the pane is the one in view.
  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(`status-${s.id}`)).filter(
      (e): e is HTMLElement => e !== null,
    );
    if (els.length === 0) return;
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        const p = pinned.current;
        if (p && Date.now() < p.until) return;
        pinned.current = null;
        const first = SECTIONS.find((s) => seen.get(`status-${s.id}`));
        if (first) setActive(first.id);
      },
      { rootMargin: '0px 0px -66% 0px' },
    );
    for (const el of els) io.observe(el);
    return () => io.disconnect();
  }, [status.health.isSuccess]);

  return (
    <MasterDetail
      id="status"
      defaultListSize="320px"
      minListSize="260px"
      maxListSize="460px"
      detailFills
      list={<StatusNav status={status} active={active} onPick={jump} />}
      detail={<StatusBoard status={status} onJump={jump} />}
    />
  );
}
