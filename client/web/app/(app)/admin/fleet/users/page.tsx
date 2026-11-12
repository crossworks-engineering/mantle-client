import { SetPageTitle } from '@/components/layout/page-title';
import { UsersClient } from './users-client';

/** Control Center > Fleet users: every login on every linked box, one person per email, their workspaces box by box, bans and workspace changes. Data-free: the client reads the brain. */
export default function FleetUsersPage() {
  return (
    <>
      <SetPageTitle title="Fleet users" />
      <UsersClient />
    </>
  );
}
