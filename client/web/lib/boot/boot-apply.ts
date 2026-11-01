/**
 * The first-paint bootstrap of the static UI. scripts/build-boot.mjs bundles
 * this file into public/_mantle/boot.js, and the root layout loads it as a
 * BLOCKING script in <head>, right after the host's /env.js. So it runs once,
 * before the body paints and before any bundle hydrates.
 *
 * The host (desktop shell, box server) serves /env.js with the RAW public
 * appearance of its brain in `window.__MANTLE_ENV__.appearance`. This file maps it
 * with the same share-ui functions the server layout used, so the host carries
 * data only and never a copy of the theme or font tables. What it writes onto
 * <html> is exactly what the server layout used to render there; the client
 * providers read these attributes back on mount, as before.
 *
 * It runs the page-load guard first (lib/route-guard.ts, once the Next
 * middleware): a load that must go elsewhere (no session, a retired page) is
 * replaced before anything paints, and nothing else here runs.
 *
 * It also owns the tab title's brain name: the static pages carry the fallback
 * name, and Next rewrites document.title on every client navigation, so a
 * MutationObserver swaps the fallback for the brain's name each time.
 *
 * No React, no imports beyond pure share-ui helpers: it must stay small and
 * must not throw. Any failure leaves the defaults the static page already has.
 */
import {
  appearanceFontAttrs,
  appearanceFontVars,
  resolveAppearanceAttrs,
  type BrainAppearance,
} from '@mantle/web-ui/appearance';
import { brandTitle, FALLBACK_NAME, readBrandFields } from '../brand';
import { runtimeAppearance } from '@mantle/web-ui/runtime-env';
import { guardRedirect } from '../route-guard';

/** `Page · MantleOS` → `Page · <brain>`, and a bare `MantleOS` → `<brain>`. */
export function brandDocumentTitle(title: string, name: string): string {
  if (name === FALLBACK_NAME) return title;
  if (title === FALLBACK_NAME) return name;
  const suffix = ` · ${FALLBACK_NAME}`;
  return title.endsWith(suffix) ? title.slice(0, -suffix.length) + ` · ${name}` : title;
}

export function applyAppearance(doc: Document, appearance: BrainAppearance | null): void {
  const html = doc.documentElement;
  const attrs = resolveAppearanceAttrs(appearance);
  if (attrs.colorTheme) html.setAttribute('data-color-theme', attrs.colorTheme);
  else html.removeAttribute('data-color-theme');
  for (const [name, value] of Object.entries(appearanceFontAttrs(attrs))) {
    html.setAttribute(name, value);
  }
  if (attrs.avatarStyle) html.setAttribute('data-avatar-style', attrs.avatarStyle);
  if (attrs.avatarTint) html.setAttribute('data-avatar-tint', attrs.avatarTint);
  if (attrs.backgrounds) html.setAttribute('data-backgrounds', attrs.backgrounds);
  for (const [name, value] of Object.entries(appearanceFontVars(attrs))) {
    html.style.setProperty(name, value);
  }
}

export function syncBrandTitle(doc: Document, appearance: BrainAppearance | null): void {
  const name = brandTitle(readBrandFields(appearance));
  if (name === FALLBACK_NAME) return;
  const fix = () => {
    const next = brandDocumentTitle(doc.title, name);
    if (next !== doc.title) doc.title = next;
  };
  fix();
  // Next replaces the <title> node's text, or the node itself, on navigation.
  new MutationObserver(fix).observe(doc.head, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

/** True when the load was sent elsewhere: the caller stops there. */
export function guardLoad(loc: Location, cookies: string): boolean {
  const to = guardRedirect(loc.pathname, loc.search, cookies);
  if (!to) return false;
  loc.replace(to);
  return true;
}

export function boot(doc: Document): void {
  try {
    if (guardLoad(doc.location, doc.cookie)) return;
  } catch {
    // A broken guard must not blank the page: the API's 401s still bounce.
  }
  const appearance = runtimeAppearance();
  try {
    applyAppearance(doc, appearance);
  } catch {
    // The static defaults stay; the providers still correct on mount.
  }
  try {
    syncBrandTitle(doc, appearance);
  } catch {
    // The fallback name stays in the tab.
  }
}

// Runs on load in the browser; tests import the pieces under node, with no document.
if (typeof document !== 'undefined') boot(document);
