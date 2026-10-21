import { Suspense, type ReactNode } from 'react';
import { RestoreLastOpened } from '@/components/last-opened/last-opened';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { TablesShell } from './tables-shell';

/**
 * /tables and /tables/[id] — ONE screen (item header contract, phase 5,
 * 2026-10-21): the folders and the grid stay mounted while a table is open at
 * its own address (`/tables/<id>`). A table is always open for editing, so
 * it has one address, no `?edit=1`. `TablesShell` reads the route itself;
 * the page files render nothing. The list, tag facets and the selected
 * table's grid are client-fetched, keyed off the URL params, hence the
 * Suspense boundary.
 */
export default function TablesLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        }
      >
        <RestoreLastOpened section="tables">
          <TablesShell />
        </RestoreLastOpened>
      </Suspense>
      {children}
    </>
  );
}
