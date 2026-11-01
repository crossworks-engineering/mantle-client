import { SetPageTitle } from '@/components/layout/page-title';
import { TelegramClient } from './telegram-client';

/** Debug → Telegram chats. Data-free: TelegramClient fetches GET /api/debug/telegram. */
export default async function DebugTelegramPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const query = sp.q?.trim() || '';

  return (
    <div className="space-y-4 px-6 py-8">
      <SetPageTitle title="Telegram" />
      <TelegramClient page={page} query={query} />
    </div>
  );
}
