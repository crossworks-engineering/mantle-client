import { SetPageTitle } from '@/components/layout/page-title';
import { PipelinesClient } from './pipelines-client';

/**
 * /settings/pipelines: the readers that make a file's database, with how
 * many files each one read (mantle docs/pipelines.md). Read only in phase 1:
 * PipelinesClient makes one GET /api/pipelines and writes nothing. The
 * settings area's (lib/workspaces.ts areaForPath); the brain refuses the
 * route to any other login.
 */
export default async function PipelinesPage() {
  return (
    <div className="space-y-6 px-6 py-8">
      <SetPageTitle title="Pipelines" />
      <PipelinesClient />
    </div>
  );
}
