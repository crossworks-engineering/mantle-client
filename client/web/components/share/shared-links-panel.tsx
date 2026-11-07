'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Copy, ExternalLink, Link2, Link2Off } from 'lucide-react';
import { ListCard, ListCardMeta, ListCardTitle } from '@mantle/web-ui/ui/list-card';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import { useToast } from '@mantle/web-ui/ui/toast';
import { ApiError } from '@mantle/web-ui/api-fetch';
import { serverUrl } from '@mantle/web-ui/runtime-env';
import { formatDate } from '@mantle/web-ui/lib/format-datetime';
import { kindLabel } from '@/lib/item-kinds';
import { SHARES_KEY, revokeShareLink } from '@/lib/shared-links';
import { HeaderIconButton, ItemHeader } from '@/components/layout/item-header';
import { RevokeLinkDialog } from './revoke-link-dialog';

export { SHARES_KEY };

/** One active link from GET /api/team-admin/shares. Every link is open
 *  (anyone with it can view): team links are retired (member logins Phase 6
 *  stage 6), so the row's share `mode` is always 'public' and is not read.
 *  A link follows no level since W5b2 (contract 30), so none shows. */
export type SharedLinkRow = {
  id: string;
  path: string;
  nodeId: string;
  nodeType: string;
  title: string;
  icon: string | null;
  cascade: boolean;
  createdAt: string;
  viewCount: number;
  lastViewedAt: string | null;
  /** A contact share (brain migration 0214): the contact it is for, and
   *  whether that contact may write the app. Absent on an open link and on
   *  older brains. */
  contactId?: string | null;
  contactName?: string | null;
  canWrite?: boolean;
};

/** The contact line of a contact share's card, or null for an open link. */
function contactLine(row: SharedLinkRow): string | null {
  if (!row.contactId) return null;
  const who = row.contactName || 'a removed contact';
  return `For ${who} only${row.canWrite ? ', can write' : ''}`;
}

type SharesData = { shares: SharedLinkRow[] };

/**
 * The owner's exposure registry (Settings > Shared links): every active
 * share link, newest first. One glance answers "what can people outside see
 * right now?". A link is always open: users read items through their
 * workspaces with their own logins, not by link.
 *
 * Master-detail: the links as cards on the left, and the SELECTED link's real
 * `/s/...` page framed on the right under the one header. The preview is the
 * server surface itself, so it shows exactly what a visitor gets. Copy, open
 * and revoke are the header's icons. The rows are the screen's query, not a
 * copy of it: a revoke takes the link out of that query at once and then
 * refetches it, so a revoked link cannot come back, and a later refetch
 * always shows.
 */
