import { SetPageTitle } from '@/components/layout/page-title';
import { BroadcastClient } from './broadcast-client';

/** Control Center > Broadcast: one message to every person on the boxes picked, in each box's Announcements chat. Data-free: the client reads the brain. */
export default function BroadcastPage() {
  return (
    <>
      <SetPageTitle title="Broadcast" />
      <BroadcastClient />
    </>
  );
}
