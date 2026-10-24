'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@mantle/web-ui/api-fetch';
import { DriftThemeBackdrop } from '@mantle/web-ui/drift-backdrop';
import { decodeDriftSpec } from '@mantle/share-ui/drift';

/**
 * The brain's SAVED background (Drift) on a real surface (the shell's content
 * area, the team workspace; the login and invite screens pass their
 * server-loaded spec to DriftThemeBackdrop directly). Renders nothing when no
 * background is saved: the plain themed fill is the default, not an empty
 * canvas. A Neat-era v1 spec paints as silk. Always the 'app' surface: the
 * shell's own text sits right on the gradient, so the legibility floor holds.
 *
 * Reads the public /api/appearance under the same ['appearance'] query key the
 * Appearance generator card patches on save, so saving or removing a
 * background repaints the shell immediately, no reload and no invalidation
 * race against the route's 30s public cache.
 *
 * `shared` marks the surface as one the owner shares OUT (the team workspace;
 * the /s reader applies the same flag server-side): those additionally honour
 * the `shareNeat` switch, so an owner can keep the app decorated while shared
 * surfaces stay on the plain, printable fill.
 */
export function DriftSurface({
  className,
  shared = false,
}: {
  className?: string;
  shared?: boolean;
}) {
  const appearance = useQuery({
    queryKey: ['appearance'],
    queryFn: () =>
      apiFetch<{ neatBackground?: string | null; shareNeat?: boolean }>('/api/appearance'),
  });
  if (shared && appearance.data?.shareNeat === false) return null;
  const spec = appearance.data ? decodeDriftSpec(appearance.data.neatBackground) : null;
  if (!spec) return null;
  return <DriftThemeBackdrop spec={spec} surface="app" className={className} />;
}
