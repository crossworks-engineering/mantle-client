'use client';

import { useQuery } from '@tanstack/react-query';
import { messengerApi, messengerKeys } from '@/lib/messenger/api';
import { messengerAvailability, railCount } from '@/lib/messenger/notify';

/** The count refreshes this often under the live stream. */
const UNREAD_REFRESH_MS = 60_000;

/**
 * The rail's count and whether this brain has the messenger: GET
 * /api/messenger/unread, one query entry for the rail and the Chats button.
 * A module of its own, so the dock reads it without importing the messenger
 * shell (which imports the dock).
 */
export function useMessengerUnread(): {
  available: 'yes' | 'no' | 'unknown';
  total: number;
} {
  const q = useQuery({
    queryKey: messengerKeys.unread,
    queryFn: messengerApi.unread,
    refetchInterval: (query) =>
      messengerAvailability({ data: query.state.data, error: query.state.error }) === 'no'
        ? false
        : UNREAD_REFRESH_MS,
    retry: (n, err) => (err as { status?: number } | null)?.status !== 404 && n < 2,
  });
  return {
    available: messengerAvailability({ data: q.data, error: q.error }),
    total: railCount(q.data),
  };
}
