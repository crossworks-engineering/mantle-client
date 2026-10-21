import { Suspense, type ReactNode } from 'react';
import { SetPageTitle } from '@/components/layout/page-title';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { RecallScreen } from './recall-screen';

/**
 * /recall and /recall/[id] — ONE screen (item header contract, phase 5,
 * 2026-10-21): the folders and the map's workbench stay mounted while a map
 * is open at its own address (`/recall/<id>`, with `view`, `card`, `q` and
 * `page` as query params). `RecallScreen` reads the route itself; the page
 * files render nothing. A map's workbench is always open for editing, so it
 * has no `?edit=1`.
 */
export default function RecallLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SetPageTitle title="Recall" />
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        }
      >
        <RecallScreen />
      </Suspense>
      {children}
    </>
  );
}
