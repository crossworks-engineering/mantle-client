import { Suspense, type ReactNode } from 'react';
import { SetPageTitle } from '@/components/layout/page-title';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { EventsClient } from './events-client';

/**
 * /events and /events/[id] — ONE screen (item header contract, phase 5,
 * 2026-10-21): the folders and the detail pane stay mounted while an event is
 * read (`/events/<id>`) or edited (`/events/<id>?edit=1`). `EventsClient`
 * reads the route itself; the page files render nothing. The old centred
 * deep-link page is gone: a link to an event opens it beside the folders.
 */
export default function EventsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SetPageTitle title="Events" />
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        }
      >
        <EventsClient />
      </Suspense>
      {children}
    </>
  );
}
