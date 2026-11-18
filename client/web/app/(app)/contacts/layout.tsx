import { Suspense, type ReactNode } from 'react';
import { SetPageTitle } from '@/components/layout/page-title';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { SyncGate } from '@/components/sync/sync-gate';
import { ContactsClient } from './contacts-client';

/**
 * /contacts and /contacts/[id] — ONE screen (item header contract, phase 5,
 * 2026-10-21): the folders and the contact's form stay mounted while a
 * contact is open at its own address (`/contacts/<id>`). `ContactsClient`
 * reads the route itself; the page files render nothing. Closed while the
 * Sync service is off (lib/sync.ts).
 */
export default function ContactsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SetPageTitle title="Contacts" />
      <SyncGate>
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <Spinner />
            </div>
          }
        >
          <ContactsClient />
        </Suspense>
        {children}
      </SyncGate>
    </>
  );
}
