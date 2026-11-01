'use client';

import { SetPageTitle } from '@/components/layout/page-title';
import { TelegramClient } from './telegram-client';
import { WithSearchParams } from '@/lib/search-params';

type Query = { page?: string; q?: string };

/** Debug → Telegram chats. Data-free: TelegramClient fetches GET /api/debug/telegram. */
function DebugTelegramPageView({ sp }: { sp: Query }) {
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const query = sp.q?.trim() || '';

  return (
    <div className="space-y-4 px-6 py-8">
      <SetPageTitle title="Telegram" />
      <TelegramClient page={page} query={query} />
    </div>
  );
}

export default function DebugTelegramPage() {
  return <WithSearchParams render={(sp) => <DebugTelegramPageView sp={sp as Query} />} />;
}
