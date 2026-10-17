'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@mantle/web-ui/ui/card';
import { APP_VERSION, CONTRACT_VERSION, GIT_SHA } from '@mantle/web-ui/version';
import { Brain, Monitor } from 'lucide-react';
import { MantleBadge } from '@/components/layout/rail/mantle-mark';
import { useServerVersion } from '@/lib/server-version';

/**
 * What this install is actually running, both halves of it.
 *
 * Since the repo split the interface and the brain ship from separate repos on
 * separate version streams, so ONE version number can no longer describe the
 * install. This card names each: MantleOS Desktop is the build the browser is
 * running (compiled in, `APP_VERSION`), the brain is whatever answers
 * `GET /api/version` right now. Reading them side by side is the only place a
 * mismatched pair is visible today, which is why the pairing lives on the
 * dashboard rather than buried in /debug.
 *
 * The wire contract is the compatibility number that actually matters (see
 * `CONTRACT_VERSION`): the versions above it can drift freely as long as this
 * agrees. Split-plan P3 turns a disagreement here into a banner; until then
 * this card is the manual check.
 */

export function BuildCard() {
  // Loading, unreachable and loaded are all resolved in the shared hook; the
  // rail's version footer reads the same query.
  const { data: server, label: serverVersion } = useServerVersion();

  // Only flag a real disagreement: absent while loading, or on an older brain
  // that predates the field, is not a mismatch.
  const contractMismatch =
    typeof server?.contractVersion === 'number' && server.contractVersion !== CONTRACT_VERSION;

  return (
    <Card className="@container h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-base">
          <MantleBadge className="size-4" /> Build
        </CardTitle>
        <CardDescription>The interface and the brain it is talking to</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Row
            icon={<Monitor className="size-4 text-muted-foreground" aria-hidden />}
            name="MantleOS Desktop"
            role="interface"
            version={`v${APP_VERSION}`}
          />
          <Row
            icon={<Brain className="size-4 text-muted-foreground" aria-hidden />}
            name="MantleOS"
            role="brain"
            version={serverVersion}
          />
        </div>
        <div className="border-t pt-3 text-xs text-muted-foreground">
          {contractMismatch ? (
            <span className="font-medium text-warning-ink">
              Wire contract mismatch: this interface speaks v{CONTRACT_VERSION}, the brain speaks v
              {server?.contractVersion}. Update whichever is older.
            </span>
          ) : (
            <>
              Wire contract v{CONTRACT_VERSION}
              {GIT_SHA ? ` · ${GIT_SHA}` : ''}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Row({
  icon,
  name,
  role,
  version,
}: {
  icon: React.ReactNode;
  name: string;
  role: string;
  version: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="hidden size-8 shrink-0 place-items-center rounded-md border bg-muted/40 @2xs:grid">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{name}</span>
        <span className="block truncate text-xs text-muted-foreground">{role}</span>
      </span>
      <span className="shrink-0 font-mono text-sm tabular-nums">{version}</span>
    </div>
  );
}