export function SharedLinksPanel({
  rows,
  initialSelectedId,
}: {
  rows: SharedLinkRow[];
  /** Open at this link (`?share=`). */
  initialSelectedId?: string;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(
    rows.find((r) => r.id === initialSelectedId)?.id ?? rows[0]?.id ?? null,
  );
  const [confirmRevoke, setConfirmRevoke] = useState<SharedLinkRow | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  // Keep the selection on a live row: a revoke (or a refetch) must not leave
  // the preview on a link that no longer exists.
  useEffect(() => {
    if (selectedId && rows.some((r) => r.id === selectedId)) return;
    setSelectedId(rows[0]?.id ?? null);
  }, [rows, selectedId]);

  const selected = rows.find((r) => r.id === selectedId) ?? null;

  const copy = async (row: SharedLinkRow) => {
    try {
      // Same origin fix as AccessControl: /s/... is the server tier's surface.
      await navigator.clipboard.writeText(serverUrl(row.path));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Copy failed');
    }
  };

  const revoke = async () => {
    if (!confirmRevoke) return;
    setBusy(true);
    try {
      await revokeShareLink(confirmRevoke.id);
      const gone = confirmRevoke.id;
      queryClient.setQueryData<SharesData>(SHARES_KEY, (d) =>
        d ? { ...d, shares: d.shares.filter((x) => x.id !== gone) } : d,
      );
      void queryClient.invalidateQueries({ queryKey: SHARES_KEY });
      toast.success(`Unshared "${confirmRevoke.title}"`);
      setConfirmRevoke(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      toast.error(e instanceof Error ? e.message : 'Could not revoke the link');
    } finally {
      setBusy(false);
    }
  };

  const nothingShared = (
    <div className="text-center text-sm text-muted-foreground">
      <p>Nothing is shared right now.</p>
      <p className="mt-1">
        Use the Share button on any page, note, table, app, task, event, file, or folder.
      </p>
    </div>
  );

  if (rows.length === 0) {
    return <div className="flex flex-1 items-center justify-center p-8">{nothingShared}</div>;
  }

  return (
    <>
      <MasterDetail
        id="settings-shared-links"
        className="min-h-0 flex-1"
        defaultListSize="340px"
        defaultDetailSize="768px"
        maxDetailSize="100%"
        list={
          <>
            <div className="flex items-baseline gap-2 border-b border-border p-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Shared links
              </h2>
              <span className="text-xs text-muted-foreground">{rows.length}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
              <ul className="flex flex-col gap-2 p-3">
                {rows.map((row) => (
                  <li key={row.id}>
                    <ListCard
                      selected={row.id === selectedId}
                      onClick={() => setSelectedId(row.id)}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-1.5">
                          {row.icon ? <span aria-hidden>{row.icon}</span> : null}
                          <ListCardTitle>{row.title}</ListCardTitle>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatDate(row.createdAt)}
                        </span>
                      </div>
                      <ListCardMeta>
                        {kindLabel(row.nodeType)} · {row.viewCount} view
                        {row.viewCount === 1 ? '' : 's'}
                        {row.lastViewedAt ? `, last ${formatDate(row.lastViewedAt)}` : ''}
                      </ListCardMeta>
                      {contactLine(row) ? <ListCardMeta>{contactLine(row)}</ListCardMeta> : null}
                    </ListCard>
                  </li>
                ))}
              </ul>
            </div>
          </>
        }
        detail={
          <section className="flex h-full min-h-0 flex-col">
            {selected ? (
              <>
                <ItemHeader
                  visual={
                    selected.icon ? (
                      <span aria-hidden>{selected.icon}</span>
                    ) : (
                      <Link2 className="size-4 text-muted-foreground" aria-hidden />
                    )
                  }
                  title={selected.title}
                  subtitle={
                    contactLine(selected)
                      ? `${contactLine(selected)}. It opens with their code.`
                      : `${kindLabel(selected.nodeType)} · shared ${formatDate(selected.createdAt)} · ${selected.viewCount} view${selected.viewCount === 1 ? '' : 's'}`
                  }
                  iconActions={
                    <>
                      <HeaderIconButton label="Copy link" onClick={() => void copy(selected)}>
                        {copied ? <Check /> : <Copy />}
                      </HeaderIconButton>
                      <HeaderIconButton label="Open link" asChild>
                        <Link href={selected.path} target="_blank" rel="noopener">
                          <ExternalLink />
                        </Link>
                      </HeaderIconButton>
                      <HeaderIconButton
                        label="Revoke link"
                        className="text-muted-foreground hover:text-destructive-ink"
                        onClick={() => setConfirmRevoke(selected)}
                      >
                        <Link2Off />
                      </HeaderIconButton>
                    </>
                  }
                />
                {/* The share surface itself, framed: what a visitor actually
                    sees at this link. Keyed so a selection change remounts
                    rather than pushing iframe history. */}
                <iframe
                  key={selected.id}
                  src={serverUrl(selected.path)}
                  title={`Share preview: ${selected.title}`}
                  className="min-h-0 w-full flex-1 border-0 bg-background"
                />
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <div className="text-center text-sm text-muted-foreground">
                  <Link2 className="mx-auto mb-2 size-6" />
                  <p>Select a link to preview what it shows.</p>
                </div>
              </div>
            )}
          </section>
        }
      />

      <RevokeLinkDialog
        target={
          confirmRevoke
            ? {
                shareId: confirmRevoke.id,
                title: confirmRevoke.title,
                cascade: confirmRevoke.cascade,
                stays: confirmRevoke.contactId
                  ? `Only ${confirmRevoke.contactName || 'that contact'} loses it. The workspaces do not change.`
                  : null,
              }
            : null
        }
        busy={busy}
        onCancel={() => setConfirmRevoke(null)}
        onConfirm={() => void revoke()}
      />
    </>
  );
}
