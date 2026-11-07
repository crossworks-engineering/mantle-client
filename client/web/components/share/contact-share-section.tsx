'use client';

/**
 * "Share with contact" in the Access control (contact shares, brain
 * migration 0214). Under the level toggle; not on folders (v1).
 *
 * A searchable multi-select over the brain's contacts (GET /api/contacts?q=):
 * each row shows name and email; tick one or more, then Add. A contact with
 * sharing off is listed but greyed, not tickable, with the way to turn it on.
 * For an app, a "Can write" switch for the ones being added (off by
 * default), and one per added contact. Each added contact: Copy link and
 * Remove (the same revoke as the contact's "Shared" tab). The item's level
 * never changes.
 *
 * Access matrix L21: an app's open link reads what Can write contacts put in
 * it, so while the app has an open link the section warns once a contact has
 * Can write, or once the add form's Can write is on (beside that switch). A
 * warning only; the brain refuses nothing.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Check, Copy, Loader2, UserRoundPlus, X } from 'lucide-react';
import type { AccessContactShare } from '@mantle/client-types';
import { Button } from '@mantle/web-ui/ui/button';
import { Checkbox } from '@mantle/web-ui/ui/checkbox';
import { Input } from '@mantle/web-ui/ui/input';
import { Switch } from '@mantle/web-ui/ui/switch';
import { useToast } from '@mantle/web-ui/ui/toast';
import { apiFetch, ApiError } from '@mantle/web-ui/api-fetch';
import { serverUrl } from '@mantle/web-ui/runtime-env';
import { copyText } from '@mantle/web-ui/lib/secure-context-fallbacks';
import {
  OPEN_LINK_READS_CONTACT_WRITES,
  SHARING_OFF_HINT,
  contactHref,
  offersCanWrite,
  openLinkReadsContactWrites,
  pickBlocked,
  setShareCanWrite,
  shareWithContacts,
  type SharingContactRow,
} from '@/lib/contact-shares';

type ContactsPage = { contacts: SharingContactRow[] };

/** The L21 warning (an app's open link reads what Can write contacts put in
 *  it), in the warning tones the settings screens use for an inline caution. */
export function OpenLinkDataWarning() {
  return (
    <p className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-xs text-warning-ink">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{OPEN_LINK_READS_CONTACT_WRITES}</span>
    </p>
  );
}

