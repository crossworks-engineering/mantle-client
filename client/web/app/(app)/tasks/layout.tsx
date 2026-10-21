import { Suspense, type ReactNode } from 'react';
import { SetPageTitle } from '@/components/layout/page-title';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { TasksClient } from './tasks-client';

/**
 * /tasks and /tasks/[id] — ONE screen (item header contract, phase 5,
 * 2026-10-21): the list (or board) and the detail pane stay mounted while a
 * task is read (`/tasks/<id>`) or edited (`/tasks/<id>?edit=1`).
 * `TasksClient` reads the route itself; the page files render nothing.
 */
export default function TasksLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SetPageTitle title="Tasks" />
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        }
      >
        <TasksClient />
      </Suspense>
      {children}
    </>
  );
}
