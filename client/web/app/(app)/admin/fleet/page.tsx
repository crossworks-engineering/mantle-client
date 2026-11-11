import { SetPageTitle } from '@/components/layout/page-title';
import { OverviewClient } from './overview-client';

/**
 * Control Center > Overview: the state of the fleet at a glance and what
 * needs an admin now (docs/control-center.md in the mantle repo). Only on a
 * box with MANTLE_IS_CONTROL_CENTER=on: elsewhere GET /api/fleet answers 404
 * and the sidebar hides the CC tab. Data-free: the client reads GET
 * /api/fleet. Needs the settings area (lib/workspaces.ts areaForPath).
 */
export default function OverviewPage() {
  return (
    <>
      <SetPageTitle title="Control Center" />
      <OverviewClient />
    </>
  );
}
