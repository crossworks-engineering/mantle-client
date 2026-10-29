/**
 * The one way the app makes a sound: `play(kind)`. Synthesised with the Web
 * Audio API from the recipes (lib/sounds/recipes.ts), nothing to download.
 *
 * - One AudioContext per tab, made on first use and kept: every note goes
 *   through one bus (a gentle low-pass, a short soft echo, a compressor so
 *   overlapping sounds never clip).
 * - The autoplay rule: a context made before the page had a click or a key
 *   press stays suspended. `installSoundUnlock` (mounted by the app shell)
 *   makes or resumes it on the first gesture. A sound asked for while it is
 *   still suspended is dropped, not queued: a chime for a message that came
 *   a minute ago, played on the next click, would only confuse.
 * - The preference (lib/sounds/prefs.ts): off silences everything, the ring
 *   included; `force` (the preview buttons, a click of their own) plays
 *   anyway.
 * - The same sound twice within MIN_GAP_MS plays once: a burst of chat lines
 *   is one chime.
 *
 * Best effort throughout: no audio is never an error.
 */
import { getSoundPrefs } from './prefs';
import { SOUND_RECIPES, type Note, type SoundKind } from './recipes';

export type { SoundKind } from './recipes';

const MIN_GAP_MS = 120;

type Graph = { ctx: AudioContext; input: AudioNode };
let graph: Graph | null = null;
const lastPlayed = new Map<SoundKind, number>();

function makeGraph(): Graph | null {
  if (graph) return graph;
  if (typeof window === 'undefined') return null;
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  try {
    const ctx = new Ctx();
    const input = ctx.createGain();
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 7000;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    input.connect(tone).connect(comp).connect(ctx.destination);
    // The room: one soft, darker echo that fades in a few repeats.
    const delay = ctx.createDelay(0.5);
    delay.delayTime.value = 0.11;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.25;
    const darken = ctx.createBiquadFilter();
    darken.type = 'lowpass';
    darken.frequency.value = 2800;
    const wet = ctx.createGain();
    wet.gain.value = 0.16;
    input.connect(delay);
    delay.connect(darken).connect(feedback).connect(delay);
    darken.connect(wet).connect(comp);
    graph = { ctx, input };
    return graph;
  } catch {
    return null;
  }
}

function voice(g: Graph, n: Note, t0: number, volume: number): void {
  const { ctx, input } = g;
  const at = t0 + n.at;
  const peak = Math.max(0.0002, n.gain * volume);
  const one = (hz: number, level: number, dur: number, glideTo?: number) => {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = n.wave ?? 'sine';
    osc.frequency.setValueAtTime(hz, at);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, at + dur / 3);
    env.gain.setValueAtTime(0.0001, at);
    env.gain.linearRampToValueAtTime(level, at + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(env).connect(input);
    osc.start(at);
    osc.stop(at + dur + 0.02);
    osc.onended = () => {
      osc.disconnect();
      env.disconnect();
    };
  };
  one(n.hz, peak, n.dur, n.glideTo);
  if (n.bell) one(n.hz * 3, peak * 0.18, n.dur * 0.5, n.glideTo ? n.glideTo * 3 : undefined);
}

function schedule(g: Graph, kind: SoundKind, volume: number): void {
  const t0 = g.ctx.currentTime + 0.01;
  for (const n of SOUND_RECIPES[kind]) voice(g, n, t0, volume);
}

/** Play one sound of the palette. `force` plays it with sounds switched
 *  off (a preview the user clicked); `volume` overrides the preference's. */
export function play(kind: SoundKind, opts: { force?: boolean; volume?: number } = {}): void {
  try {
    const prefs = getSoundPrefs();
    if (!opts.force && !prefs.enabled) return;
    const volume = opts.volume ?? prefs.volume;
    if (volume <= 0) return;
    const now = Date.now();
    if (!opts.force && now - (lastPlayed.get(kind) ?? 0) < MIN_GAP_MS) return;
    lastPlayed.set(kind, now);
    const g = makeGraph();
    if (!g) return;
    if (g.ctx.state === 'running') {
      schedule(g, kind, volume);
      return;
    }
    // A forced play comes from a click, which is allowed to resume the
    // context; anything else waits for a gesture and is dropped meanwhile.
    const resumed = g.ctx.resume();
    if (opts.force) {
      void resumed.then(() => schedule(g, kind, volume)).catch(() => {});
    } else {
      void resumed.catch(() => {});
    }
  } catch {
    /* no audio here */
  }
}

/** Whether a sound asked for now would be heard (the context is running and
 *  sounds are on): the settings screen says so when it is not. */
export function soundsReady(): boolean {
  return getSoundPrefs().enabled && graph?.ctx.state === 'running';
}

/**
 * Make or resume the context on the page's first click or key press, so a
 * sound that arrives later can play. Returns the cleanup. Safe to call more
 * than once (each call its own listeners).
 */
export function installSoundUnlock(): () => void {
  if (typeof window === 'undefined') return () => {};
  const opts = { capture: true, passive: true } as const;
  const unlock = () => {
    if (!getSoundPrefs().enabled) return;
    const g = makeGraph();
    if (!g) return;
    if (g.ctx.state === 'running') return done();
    void g.ctx
      .resume()
      .then(() => {
        if (g.ctx.state === 'running') done();
      })
      .catch(() => {});
  };
  const done = () => {
    window.removeEventListener('pointerdown', unlock, opts);
    window.removeEventListener('keydown', unlock, opts);
  };
  window.addEventListener('pointerdown', unlock, opts);
  window.addEventListener('keydown', unlock, opts);
  return done;
}
