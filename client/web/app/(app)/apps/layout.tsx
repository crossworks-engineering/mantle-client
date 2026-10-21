import { Suspense, type ReactNode } from 'react';
import { SetPageTitle } from '@/components/layout/page-title';
import { RoleSwitch } from '@/components/layout/shell-role';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { AppsClient } from './apps-client';

/**
 * /apps and /apps/[id] — ONE screen for the owner (item header contract,
 * phase 5, 2026-10-21): the folders and the detail pane stay mounted while an
 * app runs (`/apps/<id>`) or is edited (`/apps/<id>?edit=1`). `AppsClient`
 * reads the route itself. A member's screens are the page files: the folder
 * view on `/apps`, the published app on `/apps/<id>` (the editor never
 * mounts for one). The tree, the search (`?q=`) and the picked app are
 * client-fetched and read with useSearchParams, hence the Suspense boundary.
 */
export default function AppsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SetPageTitle title="Apps" />
      <RoleSwitch member={children}>
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <Spinner />
            </div>
          }
        >
          <AppsClient />
        </Suspense>
      </RoleSwitch>
    </>
  );
}
