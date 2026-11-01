'use client';

import Link from 'next/link';
import { SetPageTitle } from '@/components/layout/page-title';
import { EditAccountClient } from './edit-account-client';
import { useRouteParams } from '@/lib/route-params';

/** Edit an existing IMAP account: connection knobs, history window, and an
 *  optional password rotation. Data-free — EditAccountClient fetches the
 *  account from GET /api/email/accounts/[id] and seeds the shared ImapForm. */
export default function EditAccountPage() {
  const { id = '' } = useRouteParams<{ id?: string }>('/settings/accounts/[id]/edit');

  return (
    <div className="mx-auto max-w-md space-y-6 px-6 py-8">
      <SetPageTitle title="Edit account" />
      <EditAccountClient id={id} />
      <p className="text-xs text-muted-foreground">
        <Link href="/settings/accounts" className="underline">
          ← Back to accounts
        </Link>
      </p>
    </div>
  );
}
