import { SetPageTitle } from '@/components/layout/page-title';
import { SyncFrame } from './sync-frame';

/**
 * /settings/sync — the Sync service's own account screens: mailboxes
 * (IMAP/SMTP) and calendar feeds (mantle docs/services.md, "Sync"). The
 * service serves them; this page only frames them (no provider code here).
 */
export default function SyncAccountsPage() {
  return (
    <div className="space-y-4 px-6 py-8">
      <SetPageTitle title="Accounts" />
      <SyncFrame />
    </div>
  );
}
