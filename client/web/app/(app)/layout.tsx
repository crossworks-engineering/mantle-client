'use client';

import { useState } from 'react';
import { AppShell } from '@/components/app-shell';
import {
  ACTIVITY_W_COOKIE,
  NAV_W_COOKIE,
  clampActivityWidth,
  clampNavWidth,
} from '@/lib/nav-width';
import { UsageCard } from '@/components/usage-card';
import type { SpendRange } from '@mantle/client-types';
import { readPref } from '@mantle/web-ui/ui-prefs';

/**
 * App shell: the rail on the left (brand, account, search, nav, launchers),
 * live-activity column on the right, content in the middle running the full
 * height of the window. No header, no footer bar — see components/app-shell.
 *
 * ZERO-SECRET variant — this app cannot verify a session (no SESSION_SECRET,
 * no DB), so there is NO server-side auth or onboarding gate here. This is
 * the detached-dev branch of the old monolith layout made permanent:
 *   - auth UX     → boot.js route guard (presence flag → /login redirect)
 *   - enforcement → the server origin's 401s on every data fetch (apiFetch
 *                   bounces to /login and clears the token store)
 *   - onboarding  → AppShell's client redirect off GET /api/shell
 *   - who it is   → nobody: every login gets this one shell (phase W5c); what
 *                   it may manage is GET /api/shell's `areas`
 *   - UsageCard   → a client component fetching GET /api/metrics/usage (it
 *                   used to read the DB in-process, which is what the carve
 *                   took away)
 *
 * The values read here (ui-prefs) are pure layout UX — reading them needs no
 * secret. The UI is static now, so they are read in the browser, once, when this
 * layout first renders. That costs no flash: the shell frame (rails, usage
 * card) mounts only after GET /api/shell answers, by which time these values
 * are its first state. The spend range is one of them: the card owns the range
 * after mount, but seeding it here stops the pills flicking from 'day' to the
 * user's choice on every load.
 */

const SPEND_RANGES: SpendRange[] = ['day', 'week', 'month'];

function readSpendRange(value: string | undefined): SpendRange {
  return (SPEND_RANGES as string[]).includes(value ?? '') ? (value as SpendRange) : 'day';
}

function readLayout() {
  return {
    navCollapsed: readPref('mantle_nav_collapsed') === '1',
    // Activity defaults to collapsed — only an explicit '0' (user expanded it) opens it.
    activityCollapsed: readPref('mantle_activity_collapsed') !== '0',
    navWidth: clampNavWidth(readPref(NAV_W_COOKIE)),
    activityWidth: clampActivityWidth(readPref(ACTIVITY_W_COOKIE)),
    spendRange: readSpendRange(readPref('mantle_spend_range')),
  };
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [{ navCollapsed, activityCollapsed, navWidth, activityWidth, spendRange }] =
    useState(readLayout);
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
