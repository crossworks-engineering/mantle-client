'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowRight, Megaphone } from 'lucide-react';
import { cn } from '@mantle/web-ui/lib/utils';
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
 * Build identity at the foot of the rail's nav, one line for both halves of
 * the install:
 *
 *   [icon] v0.8.5 → v0.400.20
 *
 * The left version is this build's (APP_VERSION: next.config stamps the
 * client's own package.json); the right is the brain's, read over the wire
 * from `GET /api/version` (the same cached query as the dashboard's
 * <BuildCard>). Until the brain answers, or when it cannot be reached, the
 * line shows this build alone. The names ("MantleOS Desktop", "Brain"), the
 * build's sha and date, and the brain's state live in the hover title.
 *
 * The line links to /changelog, with a dot until the changelog has been
 * viewed (localStorage last-seen vs APP_VERSION; the /changelog page stamps
 * it and fires CHANGELOG_SEEN_EVENT so the dot clears without a remount).
 * In the collapsed icon rail the line gives way to the megaphone.
 *
 * /changelog reads the brain's changelog (GET /api/changelog), which the
 * brain answers for an admin only: a login without the settings area (a
 * member, a client) gets the line as plain text, with no link and no dot
 * (lib/workspaces.ts PATH_AREAS keeps the screen the settings area's).
 */
export function ChangelogLink({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  const { data, label: brainLabel } = useServerVersion();
  const brainVersion = data?.version ? `v${data.version}` : null;

  useEffect(() => {
    const read = () => {
      try {
        setShowWhatsNew(
          window.localStorage.getItem(CHANGELOG_LAST_SEEN_VERSION_KEY) !== APP_VERSION,
        );
      } catch {
        // Storage blocked — default to showing the dot.
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
  // The full detail the line drops, one half per line.
  const detail = `MantleOS Desktop ${versionDetail()}\nBrain ${brainLabel}`;

  return (
    <div className="px-3 pb-3 group-data-[nav-collapsed=true]/shell:px-2">
      {linked ? (
        <Link
          href="/changelog"
          onClick={onNavigate}
          aria-current={active ? 'page' : undefined}
          title={`${detail}\n${showWhatsNew ? "What's new? " : ''}Open the changelog`}
          className={cn(
            ROW,
            active
              ? 'bg-sidebar-accent text-sidebar-accent-foreground'
              : 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground',
          )}
        >
          <BuildLine brainVersion={brainVersion} />
          {showWhatsNew && (
            <>
              {/* Collapsed: the dot moves to the megaphone's corner. */}
              <span
                className="size-2 shrink-0 rounded-full bg-primary group-data-[nav-collapsed=true]/shell:absolute group-data-[nav-collapsed=true]/shell:right-1.5 group-data-[nav-collapsed=true]/shell:top-1.5 group-data-[nav-collapsed=true]/shell:ring-2 group-data-[nav-collapsed=true]/shell:ring-sidebar"
                aria-hidden
              />
              <span className="sr-only">What&apos;s new?</span>
            </>
          )}
        </Link>
      ) : (
        <p title={detail} className={cn(ROW, 'text-muted-foreground')}>
          <BuildLine brainVersion={brainVersion} />
        </p>
      )}
    </div>
  );
}

/** The line's box, linked or not. */
const ROW = cn(
  'relative flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition-colors',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  'group-data-[nav-collapsed=true]/shell:justify-center group-data-[nav-collapsed=true]/shell:gap-0 group-data-[nav-collapsed=true]/shell:px-0',
);

/** The megaphone in the icon rail, else the icon and `client → brain`. */
function BuildLine({ brainVersion }: { brainVersion: string | null }) {
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
      <span className="flex min-w-0 flex-1 items-center gap-1 whitespace-nowrap tabular-nums group-data-[nav-collapsed=true]/shell:hidden">
        <span className="truncate">{VERSION_LABEL}</span>
        {brainVersion && (
          <>
            <ArrowRight className="size-3 shrink-0 opacity-70" aria-hidden />
            <span className="sr-only">brain</span>
            <span className="truncate">{brainVersion}</span>
          </>
        )}
      </span>
    </>
  );
}
