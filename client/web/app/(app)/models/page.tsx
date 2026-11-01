'use client';

import { SetPageTitle } from '@/components/layout/page-title';
import { ModelsClient } from './models-client';
import { WithSearchParams } from '@/lib/search-params';

type Query = {
  provider?: string;
  q?: string;
  sort?: string;
  kind?: string;
  page?: string;
};

/**
 * Models — a live, provider-by-provider catalog explorer. Data-free: the page
 * only forwards the URL params (provider / q / sort / kind / page); ModelsClient
 * fetches the computed bundle (provider list + filtered/sorted/paginated rows)
 * from GET /api/models/explore via useQuery. `useListNav` keeps the params in
 * the URL.
 */
function ModelsPageView({ sp }: { sp: Query }) {
  const provider = sp.provider?.trim() || 'openrouter';
  const q = sp.q?.trim() || '';
  const sort = sp.sort?.trim() || 'name';
  const kind = sp.kind?.trim() || 'all';
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);

  return (
    <>
      <SetPageTitle title="Models" />
      <ModelsClient provider={provider} q={q} sort={sort} kind={kind} page={page} />
    </>
  );
}

export default function ModelsPage() {
  return <WithSearchParams render={(sp) => <ModelsPageView sp={sp as Query} />} />;
}
