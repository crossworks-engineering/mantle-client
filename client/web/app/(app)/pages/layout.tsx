import { Suspense, type ReactNode } from 'react';
import { RestoreLastOpened } from '@/components/last-opened/last-opened';
import { SetPageTitle } from '@/components/layout/page-title';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { PagesClient } from './pages-client';

/**
 * /pages and /pages/[id] — ONE screen (item header contract, phase 5,
 * 2026-10-21): the folder tree and the detail pane stay mounted while a page
 * is read (`/pages`) or edited (`/pages/<id>`), so editing never takes the
 * folders away. `PagesClient` reads the route itself; the two page files
 * render nothing. The list/tree, tag facets and pagination are client-fetched
 * via `GET /api/pages`, keyed off the URL params (`q`/`tag`/`sort`/`page`)
 * that `PagesClient` reads with useSearchParams, hence the Suspense boundary.
 */
export default function PagesLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SetPageTitle title="Pages" />
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        }
      >
        <RestoreLastOpened section="pages">
          <PagesClient />
        </RestoreLastOpened>
      </Suspense>
      {children}
    </>
  );
}
