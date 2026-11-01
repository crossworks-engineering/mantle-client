import { SetPageTitle } from '@/components/layout/page-title';
import { SanityClient } from './sanity-client';

/**
 * System sanity checker. Read-only config-correctness checks for the class of
 * break that hides in env vars or in a step only scripts/up.sh performs — a
 * missing object store bucket, an unconfigured updater (MANTLE_STACK_DIR), missing
 * secrets, a cwd-relative files root, a localhost public URL, an unloaded
 * embedder model, a missing job schema. Each failure shows the fix; nothing is
 * mutated from here.
 */
export default async function SanityPage() {
  return (
    <div className="space-y-4 px-6 py-8">
      <SetPageTitle title="Sanity check" />
      <SanityClient />
    </div>
  );
}
