import { Suspense } from 'react';
import { RoleSwitch } from '@/components/layout/shell-role';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { AppsClient } from './apps-client';

/**
 * /apps — the owner's screen is the layout (`layout.tsx`). A member's folder
 * view renders here, with the picked app as `?id=` beside the tree.
 */
export default function AppsPage() {
  return (
    <RoleSwitch
      member={
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <Spinner />
            </div>
          }
        >
          <AppsClient />
        </Suspense>
      }
    >
      {null}
    </RoleSwitch>
  );
}
