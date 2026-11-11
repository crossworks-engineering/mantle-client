import { SetPageTitle } from '@/components/layout/page-title';
import { PoolsClient } from './pools-client';

/** Control Center > Pool entry: a model pool entry added or updated on the boxes picked. Data-free: the client reads the brain. */
export default function PoolsPage() {
  return (
    <>
      <SetPageTitle title="Pool entry" />
      <PoolsClient />
    </>
  );
}
