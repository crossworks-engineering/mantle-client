import { SetPageTitle } from '@/components/layout/page-title';
import { CompanySignInClient } from './company-sign-in-client';

/**
 * Settings > Company sign-in: a client's Microsoft admin enters the client
 * secret, sealed and never shown, and makes the SCIM token, shown once, while
 * the box's MANTLE_OIDC_MODE is `setup` (docs/oidc-sign-in.md in the mantle
 * repo). The .env holds the lock. Data-free: the client reads
 * GET /api/users/sso-setup. Needs the users area (lib/workspaces.ts areaForPath).
 */
export default async function CompanySignInPage() {
  return (
    <>
      <SetPageTitle title="Company sign-in" />
      <CompanySignInClient />
    </>
  );
}
