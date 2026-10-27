import { Suspense, type ReactNode } from 'react';
import { SetPageTitle } from '@/components/layout/page-title';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { ChatsClient } from './chats-client';

/**
 * /chats and /chats/[id]: ONE screen (Messenger V1 Phase 2, the contacts
 * pattern). The list and the open chat stay mounted while a chat opens at its
 * own address (`/chats/<id>`); `ChatsClient` reads the route itself and the
 * page files render nothing.
 */
export default function ChatsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SetPageTitle title="Chats" />
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        }
      >
        <ChatsClient />
      </Suspense>
      {children}
    </>
  );
}
