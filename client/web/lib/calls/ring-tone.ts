/**
 * A soft ring for the web (plan section 5): two short tones every few
 * seconds from the Web Audio API, nothing to download. A browser lets a
 * page play only after a gesture; a tab that never had one stays silent
 * and the card still shows. Best effort throughout: a failure here is not
 * a failure of the ring.
 */

export const RING_TONE_EVERY_MS = 2_500;

export type RingTone = { stop: () => void };

export function startRingTone(): RingTone {
  let ctx: AudioContext | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  try {
    const Ctx = window.AudioContext;
    if (!Ctx) return { stop: () => {} };
    ctx = new Ctx();
    const beep = (at: number, hz: number) => {
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = hz;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.08, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.32);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.35);
    };
    const ring = () => {
      if (!ctx) return;
      // Held by the autoplay rule: ask once more and schedule nothing (a
      // suspended clock does not move, and the tones would pile up for the
      // first click to play all at once).
      if (ctx.state !== 'running') {
        void ctx.resume().catch(() => {});
        return;
      }
      const t = ctx.currentTime + 0.01;
      beep(t, 660);
      beep(t + 0.42, 880);
    };
    ring();
    timer = setInterval(ring, RING_TONE_EVERY_MS);
  } catch {
    /* no audio here */
  }
  return {
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
      void ctx?.close().catch(() => {});
      ctx = null;
    },
  };
}
