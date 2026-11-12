import { SetPageTitle } from '@/components/layout/page-title';
import { SsoClient } from './sso-client';

/** Control Center > Fleet sign-in: each box's company sign-in (tenant ID, client ID, client secret), staged from here. Data-free: the client reads the brain. */
export default function FleetSsoPage() {
  return (
    <>
      <SetPageTitle title="Fleet sign-in" />
      <SsoClient />
    </>
  );
}
