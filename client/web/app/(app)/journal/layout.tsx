import { Suspense, type ReactNode } from 'react';
import { SetPageTitle } from '@/components/layout/page-title';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { JournalClient } from './journal-client';

/**
 * /journal and /journal/[id] — ONE screen (item header contract, phase 5,
 * 2026-10-21): the list and the detail pane stay mounted while an entry is
 * read (`/journal/<id>`) or edited (`/journal/<id>?edit=1`). `JournalClient`
 * reads the route itself; the page files render nothing.
 */
export default function JournalLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SetPageTitle title="Journal" />
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        }
      >
        <JournalClient />
      </Suspense>
      {children}
    </>
  );
}
