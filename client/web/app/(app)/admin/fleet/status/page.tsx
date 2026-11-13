import { SetPageTitle } from '@/components/layout/page-title';
import { FleetStatusClient } from './status-client';

/** Control Center > Fleet status: the Status screen of each linked box and
 *  of this box. Data-free: the client reads GET /api/fleet, then each box's
 *  box_status over POST /api/fleet/tool and this box's GET /api/box-status. */
export default function FleetStatusPage() {
  return (
    <>
      <SetPageTitle title="Fleet status" />
      <FleetStatusClient />
    </>
  );
}
