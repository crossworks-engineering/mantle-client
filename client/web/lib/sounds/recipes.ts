/**
 * The sound palette as data: every sound is a few soft notes drawn from one
 * scale (A major pentatonic, A5 to C#7), sine or triangle only, each with a
 * fast attack and an exponential fade. One scale, one envelope and one shared
 * room (lib/sounds/play.ts) are what make them read as one family. Pure, no
 * Web Audio here, so the lengths are pinned by recipes.test.ts.
 */

export type SoundKind =
  | 'success'
  | 'warning'
  | 'danger'
  | 'notification'
  | 'commit'
  | 'action'
  | 'attention'
  | 'message'
  | 'mention'
  | 'reply'
  | 'complete'
  | 'ring'
  | 'ringback'
  | 'join'
  | 'leave';

export type Note = {
  /** Start, seconds from the sound's start. */
  at: number;
  hz: number;
  /** Fade length, seconds: the note is silent by `at + dur`. */
  dur: number;
  /** Peak level before the volume preference, 0..1 (keep it soft: ~0.1-0.2). */
  gain: number;
  wave?: 'sine' | 'triangle';
  /** Glide to this pitch over the first third of the note. */
  glideTo?: number;
  /** Add a quiet, faster-fading partial a twelfth up: a glassy bell. */
  bell?: boolean;
};

// A major pentatonic, two octaves, plus the two notes below for the low sounds.
const C5s = 554.37;
const E5 = 659.25;
const Fs5 = 739.99;
const A5 = 880;
const B5 = 987.77;
const Cs6 = 1108.73;
const E6 = 1318.51;
const A6 = 1760;
const Cs7 = 2217.46;

export const SOUND_RECIPES: Record<SoundKind, Note[]> = {
  // A fourth up, bright and quick: it worked.
  success: [
    { at: 0, hz: E6, dur: 0.16, gain: 0.16, bell: true },
    { at: 0.07, hz: A6, dur: 0.26, gain: 0.16, bell: true },
  ],
  // The same middle note twice, triangle for a little body: look here.
  warning: [
    { at: 0, hz: Fs5, dur: 0.13, gain: 0.15, wave: 'triangle' },
    { at: 0.14, hz: Fs5, dur: 0.18, gain: 0.13, wave: 'triangle' },
  ],
  // A minor third down, low and round: it did not work.
  danger: [
    { at: 0, hz: E5, dur: 0.18, gain: 0.17, wave: 'triangle' },
    { at: 0.11, hz: C5s, dur: 0.26, gain: 0.17, wave: 'triangle' },
  ],
  // One bell.
  notification: [{ at: 0, hz: E6, dur: 0.36, gain: 0.15, bell: true }],
  // A short downward seal over a soft low body: it is kept.
  commit: [
    { at: 0, hz: A6, glideTo: Cs6, dur: 0.1, gain: 0.13 },
    { at: 0.03, hz: A5 / 2, dur: 0.11, gain: 0.12, wave: 'triangle' },
    { at: 0.07, hz: E6, dur: 0.16, gain: 0.07, bell: true },
  ],
  // The smallest tick.
  action: [{ at: 0, hz: A6, dur: 0.05, gain: 0.1 }],
  // Rising arpeggio that rests on a held bell: something wants you.
  attention: [
    { at: 0, hz: A5, dur: 0.2, gain: 0.14, bell: true },
    { at: 0.1, hz: E6, dur: 0.2, gain: 0.14, bell: true },
    { at: 0.2, hz: A6, dur: 0.5, gain: 0.16, bell: true },
  ],
  // Two quick notes up, like a bubble: a chat line arrived.
  message: [
    { at: 0, hz: B5, dur: 0.1, gain: 0.14 },
    { at: 0.06, hz: E6, dur: 0.2, gain: 0.14 },
  ],
  // Two bright bell taps high up: someone named you.
  mention: [
    { at: 0, hz: A6, dur: 0.12, gain: 0.13, bell: true },
    { at: 0.09, hz: Cs7, dur: 0.24, gain: 0.13, bell: true },
  ],
  // A soft step down that settles: the assistant has finished.
  reply: [
    { at: 0, hz: Cs6, dur: 0.16, gain: 0.12 },
    { at: 0.08, hz: A5, dur: 0.3, gain: 0.12, bell: true },
  ],
  // Four notes up the chord: a task or run is done.
  complete: [
    { at: 0, hz: A5, dur: 0.12, gain: 0.12 },
    { at: 0.045, hz: Cs6, dur: 0.12, gain: 0.12 },
    { at: 0.09, hz: E6, dur: 0.14, gain: 0.13 },
    { at: 0.135, hz: A6, dur: 0.26, gain: 0.15, bell: true },
  ],
  // One ring: two bell pairs. The caller repeats it (lib/calls/ring-tone.ts).
  ring: [
    { at: 0, hz: E6, dur: 0.18, gain: 0.14, bell: true },
    { at: 0.15, hz: A6, dur: 0.26, gain: 0.14, bell: true },
    { at: 0.5, hz: E6, dur: 0.18, gain: 0.14, bell: true },
    { at: 0.65, hz: A6, dur: 0.34, gain: 0.14, bell: true },
  ],
  // What the caller hears while it rings the other side: one low, warm dyad
  // (E5 under A5), no bell, so it can never be taken for an incoming ring.
  // The caller repeats it (components/calls/call-sounds.tsx).
  ringback: [
    { at: 0, hz: E5, dur: 0.9, gain: 0.07 },
    { at: 0, hz: A5, dur: 0.9, gain: 0.06 },
  ],
  // Up a fifth: connected.
  join: [
    { at: 0, hz: A5, dur: 0.14, gain: 0.13 },
    { at: 0.08, hz: E6, dur: 0.24, gain: 0.13 },
  ],
  // Down a fourth, lower and quieter: left or ended.
  leave: [
    { at: 0, hz: A5, dur: 0.14, gain: 0.11 },
    { at: 0.1, hz: E5, dur: 0.26, gain: 0.11 },
  ],
};

