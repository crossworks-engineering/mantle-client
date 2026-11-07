'use client';

import { Check, Copy, Link2, Link2Off, Loader2 } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import { Input } from '@mantle/web-ui/ui/input';

/** The one line under the link: what an open link is (plan 8.1). */
export const OPEN_LINK_TEXT = 'Anyone with the link can open it, with no login.';

/** An open link exists, but this user may not see or stop it. */
export const HAS_LINK_TEXT = 'It has an open link. A user who may change it can see the link.';

/**
 * The open link part of the Access panel (plan 8.1, kept under the
 * workspaces). A link is a per-item open door for people with no login; it is
 * not a workspace. A user who may change the item (an app: its home
 * Moderator) makes, copies and stops it; anyone else reads only that one
 * exists. Pure: the panel loads and writes.
 */
export function AccessLinkBox({
  url,
  hasLink,
  mayLink,
  copied,
  busy = false,
  warning,
  served,
  onCopy,
  onMake,
  onStop,
}: {
  /** The link's absolute address, or null when there is none (or this user
   *  may not see it). */
  url: string | null;
  hasLink: boolean;
  mayLink: boolean;
  copied: boolean;
  busy?: boolean;
  /** Shown above "Make an open link" (an app a contact writes, L21). */
  warning?: React.ReactNode;
  /** What the link shows besides its item (contract 30), under a live link. */
  served?: React.ReactNode;
  onCopy: () => void;
  onMake: () => void;
  onStop: () => void;
}) {
  if (!mayLink && !hasLink) return null;
  return (
    // data-agent-risk: opening or stopping a public link is the user's own
    // (lib/agent-ui).
    <div className="space-y-2 border-t border-border pt-3" data-agent-risk="share">
      <p className="text-sm font-medium">Open link</p>
      {url ? (
        <>
          <div className="flex items-center gap-2">
            {/* data-secret: a link that opens the item to anyone who has
                it; an agent driving the window never reads it (lib/agent-ui). */}
            <Input
              data-secret=""
              readOnly
              value={url}
              className="h-8 text-xs"
              aria-label="Link"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button size="icon-xs" variant="outline" aria-label="Copy link" onClick={onCopy}>
              {copied ? <Check /> : <Copy />}
            </Button>
            {mayLink && (
              <Button
                size="icon-xs"
                variant="outline"
                aria-label="Stop the link"
                title="Stop the link"
                disabled={busy}
                onClick={onStop}
              >
                <Link2Off />
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{OPEN_LINK_TEXT}</p>
          {mayLink && served}
        </>
      ) : mayLink ? (
        <>
          {warning}
          <Button size="sm" variant="outline" disabled={busy} onClick={onMake}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Link2 />}
            Make an open link
          </Button>
          <p className="text-xs text-muted-foreground">{OPEN_LINK_TEXT}</p>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">{HAS_LINK_TEXT}</p>
      )}
    </div>
  );
}
