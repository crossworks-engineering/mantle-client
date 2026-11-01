import { SetPageTitle } from '@/components/layout/page-title';
import { TopicsClient } from './topics-client';

/** Debug → Topics. Data-free: TopicsClient fetches GET /api/debug/topics. */
export default async function DebugTopicsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const query = sp.q?.trim() || '';

  return (
    <div className="space-y-4 px-6 py-8">
      <SetPageTitle title="Topics" />
      <TopicsClient page={page} query={query} />
    </div>
  );
}
