'use client';

import type { ActionCategory } from '@mantle/web-ui/journey-format';
import { SetPageTitle } from '@/components/layout/page-title';
import { ActiveNow } from '@/components/journey/active-now';
import { JourneyClient } from './journey-client';
import { WithSearchParams } from '@/lib/search-params';

type Query = { cat?: string; done?: string };

/**
 * Journey view — Activity → Reaction. A feed of actions each linking to the
 * reaction story. Data-free: the page parses the cat/done URL state; the
 * always-on ActiveNow header self-polls /api/activity, and JourneyClient
 * fetches the feed from GET /api/debug/journey.
 */
function JourneyPageView({ sp }: { sp: Query }) {
  const { cat, done } = sp;
  const category = (['content', 'dialog', 'automation'] as const).find((c) => c === cat) as
    ActionCategory | undefined;
  const processedOnly = done === '1';

  return (
    <div className="space-y-6 px-6 py-8">
      <SetPageTitle title="Journey" />
      <ActiveNow />
      <JourneyClient category={category} processedOnly={processedOnly} />
    </div>
  );
}

export default function JourneyPage() {
  return <WithSearchParams render={(sp) => <JourneyPageView sp={sp as Query} />} />;
}
