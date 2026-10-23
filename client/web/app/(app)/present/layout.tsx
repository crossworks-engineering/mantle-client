import { Suspense, type ReactNode } from 'react';
import { RestoreLastOpened } from '@/components/last-opened/last-opened';
import { SetPageTitle } from '@/components/layout/page-title';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { PresentClient } from './present-client';

/**
 * /present and /present/[id]: ONE screen (item header contract): the folders
 * and the live canvas stay mounted while a canvas is looked at
 * (`/present/<id>`). `PresentClient` reads the route itself; the page files
 * render nothing. Canvases are agent-written (Present v1 is agent driven):
 * there is no editor and no `?edit=1`.
 */
export default function PresentLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SetPageTitle title="Present" />
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        }
      >
        <RestoreLastOpened section="present">
          <PresentClient />
        </RestoreLastOpened>
      </Suspense>
      {children}
    </>
  );
}
