import { AppShell } from '@/components/app-shell';
import {
  ACTIVITY_W_COOKIE,
  NAV_W_COOKIE,
  clampActivityWidth,
  clampNavWidth,
} from '@/lib/nav-width';
import { UsageCard } from '@/components/usage-card';
import type { SpendRange } from '@mantle/client-types';

/**
 * App shell: the rail on the left (brand, account, search, nav, launchers),
 * live-activity column on the right, content in the middle running the full
 * height of the window. No header, no footer bar — see components/app-shell.
 *
 * ZERO-SECRET variant — this app cannot verify a session (no SESSION_SECRET,
 * no DB), so there is NO server-side auth or onboarding gate here. This is
 * the detached-dev branch of the old monolith layout made permanent:
 *   - auth UX     → client middleware (presence cookie → /login redirect)
 *   - enforcement → the server origin's 401s on every data fetch (apiFetch
 *                   bounces to /login and clears the token store)
 *   - onboarding  → AppShell's client redirect off GET /api/shell
 *   - who it is   → nobody: every login gets this one shell (phase W5c); what
 *                   it may manage is GET /api/shell's `areas`
 *   - UsageCard   → a client component fetching GET /api/metrics/usage (it
 *                   used to read the DB in-process, which is what the carve
 *                   took away)
 *
 * The cookies read here are pure request-state UX (flash-free first paint) —
 * reading them needs no secret. The spend range is one of them: the card owns
 * the range after mount, but seeding it server-side stops the pills flicking
 * from 'day' to the user's choice on every load.
 */

const SPEND_RANGES: SpendRange[] = ['day', 'week', 'month'];

function readSpendRange(value: string | undefined): SpendRange {
  return (SPEND_RANGES as string[]).includes(value ?? '') ? (value as SpendRange) : 'day';
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // SPIKE: no request cookies in a static build; defaults, read client-side later.
  const navCollapsed = false;
  const activityCollapsed = true;
  const navWidth = clampNavWidth(undefined);
  const activityWidth = clampActivityWidth(undefined);
  const spendRange = readSpendRange(undefined);
  return (
    <AppShell
      contextCard={<UsageCard initialRange={spendRange} />}
      initialNavCollapsed={navCollapsed}
      initialNavWidth={navWidth}
      initialActivityWidth={activityWidth}
      initialActivityCollapsed={activityCollapsed}
    >
      {children}
    </AppShell>
  );
}
