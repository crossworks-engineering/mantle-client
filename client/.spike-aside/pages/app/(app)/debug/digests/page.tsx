import { SetPageTitle } from '@/components/layout/page-title';
import { DigestsClient } from './digests-client';

/** Debug → Digests. Data-free: DigestsClient fetches GET /api/debug/digests. */
export default async function DebugDigestsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const query = sp.q?.trim() || '';

  return (
    <div className="space-y-4 px-6 py-8">
      <SetPageTitle title="Digests" />
      <DigestsClient page={page} query={query} />
    </div>
  );
}
