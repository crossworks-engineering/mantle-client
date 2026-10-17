'use client';

import { usePathname } from 'next/navigation';
import { MeasuredPane } from '@mantle/web-ui/ui/measured-pane';

/**
 * Shared frame for the thirteen single-panel settings screens: one measured,
 * draggable column and nothing else.
 *
 * ── What this used to be ───────────────────────────────────────────────────
 * A master-detail hub — a card per screen on the left, the screen on the right,
 * and one collapsed "Settings" row standing in for all thirteen in the sidebar.
 * That is undone: every screen is its own sidebar entry again, findable by the
 * menu filter, and the card list is gone. What SURVIVES is the pane those
 * screens sat in, because the pane was the good part: a form held at a readable
 * measure, draggable when the reader wants more, remembered per screen.
 *
 * ⚠ The `(hub)` route group still earns its keep for exactly the original
 * reason, so do not flatten it away. A layout applies to everything beneath it,
 * so moving this to `settings/layout.tsx` would wrap `/settings/agents` too —
 * and those twelve collection screens bring their own master-detail. A route
 * group changes the FILE TREE and not the path: every `/settings/<name>` URL is
 * untouched.
 *
 * No `SetPageTitle` here: each page sets its own, so the title names the SCREEN.
 */

/** 672px is `max-w-2xl`, the measure a form wants. */
const DEFAULT_WIDTH = '672px';

/**
 * Screens whose content is not a form and should open wider.
 *
 * Appearance is the case that forced this: it is a GALLERY — roughly forty
 * theme swatches and thirty-four avatar styles, laid out in columns — so at a
 * form's measure it renders as a cramped two-column strip while an empty spacer
 * holds several hundred pixels of window beside it. Double the measure fits the
 * grid it was designed as. The pane is still draggable from there, and the
 * width is still remembered; this only changes where it OPENS.
 */
const WIDE_SCREENS: Record<string, string> = {
  '/settings/appearance': '1344px',
  '/settings/appearance/drift': '1344px',
};

export default function SettingsPaneLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <MeasuredPane
      // Per SCREEN, not per section. A single shared key made every screen
      // adopt whatever width was last dragged on another one — so opening
      // Appearance wide would silently widen Profile too, which reads as a bug
      // rather than as a remembered preference.
      id={`settings:${pathname}`}
      defaultSize={WIDE_SCREENS[pathname] ?? DEFAULT_WIDTH}
    >
      {children}
    </MeasuredPane>
  );
}