export function ContactShareSection({
  nodeId,
  itemType,
  shares,
  openLink,
  onChanged,
  onRemove,
}: {
  nodeId: string;
  itemType: string;
  shares: readonly AccessContactShare[];
  /** The item has an open link now (its own share link). */
  openLink: boolean;
  /** Reload the Access view after an add or a Can write change. */
  onChanged: () => void;
  /** Ask to remove one (the revoke confirm lives beside the popover). */
  onRemove: (share: AccessContactShare) => void;
}) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [canWrite, setCanWrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const app = offersCanWrite(itemType);
  const givingCanWrite = adding && canWrite;
  const warnOpenLink = openLinkReadsContactWrites({ itemType, openLink, shares, givingCanWrite });

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  const contacts = useQuery({
    queryKey: ['contacts', 'share-picker', debounced],
    queryFn: () =>
      apiFetch<ContactsPage>(
        `/api/contacts${debounced ? `?q=${encodeURIComponent(debounced)}` : ''}`,
      ),
    enabled: adding,
    placeholderData: (prev) => prev,
  });
  const shared = useMemo(() => new Set(shares.map((s) => s.contactId)), [shares]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const add = async () => {
    if (picked.size === 0) return;
    setBusy(true);
    try {
      const res = await shareWithContacts(nodeId, [...picked], app && canWrite);
      toast.success(
        `Shared with ${res.shares.length} contact${res.shares.length === 1 ? '' : 's'}. Send each their link and their code, apart.`,
      );
      setPicked(new Set());
      setCanWrite(false);
      setAdding(false);
      setQuery('');
      onChanged();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      toast.error(e instanceof Error ? e.message : 'Could not share with those contacts');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (share: AccessContactShare) => {
    if (await copyText(serverUrl(share.path))) {
      setCopiedId(share.shareId);
      setTimeout(() => setCopiedId(null), 1500);
    } else {
      toast.error('Could not copy to clipboard');
    }
  };

  const writeSwitch = async (share: AccessContactShare, next: boolean) => {
    try {
      await setShareCanWrite(share.shareId, next);
      onChanged();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      toast.error(e instanceof Error ? e.message : 'Could not change Can write');
    }
  };

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Share with contact</p>
        {!adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <UserRoundPlus />
            Add
          </Button>
        )}
      </div>

      {shares.length > 0 && (
        <ul className="space-y-1.5" aria-label="Contacts it is shared with">
          {shares.map((s) => (
            <li key={s.shareId} className="flex min-w-0 items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate" title={s.name}>
                {s.name || 'Unnamed contact'}
                {!s.sharingOn && <span className="ml-1 text-muted-foreground">(sharing off)</span>}
              </span>
              {app && (
                <label className="flex shrink-0 items-center gap-1 text-muted-foreground">
                  <Switch
                    checked={s.canWrite}
                    onCheckedChange={(v) => void writeSwitch(s, v)}
                    aria-label={`Can write for ${s.name}`}
                  />
                  Can write
                </label>
              )}
              <Button
                size="icon-sm"
                variant="ghost"
                className="shrink-0"
                onClick={() => void copy(s)}
                aria-label={`Copy the link for ${s.name}`}
              >
                {copiedId === s.shareId ? <Check /> : <Copy />}
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                className="shrink-0 text-muted-foreground hover:text-destructive-ink"
                onClick={() => onRemove(s)}
                aria-label={`Remove ${s.name}`}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {warnOpenLink && !givingCanWrite && <OpenLinkDataWarning />}

      {adding && (
        <div className="space-y-2 rounded-md border border-border p-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search contacts…"
            aria-label="Search contacts"
            autoFocus
          />
          <ul
            className="-mx-1 max-h-48 space-y-0.5 overflow-y-auto px-1 scrollbar-thin"
            aria-label="Contacts"
          >
            {contacts.isPending ? (
              <li className="flex items-center gap-1 px-1 py-2 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" aria-hidden /> Loading…
              </li>
            ) : (contacts.data?.contacts ?? []).length === 0 ? (
              <li className="px-1 py-2 text-xs text-muted-foreground">No contacts match.</li>
            ) : (
              (contacts.data?.contacts ?? []).map((c) => {
                const blocked = pickBlocked(c, shared);
                const id = `share-pick-${c.id}`;
                return (
                  <li key={c.id} className={blocked ? 'opacity-60' : undefined}>
                    <div className="flex items-start gap-2 rounded px-1 py-1.5 hover:bg-muted">
                      <Checkbox
                        id={id}
                        className="mt-0.5"
                        checked={blocked === 'already-shared' || picked.has(c.id)}
                        disabled={!!blocked || busy}
                        onCheckedChange={() => toggle(c.id)}
                      />
                      <label htmlFor={id} className="min-w-0 flex-1 text-xs">
                        <span className="block truncate font-medium">
                          {c.title || 'Unnamed contact'}
                        </span>
                        {c.email && (
                          <span className="block truncate text-muted-foreground">{c.email}</span>
                        )}
                        {blocked === 'sharing-off' && (
                          <span className="block text-muted-foreground">
                            {SHARING_OFF_HINT}{' '}
                            <Link href={contactHref(c.id)} className="underline underline-offset-2">
                              Open contact
                            </Link>
                          </span>
                        )}
                        {blocked === 'already-shared' && (
                          <span className="block text-muted-foreground">Already shared.</span>
                        )}
                      </label>
                    </div>
                  </li>
                );
              })
            )}
          </ul>
          {app && (
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={canWrite} onCheckedChange={setCanWrite} aria-label="Can write" />
              Can write (the contact may change the app&apos;s data)
            </label>
          )}
          {warnOpenLink && givingCanWrite && <OpenLinkDataWarning />}
          <div className="flex items-center justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setAdding(false);
                setPicked(new Set());
                setQuery('');
              }}
            >
              Cancel
            </Button>
            <Button size="sm" disabled={busy || picked.size === 0} onClick={() => void add()}>
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              {picked.size > 1 ? `Add ${picked.size}` : 'Add'}
            </Button>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Each contact gets their own link and opens it with their code. Send the link and the code
        apart. The item keeps its workspaces.
      </p>
    </div>
  );
}
