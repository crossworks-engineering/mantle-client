'use client';

import dynamic from 'next/dynamic';
import { Spinner } from '@mantle/web-ui/ui/spinner';

/**
 * An assistant thread in the Chats screen (Messenger V1 Phase 2, M3): an agent
 * row opens the login's own thread with that assistant, the dock's thread in
 * its embedded shape (no window controls; read while it shows). It stays in
 * assistant_messages; the messenger only lists it.
 *
 * Behind a dynamic import, the dock's shape (assistant-panel.tsx): the thread
 * pulls the page editor's extension set, which must not ride onto /chats for
 * a reader who never opens an assistant row.
 */
const AssistantThreadClient = dynamic(
  () =>
    import('@/app/(app)/assistant/assistant-thread-client').then((m) => m.AssistantThreadClient),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center">
        <Spinner />
      </div>
    ),
  },
);

export function AgentThread({ slug }: { slug: string }) {
  return (
    <div className="h-full min-h-0" data-testid="chat-agent-thread">
      <AssistantThreadClient slugHint={slug} embedded />
    </div>
  );
}
