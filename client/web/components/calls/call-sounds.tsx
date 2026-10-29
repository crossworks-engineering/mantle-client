'use client';

/**
 * The call's own sounds, headless, mounted once by the messenger shell beside
 * the ringer (the incoming ring is the ring card's, components/calls/
 * ring-card.tsx). Read off the call state's changes, so a call started,
 * answered or ended in any way sounds the same:
 *
 * - ringback while my call waits alone in the room (I started it, nobody else
 *   has come in yet), until someone answers, for at most RING_MS;
 * - join when I am in and someone else comes in (the answer, a group joiner);
 * - leave when someone else goes, and when my call ends (I hung up, I was
 *   removed, the call was ended).
 *
 * All through `play`, so the sound preference holds for every one.
 */

import { useEffect, useRef } from 'react';
import { RING_MS } from '@/lib/calls/session';
import { play } from '@/lib/sounds/play';
import { useCallState } from './call-store';

/** How often the ringback repeats. */
export const RINGBACK_EVERY_MS = 3_000;
/** The room's people are known a moment after the join: wait this long
 *  before the first ringback, so a call with people already in never
 *  sounds one. */
const RINGBACK_GRACE_MS = 700;

export function CallSounds() {
  const call = useCallState();
  // How this call was entered ('idle': I started it or picked it from the
  // chat; 'ringing': I answered) and whether anyone else has been in it.
  const prev = useRef({ phase: call.phase, others: 0, entered: 'idle' as string, met: false });

  const inCall = call.phase === 'joining' || call.phase === 'live';
  const others = Math.max(0, call.people.length - 1);

  // join / leave / hang-up, from what changed since the last state.
  useEffect(() => {
    const was = prev.current;
    const wasIn = was.phase === 'joining' || was.phase === 'live';
    // Entering a call: from idle it is one I started or picked from the
    // chat; from ringing it is an answer.
    const entered = !wasIn && inCall ? was.phase : was.entered;
    if (call.phase === 'live' && others > was.others && was.phase === 'live') play('join');
    else if (call.phase === 'live' && was.phase !== 'live' && others > 0) play('join');
    else if (call.phase === 'live' && others < was.others) play('leave');
    if (wasIn && (call.phase === 'ending' || call.phase === 'idle')) play('leave');
    prev.current = {
      phase: call.phase,
      others,
      entered: inCall ? entered : 'idle',
      met: inCall && (was.met || others > 0),
    };
  }, [call.phase, others, inCall]);

  // Ringback: live, alone, in a call this login started (entered from idle,
  // not answered from a ring). Read after the effect above has noted how
  // this call was entered (effects run in order).
  const { phase, liveSince } = call;
  useEffect(() => {
    // Once anyone has answered, being alone again is not ringing.
    const started = prev.current.entered === 'idle' && !prev.current.met;
    if (phase !== 'live' || others > 0 || !started || liveSince === null) return;
    const left = RING_MS - (Date.now() - liveSince);
    if (left <= 0) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const first = setTimeout(() => {
      play('ringback');
      timer = setInterval(() => play('ringback'), RINGBACK_EVERY_MS);
    }, RINGBACK_GRACE_MS);
    const stop = setTimeout(() => {
      if (timer) clearInterval(timer);
    }, left);
    return () => {
      clearTimeout(first);
      clearTimeout(stop);
      if (timer) clearInterval(timer);
    };
  }, [phase, others, liveSince]);

  return null;
}
