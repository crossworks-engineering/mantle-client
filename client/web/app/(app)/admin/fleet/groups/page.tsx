import { SetPageTitle } from '@/components/layout/page-title';
import { GroupsClient } from './groups-client';

/** Control Center > Worker groups: a worker group made or updated on the boxes picked. Data-free: the client reads the brain. */
export default function GroupsPage() {
  return (
    <>
      <SetPageTitle title="Worker groups" />
      <GroupsClient />
    </>
  );
}
