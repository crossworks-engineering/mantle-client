/**
 * A soft ring for the web (plan section 5): the palette's `ring` sound
 * (lib/sounds) every few seconds, nothing to download. It follows the sound
 * preference: with sounds off the card still shows, silently. A browser
 * lets a page play only after a gesture; a tab that never had one stays
 * silent too (`play` drops a sound it cannot play yet rather than piling
 * the rings up for the first click). Best effort throughout: a failure here
 * is not a failure of the ring.
 */
import { play } from '@/lib/sounds/play';

export const RING_TONE_EVERY_MS = 2_500;

export type RingTone = { stop: () => void };

export function startRingTone(): RingTone {
  let timer: ReturnType<typeof setInterval> | null = null;
  try {
    const ring = () => play('ring');
    ring();
    timer = setInterval(ring, RING_TONE_EVERY_MS);
  } catch {
    /* no audio here */
  }
  return {
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
