/** The sound palette's shape and the preference's parse. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SOUND_PREFS, parseSoundPrefs } from './prefs';
import { SOUND_CATALOG, SOUND_RECIPES, soundLength, type SoundKind } from './recipes';

const KINDS = Object.keys(SOUND_RECIPES) as SoundKind[];
/** The two that may run long: they are meant to be noticed. */
const LONG: SoundKind[] = ['attention', 'ring', 'ringback'];

describe('sound recipes', () => {
  it('keeps every short sound under 400 ms', () => {
    for (const k of KINDS.filter((k) => !LONG.includes(k))) {
      expect(soundLength(k), k).toBeLessThanOrEqual(0.4);
    }
  });

  it('keeps the long ones under a second', () => {
    for (const k of LONG) expect(soundLength(k), k).toBeLessThanOrEqual(1);
  });

  it('stays soft: no note above 0.2 before the volume', () => {
    for (const k of KINDS) {
      for (const n of SOUND_RECIPES[k]) expect(n.gain, k).toBeLessThanOrEqual(0.2);
    }
  });

  it('lists every sound once in the catalog', () => {
    expect(SOUND_CATALOG.map((c) => c.kind).sort()).toEqual([...KINDS].sort());
  });
});

describe('parseSoundPrefs', () => {
  it('falls back to the default for nothing or garbage', () => {
    expect(parseSoundPrefs(null)).toEqual(DEFAULT_SOUND_PREFS);
    expect(parseSoundPrefs('not json')).toEqual(DEFAULT_SOUND_PREFS);
    expect(parseSoundPrefs('null')).toEqual(DEFAULT_SOUND_PREFS);
  });

  it('keeps a stored choice and clamps the volume', () => {
    expect(parseSoundPrefs('{"enabled":false,"volume":0.3}')).toEqual({
      enabled: false,
      volume: 0.3,
    });
    expect(parseSoundPrefs('{"enabled":true,"volume":4}').volume).toBe(1);
    expect(parseSoundPrefs('{"volume":-1}')).toEqual({ enabled: true, volume: 0 });
  });
});
