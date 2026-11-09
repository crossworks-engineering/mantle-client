'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, FileText } from 'lucide-react';
import { apiFetch } from '@mantle/web-ui/api-fetch';
import { useShellRole } from '@/components/layout/shell-role';
import { childPageHref, childPageLivePath } from '@/lib/child-page-card';

/** What a page link card shows before the live title comes in: the
 *  snapshot the `childPage` node keeps. */
export interface ChildPageSnapshot {
  pageId: string | null;
  title: string;
  icon: string | null;
}

/** The snapshot from a node's attrs (the editor) or from the data
 *  attributes `renderHTML` writes (a static read). One reader, so both
 *  draw the same card from the same values. */
export function childPageSnapshot(attrs: {
  pageId?: unknown;
  title?: unknown;
  icon?: unknown;
}): ChildPageSnapshot {
  return {
    pageId: typeof attrs.pageId === 'string' && attrs.pageId ? attrs.pageId : null,
    title: typeof attrs.title === 'string' && attrs.title ? attrs.title : 'Untitled page',
    icon: typeof attrs.icon === 'string' && attrs.icon ? attrs.icon : null,
  };
}

/** The snapshot from a static `div[data-child-page]`. */
export function childPageSnapshotOf(el: Pick<Element, 'getAttribute'>): ChildPageSnapshot {
  return childPageSnapshot({
    pageId: el.getAttribute('data-page-id'),
    title: el.getAttribute('data-title'),
    icon: el.getAttribute('data-icon'),
  });
}

/**
 * The page link card: the editor's NodeView (child-page-view.tsx) and the
 * read view (static-doc.tsx) both draw this, so a card looks and links the
 * same when a page is edited and when it is read.
 *
 * The title and icon start as the node's snapshot and are refreshed from
 * `/api/pages/<id>` on mount, so a later rename shows here. Display only:
 * nothing is written back into the node.
 */
export function ChildPageCard({ pageId, title: snapTitle, icon: snapIcon }: ChildPageSnapshot) {
  const [title, setTitle] = useState(snapTitle);
  const [icon, setIcon] = useState<string | null>(snapIcon);
  // A role not known yet keeps the snapshot and links nowhere (fail closed,
  // lib/child-page-card.ts).
  const role = useShellRole();
  const livePath = childPageLivePath(role, pageId);
  const href = childPageHref(role, pageId);

  useEffect(() => {
    if (!livePath) return;
    let cancelled = false;
    apiFetch<{ page?: { title?: string; icon?: string | null } }>(livePath)
      .then((data) => {
        if (cancelled || !data?.page) return;
        if (typeof data.page.title === 'string' && data.page.title) setTitle(data.page.title);
        setIcon(typeof data.page.icon === 'string' ? data.page.icon : null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [livePath]);

  const face = (
    <>
      <span className="flex size-6 shrink-0 items-center justify-center text-base leading-none">
        {icon ?? <FileText className="size-4 text-muted-foreground" aria-hidden />}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{title}</span>
    </>
  );

  return href || !pageId ? (
    <Link
      href={href ?? '#'}
      contentEditable={false}
      data-child-page-card=""
      className="group flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 no-underline transition-colors hover:bg-accent/40"
    >
      {face}
      <ChevronRight
        className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        aria-hidden
      />
    </Link>
  ) : (
    <div
      contentEditable={false}
      data-child-page-card=""
      className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5"
    >
      {face}
    </div>
  );
}
