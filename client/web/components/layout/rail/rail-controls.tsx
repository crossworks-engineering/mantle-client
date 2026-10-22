'use client';

import { ProfileMenu, type ProfileIdentity } from './profile-menu';

/**
 * The old header's right-hand cluster, now down to the band under the brand
 * block: who you are, then which workspace you are in.
 *
 * It held three. Appearance went into the profile menu first — a once-a-month
 * decision should not hold a permanent row in a column that has to carry the
 * whole nav — and search has now followed it for the same reason plus a better
 * one: it was a BUTTON dressed as a text field, sitting a few pixels above the
 * nav's "Filter menu…" box, which is a real text field that does something
 * else entirely. Two controls that look alike and behave differently is worse
 * than one control in a menu, and search is the one that can afford the move
 * because it has a keyboard shortcut. The chord is still shown on the menu
 * item, so it is still discoverable.
 *
 * The workspace switcher (plan 7.1) sits under the profile row: the login
 * first, then where that login is working. It moved here from under the brand
 * name, which said where the BRAIN is rather than where YOU are.
 *
 * This band stays rather than folding into the brand block: the border below
 * it is what separates identity from navigation.
 */
export function RailControls({
  identity,
  onSearchClick,
  onNavigate,
  switcher,
}: {
  identity: ProfileIdentity;
  /** Opens the search palette. */
  onSearchClick?: () => void;
  onNavigate?: () => void;
  /** The workspace switcher, under the profile row. */
  switcher?: React.ReactNode;
}) {
  return (
    // `relative` is load-bearing, exactly as on the rail's other three bands:
    // the aside's `menu` AreaBackdrop is absolutely positioned, and a
    // statically-positioned band paints UNDER it while its siblings paint over
    // — this was the one band that missed it.
    <div className="relative flex shrink-0 flex-col gap-1.5 border-b border-sidebar-border px-3 py-2 group-data-[nav-collapsed=true]/shell:items-center group-data-[nav-collapsed=true]/shell:gap-1.5 group-data-[nav-collapsed=true]/shell:px-2">
      {/* Everything this band used to hold separately — appearance, theme,
          search — now hangs off this one control. See the note above. */}
      <ProfileMenu identity={identity} onNavigate={onNavigate} onSearchClick={onSearchClick} />
      {switcher}
    </div>
  );
}
