import { SetPageTitle } from '@/components/layout/page-title';
import { KeyStatusClient } from './key-status-client';

/** Control Center > Key status: which provider keys each box holds, when
 *  each was set, whether it works. Data-free: the client reads the brain. */
export default function KeyStatusPage() {
  return (
    <>
      <SetPageTitle title="Key status" />
      <KeyStatusClient />
    </>
  );
}
