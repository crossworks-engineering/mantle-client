/**
 * Live delivery of the messenger (Messenger V1 Phase 2), the pure half.
 * Pinned by live.test.ts.
 *
 * GET /api/messenger/stream sends ids and a seq, never text
 * (docs/messenger.md "Live delivery"): every event is a ping to fetch. What a
 * ping means for the screen is `effectOf`. The stream is best effort: on a
 * reconnect, on tab focus and while it is silent the client fetches the gap
 * itself, and seq makes that gap exact.
 *
 * Silence: the brain writes a keep-alive comment every 25 seconds. A
 * corporate proxy that buffers SSE swallows those and the events with them,
 * so a stream that has said nothing for longer than that is treated as
 * deaf: the list is polled every 5 seconds until a frame arrives again
 * (`SilenceWatchdog`).
 */
import type { MessengerStreamEvent } from './dto';

export const MESSENGER_STREAM_PATH = '/api/messenger/stream';

/** The brain's keep-alive interval (server/web/lib/sse.ts heartbeatMs). */
export const STREAM_HEARTBEAT_MS = 25_000;
/** Silent this long: the stream is taken as deaf and the poll starts. */
export const STREAM_SILENCE_MS = STREAM_HEARTBEAT_MS + 10_000;
/** The poll while the stream is silent. */
export const POLL_MS = 5_000;
/** How long "X is typing" shows after the last typing event. */
export const TYPING_SHOW_MS = 5_000;
/** I send a typing ping at most this often. */
export const TYPING_SEND_MS = 3_000;

/** A frame of the stream (its text, or the object the shared realtime
 *  stream already parsed) as an event, or null when it is not one. */
