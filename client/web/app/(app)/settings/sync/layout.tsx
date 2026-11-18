import type { ReactNode } from 'react';
import { SyncGate } from '@/components/sync/sync-gate';

/** Closed while the Sync service is off (lib/sync.ts). */
export default function SyncAccountsLayout({ children }: { children: ReactNode }) {
  return <SyncGate>{children}</SyncGate>;
}
