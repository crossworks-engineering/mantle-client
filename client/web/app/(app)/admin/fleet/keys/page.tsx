import { SetPageTitle } from '@/components/layout/page-title';
import { KeysClient } from './keys-client';

/** Control Center > Provider keys: one provider key set on the boxes picked. Data-free: the client reads the brain. */
export default function KeysPage() {
  return (
    <>
      <SetPageTitle title="Provider keys" />
      <KeysClient />
    </>
  );
}
