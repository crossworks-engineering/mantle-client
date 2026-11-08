import { describe, expect, it } from 'vitest';
import { TALK_FRAMES, mouthFrames } from './mouths';

const LORELEI = [
  ...Array.from({ length: 18 }, (_, i) => `happy${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 9 }, (_, i) => `sad${String(i + 1).padStart(2, '0')}`),
];
const FUN_EMOJI = [
  'cute',
  'drip',
  'faceMask',
  'kissHeart',
  'lilSmile',
  'pissed',
  'plain',
  'sad',
  'shout',
  'shy',
  'sick',
  'smileLol',
  'smileTeeth',
  'tongueOut',
  'wideSmile',
];

describe('mouthFrames', () => {
  it('stays in the happy family of the default style', () => {
    const frames = mouthFrames(LORELEI, 'seed-a');
    expect(frames).toHaveLength(TALK_FRAMES);
    for (const f of frames) expect(f.startsWith('happy')).toBe(true);
    expect(new Set(frames).size).toBe(frames.length);
  });

  it('keeps to the own mouth family, without the own mouth', () => {
    const frames = mouthFrames(
      ['variant01', 'variant02', 'variant03', 'variant04'],
      's',
      'variant02',
    );
    expect(frames).not.toContain('variant02');
    expect(frames).toHaveLength(TALK_FRAMES);
  });

  it('leaves out the odd mouths', () => {
    const frames = mouthFrames(FUN_EMOJI, 'seed-b');
    for (const f of frames) {
      expect(['drip', 'faceMask', 'sad', 'sick', 'pissed', 'tongueOut', 'kissHeart']).not.toContain(
        f,
      );
    }
    expect(frames.length).toBeGreaterThan(0);
  });

  it('differs between seeds, the same for one seed', () => {
    expect(mouthFrames(LORELEI, 'seed-a')).toEqual(mouthFrames(LORELEI, 'seed-a'));
    const seen = new Set(['a', 'b', 'c', 'd', 'e'].map((s) => mouthFrames(LORELEI, s).join()));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('gives nothing for a style with one mouth or none', () => {
    expect(mouthFrames(undefined, 's')).toEqual([]);
    expect(mouthFrames(['default'], 's')).toEqual([]);
  });
});
