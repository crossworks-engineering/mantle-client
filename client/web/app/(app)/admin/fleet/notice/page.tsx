import { SetPageTitle } from '@/components/layout/page-title';
import { NoticeClient } from './notice-client';

/** Control Center > Update notice: the update notice turned on or off on the boxes picked. Data-free: the client reads the brain. */
export default function NoticePage() {
  return (
    <>
      <SetPageTitle title="Update notice" />
      <NoticeClient />
    </>
  );
}