/** When the last note of a sound is silent, seconds (the room's short
 *  echo aside). */
export function soundLength(kind: SoundKind): number {
  return Math.max(...SOUND_RECIPES[kind].map((n) => n.at + n.dur));
}

/** The palette, in the order the settings list shows it, with what each is
 *  for (the app's events that use it, or would). */
export const SOUND_CATALOG: { kind: SoundKind; label: string; use: string }[] = [
  { kind: 'success', label: 'Success', use: 'Your uploads went through' },
  {
    kind: 'warning',
    label: 'Warning',
    use: 'Microphone or speaker blocked, an upload refused, a commit that changed elsewhere',
  },
  {
    kind: 'danger',
    label: 'Error',
    use: 'An assistant turn or a run failed, a call or a commit refused',
  },
  { kind: 'notification', label: 'Notification', use: 'A model provider starts failing' },
  { kind: 'commit', label: 'Commit', use: 'A page, table or drawing committed' },
  { kind: 'action', label: 'Action', use: 'A small confirm: a question answered, a call approved' },
  { kind: 'attention', label: 'Attention', use: 'A question or a tool call waits for you' },
  { kind: 'message', label: 'Message', use: 'A new line in one of your chats' },
  { kind: 'mention', label: 'Mention', use: 'Someone names you in a chat' },
  { kind: 'reply', label: 'Reply', use: 'The assistant finished its reply' },
  { kind: 'complete', label: 'Complete', use: 'A run you are watching is done' },
  { kind: 'ring', label: 'Ring', use: 'An incoming call (repeats while it rings)' },
  {
    kind: 'ringback',
    label: 'Ringback',
    use: 'Your call ringing the other side, until someone answers',
  },
  { kind: 'join', label: 'Join', use: 'You joined a call, someone came in' },
  { kind: 'leave', label: 'Leave', use: 'You hung up, someone left, the call ended' },
];
