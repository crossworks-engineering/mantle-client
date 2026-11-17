import type { ReactNode } from 'react';
import { SyncGate } from '@/components/sync/sync-gate';

/** Closed while the Sync service is off (lib/sync.ts). */
export default function SyncLayout({ children }: { children: ReactNode }) {
  return <SyncGate>{children}</SyncGate>;
}
