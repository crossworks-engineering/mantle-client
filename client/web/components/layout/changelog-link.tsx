'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Megaphone } from 'lucide-react';
import { cn } from '@mantle/web-ui/lib/utils';
import { Badge } from '@mantle/web-ui/ui/badge';
import {
  APP_VERSION,
  CHANGELOG_LAST_SEEN_VERSION_KEY,
  CHANGELOG_SEEN_EVENT,
  VERSION_LABEL,
  versionDetail,
} from '@mantle/web-ui/version';
import { useServerVersion } from '@/lib/server-version';
import { hasArea } from '@/lib/workspaces';
import { useViewerAreas } from '@/components/workspaces/use-shell-workspaces';
import { MantleBadge } from './rail/mantle-mark';

/**
 * Build identity at the foot of the rail's nav, both halves of the install:
 *
 *   - MantleOS Desktop, this build → /changelog, with a "What's new?" pill until the
 *     changelog has been viewed (localStorage last-seen vs APP_VERSION; the
 *     /changelog page stamps it and fires CHANGELOG_SEEN_EVENT so the pill
 *     clears without a remount).
 *   - The brain this interface talks to, read over the wire from
 *     `GET /api/version` (the same cached query as the dashboard's
 *     <BuildCard>). Plain text: the changelog is the client's, so this line
 *     does not link to it.
 *
 * Each line names its half. That is the fix for the old footer, which put a
 * "mantle" wordmark beside APP_VERSION, the CLIENT's version (next.config
 * stamps the client's own package.json), and so read "mantle vX" for a
 * version the brain never had. Since the one-brand MantleOS rename
 * (2026-10-17) the icon marks the first line only: the same mark twice would
 * say nothing.
 *
 * In the collapsed icon rail both lines give way to the megaphone, and the
 * pill becomes the same dot the nav badges use.
 *
 * /changelog reads the brain's changelog (GET /api/changelog), which the
 * brain answers for an admin only: a login without the settings area (a
 * member, a client) gets the build line as plain text, with no link and
 * no "What's new?" pill (lib/workspaces.ts PATH_AREAS keeps the screen the
 * settings area's).
 */
export function ChangelogLink({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  const { label: mantleVersion } = useServerVersion();

  useEffect(() => {
    const read = () => {
      try {
        setShowWhatsNew(
          window.localStorage.getItem(CHANGELOG_LAST_SEEN_VERSION_KEY) !== APP_VERSION,
        );
      } catch {
        // Storage blocked — default to showing the pill.
        setShowWhatsNew(true);
      }
    };
    read();
    window.addEventListener(CHANGELOG_SEEN_EVENT, read);
    window.addEventListener('storage', read);
    return () => {
      window.removeEventListener(CHANGELOG_SEEN_EVENT, read);
      window.removeEventListener('storage', read);
    };
  }, []);

  const active = pathname === '/changelog' || pathname.startsWith('/changelog/');
  const linked = hasArea(useViewerAreas(), 'settings');

  return (
    <div className="px-3 pb-3 group-data-[nav-collapsed=true]/shell:px-2">
      {linked ? (
        <Link
          href="/changelog"
          onClick={onNavigate}
          aria-current={active ? 'page' : undefined}
          // Full build identity (version · sha · date): the only place it
          // shows since the header wordmark badge was removed.
          title={`Changelog: ${versionDetail()}`}
          className={cn(
            ROW,
            active
              ? 'bg-sidebar-accent text-sidebar-accent-foreground'
              : 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground',
          )}
        >
          <BuildLine />
          {showWhatsNew && (
            <>
              <Badge className="h-5 px-2 text-[10px] group-data-[nav-collapsed=true]/shell:hidden">
                What&apos;s new?
              </Badge>
              {/* Collapsed: a dot stands in for the pill. */}
              <span
                className="absolute right-1.5 top-1.5 hidden size-2 rounded-full bg-primary ring-2 ring-sidebar group-data-[nav-collapsed=true]/shell:block"
                aria-hidden
              />
            </>
          )}
        </Link>
      ) : (
        <p title={versionDetail()} className={cn(ROW, 'text-muted-foreground')}>
          <BuildLine />
        </p>
      )}
      <p
        title="The brain this interface talks to"
        className="flex items-center gap-2 px-3 pt-1 text-xs font-medium text-muted-foreground group-data-[nav-collapsed=true]/shell:hidden"
      >
        {/* A spacer the icon's width, so both versions start in one column. */}
        <span className="size-4 shrink-0" aria-hidden />
        <span className="truncate">Brain {mantleVersion}</span>
      </p>
    </div>
  );
}

/** The build row's box, linked or not. */
const ROW = cn(
  'relative flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition-colors',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  'group-data-[nav-collapsed=true]/shell:justify-center group-data-[nav-collapsed=true]/shell:gap-0 group-data-[nav-collapsed=true]/shell:px-0',
);

/** This build: the megaphone in the icon rail, else the icon and version. */
function BuildLine() {
  return (
    <>
      <Megaphone
        className="hidden size-4 shrink-0 group-data-[nav-collapsed=true]/shell:block"
        aria-hidden
      />
      <MantleBadge
        className="size-4 shrink-0"
        visibility="group-data-[nav-collapsed=true]/shell:hidden"
      />
      <span className="flex-1 truncate text-muted-foreground group-data-[nav-collapsed=true]/shell:hidden">
        MantleOS Desktop {VERSION_LABEL}
      </span>
    </>
  );
}
