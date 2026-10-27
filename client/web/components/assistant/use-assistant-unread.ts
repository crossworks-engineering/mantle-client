'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiEventStream, apiFetch, apiSend } from '@mantle/web-ui/api-fetch';
import { desktopShell } from '@mantle/web-ui/desktop-shell';
import { useDocumentVisible } from '@/lib/use-document-visible';
import {
  CONVERSATIONS_PATH,
  READ_PATH,
  THREAD_STREAM_PATH,
  hasUnread,
  pingChangesUnread,
  readBody,
  unreadTotal,
  type AssistantConversation,
} from '@/lib/assistant-unread';

/** Under ['assistant'], so New chat and the other chat writes refresh it. */
export const CONVERSATIONS_KEY = ['assistant', 'conversations'] as const;

/** Slow fallback: the thread stream refreshes it on a reply. */
const CONVERSATIONS_POLL_MS = 60_000;

/** The login's own threads with their unread counts (lib/assistant-unread). */
function useConversations(enabled: boolean) {
  return useQuery({
    queryKey: CONVERSATIONS_KEY,
    queryFn: () =>
      apiFetch<{ conversations: AssistantConversation[] }>(CONVERSATIONS_PATH).then(
        (r) => r.conversations ?? [],
      ),
    enabled,
    refetchInterval: enabled ? CONVERSATIONS_POLL_MS : false,
    retry: false,
  });
}

/** The unread replies over the login's own threads (the rail badge). */
export function useAssistantUnreadCount(enabled: boolean): number {
  return unreadTotal(useConversations(enabled).data);
}

/**
 * Headless, mounted once by the shell: refresh the unread counts when the
 * login's own thread stream pings a reply. Not in the badge itself, which
 * can be mounted twice (the rail and the mobile drawer). A browser tab in the
 * background closes the stream (one held socket fewer per tab) and refreshes
 * the counts when it is shown again; the desktop window keeps it.
 */
export function AssistantUnreadSync() {
  const queryClient = useQueryClient();
  const visible = useDocumentVisible();
  const [desktop, setDesktop] = useState(false);
  useEffect(() => setDesktop(!!desktopShell()), []);
  const live = visible || desktop;
  const opened = useRef(false);
  useEffect(() => {
    if (!live) return;
    // Back from the background: a reply may have landed while it was shut.
    if (opened.current) void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY });
    opened.current = true;
    return apiEventStream(THREAD_STREAM_PATH, (data) => {
      if (pingChangesUnread(data)) {
        void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY });
      }
    });
  }, [live, queryClient]);
  return null;
}

/**
 * Mark the thread with `agentSlug` read while it is on screen (`active`) and
 * has unread replies: on open, and again when a reply lands while it shows.
 */
export function useMarkThreadRead(agentSlug: string | null | undefined, active: boolean) {
  const queryClient = useQueryClient();
  const conversations = useConversations(active).data;
  const unread = active && hasUnread(conversations, agentSlug);
  const marking = useRef(false);
  useEffect(() => {
    if (!unread || !agentSlug || marking.current) return;
    marking.current = true;
    void apiSend(READ_PATH, 'POST', readBody(agentSlug))
      .then(() => queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY }))
      .catch(() => {
        /* the badge stays; the next open tries again */
      })
      .finally(() => {
        marking.current = false;
      });
  }, [unread, agentSlug, queryClient]);
}
