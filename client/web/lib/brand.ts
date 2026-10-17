import type { BrainAppearance } from '@mantle/web-ui/appearance';

/**
 * The brain's own identity, read off the PUBLIC appearance payload.
 *
 * `GET /api/appearance` is public and carries the colour theme, all four fonts
 * and their sizes. The site name, the peer name and whether a logo exists used
 * to live ONLY behind `GET /api/shell`, which needs a session — and the login
 * screen runs before there is one. Mantle now serves them on the public payload
 * too (dev task `db6b72e9`, 2026-08-21), which is what lights these screens up.
 *
 * The read stays DEFENSIVE anyway, and the `unknown` cast in `readBrandFields`
 * with it. Two versions move independently here: this client pins PUBLISHED
 * `@crossworks/*` contract packages, so the widened `BrainAppearance` type only
 * arrives on the next publish; and a client can be newer than the brain it is
 * pointed at, where the fields genuinely will not come. Absence must therefore
 * stay a normal answer rather than a type error or a crash — every field reads
 * null and the screens fall back exactly as an unbranded brain does. It is a
 * version-tolerant read, not a type escape.
 *
 * The logo BYTES need nothing new: `GET /api/appearance/logo` is already public
 * and sha-addressed. What is missing is only the knowledge that one exists.
 */

/** Longest site name the settings screen accepts (`SITE_NAME_MAX` in mantle). */
export const SITE_NAME_MAX = 40;

/** The product's own name — the last fallback, never a stored value. MantleOS
 *  since the one-brand rename (2026-10-17); it was "Jackdaw" before. */
export const FALLBACK_NAME = 'MantleOS';

export type BrandFields = {
  siteName: string | null;
  peerName: string | null;
  /** Cache-busting version of the light/base logo; set ⇒ an upload exists. */
  logoVersion: string | null;
  /** The dark upload. Either variant may exist alone — a supported state. */
  logoDarkVersion: string | null;
};

/** Trimmed non-empty string, or null. Anything else (number, object, '') is
 *  treated as absent rather than coerced — a half-typed payload must not put
 *  `[object Object]` on the login screen. */
function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
}

export function readBrandFields(a: BrainAppearance | null | undefined): BrandFields {
  // One cast, here, for the reason in the file header: the pinned
  // `BrainAppearance` does not declare these, and the runtime may still send
  // them. Read through `str` so nothing unexpected reaches the DOM.
  const raw = (a ?? {}) as Record<string, unknown>;
  return {
    siteName: str(raw.siteName)?.slice(0, SITE_NAME_MAX) ?? null,
    peerName: str(raw.peerName),
    logoVersion: str(raw.logoVersion),
    logoDarkVersion: str(raw.logoDarkVersion),
  };
}

/**
 * Which rung of the ladder the login screen shows.
 *
 *  - `logo`    — an upload exists; show it (either variant counts).
 *  - `name`    — no upload, but the brain is named; set the name in the chosen
 *                logo face at the chosen size.
 *  - `product` — neither; the MantleOS wordmark, the product's own mark.
 *
 * The product mark stays the FINAL fallback rather than being replaced. It is
 * the one surface that gets the mark at full size, so overriding it is
 * deliberate and only ever when the owner has said what to put there instead.
 */
export type LoginBrand = {
  kind: 'logo' | 'name' | 'product';
  /** What to call this brain: the site name, else the product name. Used for
   *  the wordmark, the logo's alt text and the tab. */
  name: string;
  /**
   * Whether that name is the OWNER's or ours — which `kind` cannot answer on
   * its own. A brain with a logo AND a name is `kind: 'logo'`, and if only the
   * dark variant was uploaded the light theme still has to fall back to
   * something: this says whether that something is the name or the product
   * mark.
   */
  named: boolean;
  logoVersion: string | null;
  logoDarkVersion: string | null;
  peerName: string | null;
};

export function resolveLoginBrand(fields: BrandFields): LoginBrand {
  const { siteName, peerName, logoVersion, logoDarkVersion } = fields;
  return {
    kind: logoVersion || logoDarkVersion ? 'logo' : siteName ? 'name' : 'product',
    name: siteName ?? FALLBACK_NAME,
    named: Boolean(siteName),
    logoVersion,
    logoDarkVersion,
    peerName,
  };
}

/**
 * The browser tab's title: the site name, else the PEER name, else ours.
 *
 * Every tab read "Jackdaw", so several brains — or several tabs on one brain —
 * were indistinguishable without clicking through, which is the one job a tab
 * title has (dev task `b05a5f17`).
 *
 * The peer name is the middle rung because it is the one thing a brain almost
 * always has and a site name is not: naming the box is part of standing it up,
 * whereas a site name is branding somebody chooses to set. Falling straight
 * through to the product name would leave a fleet of unbranded boxes looking exactly
 * as identical as before — the whole complaint. It is also the name the login
 * screen already shows under the mark, so the tab and the screen agree.
 *
 * Distinct from `LoginBrand.name`, which is a MARK and stays the site name or
 * the product's: a peer name is an identifier for a box, not a thing to set in
 * a display face where a logo would go.
 *
 * The last fallback is kept either way — a brain that has said nothing at all
 * must not end up with a blank tab.
 */
export function brandTitle(fields: BrandFields): string {
  return fields.siteName ?? fields.peerName ?? FALLBACK_NAME;
}
