import { SetPageTitle } from '@/components/layout/page-title';
import { MatrixClient } from './matrix-client';

/** Control Center > Fleet matrix: each box's version, health, spend, sign-in, agents, models and last backup, side by side and box by box. Data-free: the client reads the brain. */
export default function MatrixPage() {
  return (
    <>
      <SetPageTitle title="Fleet matrix" />
      <MatrixClient />
    </>
  );
}
