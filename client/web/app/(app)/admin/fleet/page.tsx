import { SetPageTitle } from '@/components/layout/page-title';
import { FleetClient } from './fleet-client';

/**
 * Admin > Fleet: the Control Center's boxes and bans
 * (docs/control-center.md in the mantle repo). Only on a box with
 * MANTLE_IS_CONTROL_CENTER=on: elsewhere GET /api/fleet answers 404 and the
 * sidebar hides the entry. Data-free: the client reads GET /api/fleet.
 * Needs the settings area (lib/workspaces.ts areaForPath).
 */
export default async function FleetPage() {
  return (
    <>
      <SetPageTitle title="Fleet" />
      <FleetClient />
    </>
  );
}
