import { SetPageTitle } from '@/components/layout/page-title';
import { StatusClient } from '@/components/status/status-client';

/**
 * Status: the whole box at a glance, for a login with the settings area
 * (lib/workspaces.ts PATH_AREAS; first in the System menu). It replaced the
 * full-screen Dashboard and sits in the standard resizable content area:
 * the sections on the left, the board on the right. Data-free: the client
 * reads /api/health, /api/box-status, /api/services, /api/dashboard,
 * /api/updates, /api/backups and the provider alerts. The deep operator
 * view stays at /debug.
 */
export default function StatusPage() {
  return (
    <>
      <SetPageTitle title="Status" />
      <StatusClient />
    </>
  );
}
