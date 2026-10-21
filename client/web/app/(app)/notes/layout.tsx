import { Suspense, type ReactNode } from 'react';
import { RestoreLastOpened } from '@/components/last-opened/last-opened';
import { SetPageTitle } from '@/components/layout/page-title';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { NotesClient } from './notes-client';

/**
 * /notes and /notes/[id] — ONE screen (item header contract, phase 5,
 * 2026-10-21): the folders and the detail pane stay mounted while a note is
 * read (`/notes/<id>`) or edited (`/notes/<id>?edit=1`). `NotesClient` reads
 * the route itself; the page files render nothing.
 */
export default function NotesLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SetPageTitle title="Notes" />
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        }
      >
        <RestoreLastOpened section="notes">
          <NotesClient />
        </RestoreLastOpened>
      </Suspense>
      {children}
    </>
  );
}
