import { SetPageTitle } from '@/components/layout/page-title';
import { BansClient } from './bans-client';

/** Control Center > Bans: a person disabled on every linked box at once. Data-free: the client reads the brain. */
export default function BansPage() {
  return (
    <>
      <SetPageTitle title="Bans" />
      <BansClient />
    </>
  );
}
