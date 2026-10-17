import { DRIFT_STYLES, type DriftOptions, type DriftStyle } from './options';
import {
  driftPaletteFromTheme,
  type DriftPaletteSource,
  type DriftThemeTokens,
  type DriftTone,
} from './theme';

/**
 * The stored form of a Drift background — what a brain saves and a share
 * page reads. Version 2 of the Neat spec: v1 (`{v:1, seed, tone, speed}`)
 * still decodes, upgraded to the silk style, which is the closest look.
 *
 * Kept compact (short keys, fixed order) so the canonical encoding of the
 * largest valid spec stays well under the 200-char storage cap, and equal
 * specs compare equal as strings.
 */

export type DriftSpec = {
  v: 2;
  seed: number;
  tone: DriftTone;
  /** 0 (still) to {@link DRIFT_SPEED_MAX} — same range as the Neat spec. */
  speed: number;
  style: DriftStyle;
  pal: DriftPaletteSource;
  /** How far the colours stray from the page surface, 0–1. */
  str: number;
  scale: number;
  warp: number;
  soft: number;
  light: number;
  grain: number;
  angle: number;
};

export const DRIFT_SPEED_MAX = 6;
export const DRIFT_SPEC_MAX = 200;

export const DRIFT_SPEC_DEFAULTS: Omit<DriftSpec, 'seed'> = {
  v: 2,
  tone: 'auto',
  speed: 2,
  style: 'mesh',
  pal: 'brand',
  str: 0.55,
  scale: 1,
  warp: 0.5,
  soft: 0.6,
  light: 0.5,
  grain: 0.12,
  angle: 0,
};

const TONES: readonly DriftTone[] = ['auto', 'darker', 'lighter'];
const PALETTES: readonly DriftPaletteSource[] = ['brand', 'chart'];

const round2 = (n: number) => Math.round(n * 100) / 100;

const num = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? round2(Math.min(hi, Math.max(lo, v))) : fallback;

/** Canonical wire encoding — fixed key order, rounded numbers. */
export function encodeDriftSpec(spec: DriftSpec): string {
  const s = normalize(spec);
  return JSON.stringify({
    v: 2,
    seed: s.seed,
    tone: s.tone,
    speed: s.speed,
    style: s.style,
    pal: s.pal,
    str: s.str,
    scale: s.scale,
    warp: s.warp,
    soft: s.soft,
    light: s.light,
    grain: s.grain,
    angle: s.angle,
  });
}

function normalize(o: Partial<DriftSpec> & { seed: number }): DriftSpec {
  const d = DRIFT_SPEC_DEFAULTS;
  return {
    v: 2,
    seed: o.seed >>> 0,
    tone: TONES.includes(o.tone as DriftTone) ? (o.tone as DriftTone) : d.tone,
    speed: num(o.speed, 0, DRIFT_SPEED_MAX, d.speed),
    style: DRIFT_STYLES.includes(o.style as DriftStyle) ? (o.style as DriftStyle) : d.style,
    pal: PALETTES.includes(o.pal as DriftPaletteSource) ? (o.pal as DriftPaletteSource) : d.pal,
    str: num(o.str, 0, 1, d.str),
    scale: num(o.scale, 0.25, 4, d.scale),
    warp: num(o.warp, 0, 1, d.warp),
    soft: num(o.soft, 0, 1, d.soft),
    light: num(o.light, 0, 1, d.light),
    grain: num(o.grain, 0, 1, d.grain),
    angle: Math.round(num(o.angle, -180, 180, d.angle)),
  };
}

/**
 * Parse + shape-check a stored value. Garbage ⇒ null, never a throw. Accepts
 * v2, and v1 (the Neat spec) upgraded to the silk style. Out-of-range numbers
 * clamp rather than reject: a spec saved by a newer client with a wider range
 * still paints.
 */
export function decodeDriftSpec(raw: unknown): DriftSpec | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > DRIFT_SPEC_MAX) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.seed !== 'number' || !Number.isInteger(o.seed) || o.seed < 0 || o.seed > 0xffffffff)
    return null;
  if (o.v === 1) {
    if (!TONES.includes(o.tone as DriftTone)) return null;
    if (typeof o.speed !== 'number' || !Number.isFinite(o.speed) || o.speed < 0) return null;
    return normalize({ seed: o.seed, tone: o.tone as DriftTone, speed: o.speed, style: 'silk' });
  }
  if (o.v !== 2) return null;
  return normalize(o as Partial<DriftSpec> & { seed: number });
}

export function randomDriftSpec(prev?: Partial<DriftSpec>): DriftSpec {
  return normalize({
    ...DRIFT_SPEC_DEFAULTS,
    ...prev,
    seed: Math.floor(Math.random() * 0xffffffff),
  });
}

/** Spec + live tokens + mode → engine options. Pure: the settings preview and
 *  every real surface derive the same picture from the same four inputs. */
export function driftOptionsFromSpec(
  spec: DriftSpec,
  tokens: DriftThemeTokens,
  mode: 'light' | 'dark',
): Partial<DriftOptions> {
  const palette = driftPaletteFromTheme(tokens, {
    seed: spec.seed,
    tone: spec.tone,
    mode,
    source: spec.pal,
    strength: spec.str,
  });
  return {
    style: spec.style,
    seed: spec.seed,
    background: palette.background,
    colors: palette.colors,
    // The stored range is the Neat spec's 0–6 (default 2); the engine's
    // natural pace is 1.
    speed: spec.speed / 2,
    scale: spec.scale,
    warp: spec.warp,
    softness: spec.soft,
    lighting: spec.light,
    grain: spec.grain,
    angle: spec.angle,
  };
}
