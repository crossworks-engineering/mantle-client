import { SetPageTitle } from '@/components/layout/page-title';
import { PipelinesClient } from './pipelines-client';

/**
 * /settings/pipelines: data-free. PipelinesClient makes one GET
 * /api/pipelines for the list and its counts (mantle docs/pipelines.md), and
 * the open pipeline's detail writes through PATCH /api/pipelines/:id and its
 * test and re-read routes. The settings area's (lib/workspaces.ts
 * areaForPath); the brain refuses the route to any other login. Outside the
 * `(hub)` column: the screen brings its own master-detail.
 */
export default async function PipelinesPage() {
  return (
    <>
      <SetPageTitle title="Pipelines" />
      <PipelinesClient />
    </>
  );
}
