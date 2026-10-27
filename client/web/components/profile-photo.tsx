'use client';

import { useEffect, useState } from 'react';
import { useAssetUrl } from '@mantle/web-ui/hooks/use-asset-url';
import { cn } from '@mantle/web-ui/lib/utils';

/**
 * The uploaded profile photo as a circular <img> — the ONE place that knows
 * the photo URL shape, so the rail and the settings preview cannot drift.
 *
 * Owns the precedence rule's runtime half: photo → generated → initials means
 * a photo that cannot load (storage down, removed in another session, a
 * detached client whose asset token hasn't landed for this paint) must step
 * DOWN to `fallback` — the next rung of the chain — never show the browser's
 * broken-image glyph. The failure flag resets when the version changes, so a
 * later successful upload recovers on its own.
 *
 * Kept separate from ProfilePhotoControl on purpose: the rail renders this on
 * every page, and it must not drag react-image-crop (and its stylesheet) into
 * that bundle.
 */
export function ProfilePhoto({
  path = '/api/profile/photo',
  version,
  size,
  className,
  alt = '',
  fallback = null,
}: {
  /** The photo route: mine by default; the messenger serves another
   *  login's at /api/messenger/photo/:loginId. */
  path?: string;
  /** The sha8 cache-buster from the shell (`avatarPhotoVersion`). */
  version: string;
  size: number;
  className?: string;
  alt?: string;
  /** What to render instead when the photo fails to load. */
  fallback?: React.ReactNode;
}) {
  const toAsset = useAssetUrl();
  const [failed, setFailed] = useState(false);
  // Also on `toAsset`: the first paint of a detached client resolves an
  // unsigned URL, which 401s and latches `failed`. Without this the photo
  // would stay stepped down to the fallback for the rest of the session even
  // though the token landed a moment later.
  useEffect(() => setFailed(false), [path, version, toAsset]);
  if (failed) return <>{fallback}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- private, token-authed bytes; next/image can't optimize them
    <img
      src={toAsset(`${path}?v=${encodeURIComponent(version)}`)}
      alt={alt}
      className={cn('shrink-0 rounded-full border object-cover', className)}
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}
