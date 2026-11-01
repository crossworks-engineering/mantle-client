import { SetPageTitle } from '@/components/layout/page-title';
import { FactsClient } from './facts-client';

/** Debug → Facts. Data-free: FactsClient fetches GET /api/debug/facts. */
export default async function DebugFactsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const query = sp.q?.trim() || '';

  return (
    <div className="space-y-4 px-6 py-8">
      <SetPageTitle title="Facts" />
      <FactsClient page={page} query={query} />
    </div>
  );
}
