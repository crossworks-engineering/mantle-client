import { SetPageTitle } from '@/components/layout/page-title';
import { BoxesClient } from './boxes-client';

/** Control Center > Linked boxes: each box this Control Center manages, and
 *  the way to link one more. Data-free: the client reads GET /api/fleet. */
export default function BoxesPage() {
  return (
    <>
      <SetPageTitle title="Linked boxes" />
      <BoxesClient />
    </>
  );
}
