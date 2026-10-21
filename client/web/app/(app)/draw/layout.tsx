import { Suspense, type ReactNode } from 'react';
import { RestoreLastOpened } from '@/components/last-opened/last-opened';
import { SetPageTitle } from '@/components/layout/page-title';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { DrawsClient } from './draws-client';

/**
 * /draw and /draw/[id] — ONE screen (item header contract, phase 5,
 * 2026-10-21): the folders and the detail pane stay mounted while a drawing
 * is looked at (`/draw/<id>`) or edited (`/draw/<id>?edit=1`). `DrawsClient`
 * reads the route itself; the page files render nothing. The list, tag
 * facets and pagination are client-fetched via `GET /api/draws`, keyed off the
 * URL params `DrawsClient` reads with useSearchParams, hence the Suspense
 * boundary. Browsing never loads the canvas chunk; only the editor does.
 */
export default function DrawLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SetPageTitle title="Draw" />
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        }
      >
        <RestoreLastOpened section="draw">
          <DrawsClient />
        </RestoreLastOpened>
      </Suspense>
      {children}
    </>
  );
}
