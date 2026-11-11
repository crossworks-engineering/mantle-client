import { SetPageTitle } from '@/components/layout/page-title';
import { ChangesClient } from './changes-client';

/** Control Center > Fleet changes: every change sent to a box, what waits and what each box answered. Data-free: the client reads the brain. */
export default function ChangesPage() {
  return (
    <>
      <SetPageTitle title="Fleet changes" />
      <ChangesClient />
    </>
  );
}