export function parseStreamEvent(data: unknown): MessengerStreamEvent | null {
  let v: unknown = data;
  if (typeof data === 'string') {
    try {
      v = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== 'object') return null;
  const e = v as Record<string, unknown>;
  if (typeof e.c !== 'string' || !e.c) return null;
  const seq = typeof e.seq === 'number' && Number.isInteger(e.seq) ? e.seq : null;
  const loginId = typeof e.loginId === 'string' && e.loginId ? e.loginId : null;
  switch (e.type) {
    case 'message':
      if (seq === null || (e.kind !== 'new' && e.kind !== 'edit' && e.kind !== 'delete')) {
        return null;
      }
      return { type: 'message', c: e.c, seq, kind: e.kind };
    case 'read':
      return seq === null || !loginId ? null : { type: 'read', c: e.c, seq, loginId };
    case 'reaction':
      return seq === null ? null : { type: 'reaction', c: e.c, seq };
    case 'typing':
      return loginId ? { type: 'typing', c: e.c, loginId } : null;
    case 'participants':
      return { type: 'participants', c: e.c };
    case 'history':
      return { type: 'history', c: e.c };
    default:
      return null;
  }
}

/** What one event asks of the screen. */
export type LiveEffect = {
  c: string;
  /** Refetch the list (its row: unread, preview, order) and the badge. */
  refreshList: boolean;
  /** The open chat fetches after the highest seq it holds. */
  catchUp: boolean;
  /** The open chat refetches this one seq (an edit, a delete, a reaction). */
  refetchSeq: number | null;
  /** The open chat loads again (people changed, history deleted, my own
   *  clear or mute from another tab). */
  reload: boolean;
  /** Someone's read cursor moved (a receipt). */
  read: { loginId: string; seq: number } | null;
  /** Someone is typing. */
  typing: string | null;
  /** A new message: the toast and the desktop notice key on it. */
  newSeq: number | null;
};

export function effectOf(ev: MessengerStreamEvent): LiveEffect {
  const base: LiveEffect = {
    c: ev.c,
    refreshList: true,
    catchUp: false,
    refetchSeq: null,
    reload: false,
    read: null,
    typing: null,
    newSeq: null,
  };
  switch (ev.type) {
    case 'message':
      return ev.kind === 'new'
        ? { ...base, catchUp: true, newSeq: ev.seq }
        : { ...base, refetchSeq: ev.seq };
    case 'reaction':
      return { ...base, refetchSeq: ev.seq };
    case 'read':
      return { ...base, read: { loginId: ev.loginId, seq: ev.seq } };
    case 'typing':
      return { ...base, refreshList: false, typing: ev.loginId };
    case 'participants':
    case 'history':
      return { ...base, reload: true };
  }
}

/** The timers the watchdog runs on (vitest's fake timers stand in). */
export type WatchdogClock = {
  now: () => number;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (h: unknown) => void;
};

const realClock: WatchdogClock = {
  now: () => Date.now(),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

/**
 * Polls while the stream is silent. `heard()` on every frame the stream
 * delivers (an event or a keep-alive comment) and on every connect; every
 * POLL_MS the watchdog checks, and while nothing was heard for longer than
 * STREAM_SILENCE_MS it calls `onPoll`. The first frame after the silence
 * stops the poll by itself (the next check finds the stream speaking).
 */
export class SilenceWatchdog {
  private lastHeard: number;
  private timer: unknown = null;
  private readonly clock: WatchdogClock;
  private readonly silenceMs: number;
  private readonly pollMs: number;

  constructor(
    private readonly onPoll: () => void,
    opts: { clock?: WatchdogClock; silenceMs?: number; pollMs?: number } = {},
  ) {
    this.clock = opts.clock ?? realClock;
    this.silenceMs = opts.silenceMs ?? STREAM_SILENCE_MS;
    this.pollMs = opts.pollMs ?? POLL_MS;
    this.lastHeard = this.clock.now();
  }

  heard(): void {
    this.lastHeard = this.clock.now();
  }

  /** Silent longer than the heartbeat allows. */
  get silent(): boolean {
    return this.clock.now() - this.lastHeard > this.silenceMs;
  }

  start(): void {
    if (this.timer !== null) return;
    this.lastHeard = this.clock.now();
    this.timer = this.clock.setInterval(() => {
      if (this.silent) this.onPoll();
    }, this.pollMs);
  }

  stop(): void {
    if (this.timer === null) return;
    this.clock.clearInterval(this.timer);
    this.timer = null;
  }
}

/** The shape of the stream a live connection reads (the shared realtime
 *  singleton in the app, a fake in the tests). Returns the unsubscribe. */
export type StreamSource = (handlers: {
  onData: (data: unknown) => void;
  /** Any frame at all, keep-alives included. */
  onActivity: () => void;
  /** A (re)connect: the gap since the last one is unknown. */
  onConnect: () => void;
}) => () => void;

/**
 * The messenger's live wiring, free of React: read the stream, hand each
 * event's effect to `onEffect`, ask for the gap on every connect (`onGap`:
 * the first one too, since a message can commit between a chat's first page
 * and the stream's subscribe, and a subscriber joining a stream that is
 * already open hears no connect until the next one), and poll (`onPoll`)
 * while the stream is silent.
 */
export function connectMessengerLive(opts: {
  source: StreamSource;
  onEffect: (e: LiveEffect) => void;
  onGap: () => void;
  onPoll: () => void;
  clock?: WatchdogClock;
}): () => void {
  const dog = new SilenceWatchdog(opts.onPoll, { clock: opts.clock });
  const off = opts.source({
    onData: (data) => {
      dog.heard();
      const ev = parseStreamEvent(data);
      if (ev) opts.onEffect(effectOf(ev));
    },
    onActivity: () => dog.heard(),
    onConnect: () => {
      dog.heard();
      opts.onGap();
    },
  });
  dog.start();
  return () => {
    dog.stop();
    off();
  };
}

/**
 * The receipts of one tab: the highest read seq each other login reached in
 * each chat, as the stream reported it. The brain keeps no column of other
 * logins' cursors for me to read (docs/messenger.md "Who reads what": a
 * receipt is a stream event by design), so this knows only what was heard
 * while the tab was open.
 */
export class ReceiptBook {
  private readonly reads = new Map<string, Map<string, number>>();
  private version = 0;
  private readonly listeners = new Set<() => void>();

  record(c: string, loginId: string, seq: number): void {
    let room = this.reads.get(c);
    if (!room) {
      room = new Map();
      this.reads.set(c, room);
    }
    if ((room.get(loginId) ?? 0) >= seq) return;
    room.set(loginId, seq);
    this.bump();
  }

  /** The seq every one of `others` has read up to (0 when any is unknown). */
  readByAll(c: string, others: readonly string[]): number {
    if (others.length === 0) return 0;
    const room = this.reads.get(c);
    let min = Number.POSITIVE_INFINITY;
    for (const id of others) min = Math.min(min, room?.get(id) ?? 0);
    return min;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  snapshot = (): number => this.version;

  private bump(): void {
    this.version += 1;
    for (const fn of this.listeners) fn();
  }
}

/** Who is typing where, each for TYPING_SHOW_MS after their last ping. */
export class TypingBook {
  private readonly until = new Map<string, Map<string, number>>();
  private version = 0;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  record(c: string, loginId: string): void {
    let room = this.until.get(c);
    if (!room) {
      room = new Map();
      this.until.set(c, room);
    }
    room.set(loginId, this.now() + TYPING_SHOW_MS);
    this.bump();
  }

  /** A message from them ends their typing at once. */
  clear(c: string, loginId: string): void {
    if (this.until.get(c)?.delete(loginId)) this.bump();
  }

  typing(c: string): string[] {
    const room = this.until.get(c);
    if (!room) return [];
    const now = this.now();
    return [...room.entries()].filter(([, t]) => t > now).map(([id]) => id);
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  snapshot = (): number => this.version;

  /** Repaint once the oldest entry runs out (the caller's timer). */
  tick(): void {
    this.bump();
  }

  private bump(): void {
    this.version += 1;
    for (const fn of this.listeners) fn();
  }
}

/** Whether to send a typing ping now (at most once per TYPING_SEND_MS). */
export function shouldSendTyping(lastSentAt: number | null, now: number): boolean {
  return lastSentAt === null || now - lastSentAt >= TYPING_SEND_MS;
}

/** "Ann is typing", "Ann and Ben are typing", "3 people are typing". */
export function typingLine(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} is typing`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing`;
  return `${names.length} people are typing`;
}
