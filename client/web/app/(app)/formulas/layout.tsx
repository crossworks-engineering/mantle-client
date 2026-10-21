import { Suspense, type ReactNode } from 'react';
import { SetPageTitle } from '@/components/layout/page-title';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { FormulasClient } from './formulas-client';

/**
 * /formulas and /formulas/[id] — ONE screen (item header contract, phase 5,
 * 2026-10-21): the folders and the detail pane stay mounted while a formula
 * is read (`/formulas/<id>`) or edited (`/formulas/<id>?edit=1`).
 * `FormulasClient` reads the route itself; the page files render nothing.
 */
export default function FormulasLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SetPageTitle title="Formulas" />
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        }
      >
        <FormulasClient />
      </Suspense>
      {children}
    </>
  );
}
