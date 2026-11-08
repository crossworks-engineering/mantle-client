/**
 * The talking face's frames (Project Bubble Chat, plan section 8): the mouth
 * only, from the brain's own avatar style, so the face stays the same person.
 * Pure; pinned by mouths.test.ts.
 */

/** Mouths that do not read as talking, in the styles that have them. */
const ODD =
  /sad|frown|vomit|sick|drip|mask|angry|pissed|grimace|concern|disbelief|unimpressed|pacifier|eating|scream|tongue|blep|pout|kiss/i;

/** The frames a talk swaps between, besides the person's own mouth. */
export const TALK_FRAMES = 3;
/** One frame for this long, about 6 a second. */
export const TALK_FRAME_MS = 160;
/** A new card's face talks this long (R1). */
export const TALK_MS = 3000;

function familyOf(name: string): string {
  return name.replace(/\d+$/, '');
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Up to TALK_FRAMES mouths to swap in, for a face drawn from `seed` with its
 * own `mouth` (a pinned part, if any). From the own mouth's family where it has
 * one ("happy" in lorelei), else the "happy" family, else every mouth that is
 * not odd. Spread over the family, and different for each seed. Empty for a
 * style with fewer than two mouths: that face bounces only.
 */
export function mouthFrames(
  variants: readonly string[] | undefined,
  seed: string,
  own?: string | null,
): string[] {
  if (!variants || variants.length < 2) return [];
  const fine = variants.filter((v) => !ODD.test(v) && v !== own);
  const family = (f: string) => (f ? fine.filter((v) => familyOf(v) === f) : []);
  const own3 = own ? family(familyOf(own)) : [];
  const happy = family('happy');
  const pool = own3.length >= 2 ? own3 : happy.length >= 2 ? happy : fine;
  if (pool.length === 0) return [];
  const n = Math.min(TALK_FRAMES, pool.length);
  const start = hash(seed) % pool.length;
  const step = Math.max(1, Math.floor(pool.length / n));
  const out: string[] = [];
  for (let i = 0; out.length < n && i < pool.length; i++) {
    const v = pool[(start + i * step) % pool.length]!;
    if (!out.includes(v)) out.push(v);
  }
  return out;
}
