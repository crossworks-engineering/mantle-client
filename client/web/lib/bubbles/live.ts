/**
 * The live card (Project Bubble Chat, phase 3): an assistant turn this tab
 * sent, while it runs and no chat window is open. It is derived from the
 * dock's own transcript (`useDockSession().messages`), which the dock fills
 * from the one stream it holds for the turn. Nothing here is stored, and no
 * stream is opened. Pure; pinned by live.test.ts.
 */

/** The shape of a dock line this reads (the dock's `DockMsg`). */
export type DockLine = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  pending?: boolean;
  error?: boolean;
  /** The brain's turn id, from the 202: what Stop cancels. */
  turnId?: string;
  /** The turn's latest step ("Reading the release notes"). */
  step?: string;
};

export type LiveTurn = {
  /** The dock line's id: one live card for each turn. */
  id: string;
  turnId: string | null;
  step: string | null;
  text: string;
  pending: boolean;
  error: boolean;
};

/** The dock's newest assistant line, as a live turn, or null. */
export function liveTurnOf(lines: readonly DockLine[]): LiveTurn | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!;
    if (l.role !== 'assistant') continue;
    return {
      id: l.id,
      turnId: l.turnId ?? null,
      step: l.step?.trim() || null,
      text: l.text,
      pending: !!l.pending,
      error: !!l.error,
    };
  }
  return null;
}

/** How long a finished live card waits for the reply's own card. */
export const LIVE_HOLD_MS = 6000;
/** The streamed text a live card shows: its end, about 4 lines. */
export const LIVE_TAIL_MAX = 200;

/**
 * The end of the text so far, as plain words: what the assistant is writing
 * now. A light strip, with no markdown reader, so the stack loads nothing more
 * for it. The finished reply is read properly (reply-text.ts).
 */
export function liveTail(text: string, max = LIVE_TAIL_MAX): string {
  const words = text
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)]|\|)\s?/gm, '')
    .replace(/[*_`|~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (words.length <= max) return words;
  const tail = words.slice(words.length - max);
  const space = tail.indexOf(' ');
  return `…${space >= 0 && space < max / 3 ? tail.slice(space + 1) : tail}`;
}

/**
 * Whether a finished live card still shows: it was on screen when the turn
 * ended, the person did not close it, and no card of its chat has come
 * since the turn started, in the hold. A failed turn usually has no reply card
 * to wait for, so it shows the failure until it is closed or one comes. Then the reply's own card takes its place, so the
 * person sees one card that changes, not one that goes and comes back.
 */
export function liveHeld(s: {
  shownAtEnd: boolean;
  closed: boolean;
  /** The turn failed: no reply card comes, so it stays until it is closed. */
  failed: boolean;
  /** The chat's card keys when the turn started: one not among them is
   *  this turn's reply. */
  keysAtStart: readonly string[];
  /** The chat's card keys now. */
  keysNow: readonly string[];
  /** LIVE_HOLD_MS has passed since the turn ended. */
  over: boolean;
}): boolean {
  if (!s.shownAtEnd || s.closed) return false;
  // The reply's own card came: it takes the place, also after a failure the
  // dock reported (a lost stream) while the turn went on and finished.
  if (s.keysNow.some((k) => !s.keysAtStart.includes(k))) return false;
  return s.failed || !s.over;
}

/** What a live card says to a screen reader, by its state. */
export function liveStatus(title: string, turn: Pick<LiveTurn, 'pending' | 'error'>): string {
  if (turn.pending) return `${title} is working`;
  return turn.error ? `${title} could not finish` : `${title} replied`;
}
