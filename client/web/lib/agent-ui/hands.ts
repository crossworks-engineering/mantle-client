/**
 * Agent UI, the hands: one controller per window that runs an agent's
 * actions on the screen while the user watches. Browser only.
 *
 * A session is begun by whoever drives (a scripted lesson, later an in-app
 * agent) and shows the Stop bar (components/agent-ui). While it runs:
 *
 *  - Actions run one at a time. Each moves the agent cursor to its target
 *    first, then acts with real pointer and keyboard-free events, so React
 *    and Radix handlers run as they do for a user.
 *  - Every write the page sends is checked (`riskOfRequest`). A risky one
 *    (delete, send, share, publish, a setting) waits for the user's Allow
 *    in a prompt the host draws; Not now refuses it. This wraps `fetch`
 *    itself, so a screen that calls fetch directly is held too. A request
 *    set off while an action runs is checked even when the user paused or
 *    stopped the session meanwhile.
 *  - A write the agent sets off carries its tag (`x-mantle-agent-call`: the
 *    agent's call id, or `lesson:<uuid>`), and the brain refuses a risky
 *    one (403 `agent_refused`). That answer is held the same way; Allow
 *    sends it once more, untagged, as the user's own.
 *  - Any real click or key press by the user outside the agent's controls
 *    pauses the session: actions answer `user_took_over` until `resume`.
 *  - Stop (or Esc) ends it. An action checks after every wait that the
 *    session still runs and is not paused, and answers `stopped` if not.
 */
import {
  AGENT_CALL_HEADER,
  elementRefusal,
  isAgentRefusal,
  bodyHasKey,
  isBookkeepingRequest,
  linkRefusal,
  MAX_WAIT_MS,
  heldText,
  refuse,
  riskOfRequest,
  safeAgentRoute,
  type AgentRefusal,
  type AgentResult,
  type AgentTarget,
  type RequestRisk,
  type Screen,
} from './model';
import { setLoginChangeGuard } from '@mantle/web-ui/login-change-guard';
import { currentLoginKey, isLoginStorageKey, loginChangedFrom } from './login-pin';
import { centerOf, factsOf, findByName, findTarget, readScreen, roleOf } from './dom';

export type HeldRequest = {
  id: number;
  risk: RequestRisk;
  /** The brain's reason, when the brain refused it (`risk` is `refused`). */
  reason: string | null;
  method: string;
  path: string;
  /** The user's answer. */
  answer: (allow: boolean) => void;
  /** A held save of the agent's change (`risk` `unsaved`): throw the change
   *  away instead, by loading the item again. */
  discard?: () => void;
};

export type ConsentAsk = { agent: string; answer: (allow: boolean) => void };

export type HandsState = {
  active: boolean;
  /** An in-app agent asks to use this window (lib/agent-ui/turn-calls). */
  consent: ConsentAsk | null;
  agent: string;
  paused: boolean;
  cursor: { x: number; y: number } | null;
  /** The control pointed at; the overlay follows it as the page moves. */
  spotlight: { el: Element; caption: string } | null;
  held: HeldRequest | null;
  /** A write of the agent's last action that went nowhere after Stop: a
   *  small host note says so, instead of a silent block or a raw 403. */
  note: string | null;
};

const IDLE: HandsState = {
  active: false,
  consent: null,
  agent: '',
  paused: false,
  cursor: null,
  spotlight: null,
  held: null,
  note: null,
};

/** How long the cursor takes to reach a target before acting. */
const CURSOR_MS = 350;
/** The screen counts as settled once no request has been open this long. */
const QUIET_MS = 250;
/** A write that starts this soon after the agent's last action is still
 *  the agent's (a debounced save of what it typed), also when the user
 *  stopped or took over meanwhile: tagged, and held when risky. */
const LATE_MS = 2000;
/** How long the host note about a late write stays up. */
const NOTE_MS = 8000;
/** How long after a Discard's reload the page may still be here before it
 *  counts as cancelled. */
const RELOAD_MS = 2000;
/** How long a held request waits for the user before it counts as Not now. */
const HELD_MS = 120_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class AgentHands {
  private state: HandsState = IDLE;
  private listeners = new Set<(s: HandsState) => void>();
  private refs = new Map<string, Element>();
  private queue: Promise<unknown> = Promise.resolve();
  private navigate: ((path: string) => void) | null = null;
  private realFetch: typeof fetch | null = null;
  private inflight = 0;
  private lastRequestAt = 0;
  private heldSeq = 0;
  private blockedSinceAction = false;
  private stopped = false;
  /** Why the session ended, when it was not the user's Stop: the login
   *  changed under it (another tab), so its calls answer `window_gone`. */
  private endedBy: 'window_gone' | null = null;
  /** The login the session acts as (`currentLoginKey` when it began, or the
   *  turn's pin). undefined: none pinned. */
  private pinnedLogin: string | null | undefined = undefined;
  /** Bumped by every new session, so an action of an ended one cannot go
   *  on in the next. */
  private generation = 0;
  /** Actions running now (0 or 1: they are queued). */
  private acting = 0;
  /** What the agent's writes are tagged with (`x-mantle-agent-call`): the
   *  in-app agent's last call, or the lesson's `lesson:<uuid>`. The brain
   *  refuses a risky write that carries it (fix round contract). */
  private callTag: string | null = null;
  /** When the in-app agent's current call expires (epoch ms): an action it
   *  queued that only starts after that is not run (`window_gone`). */
  private callExpiresAt: number | null = null;
  /** Until when a write still counts as the last action's (LATE_MS after
   *  it ended), and the tag it carried. */
  private lateUntil = 0;
  private lateTag: string | null = null;
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  /** The wrapper this controller put on `window.fetch`, so it only takes
   *  off its own. */
  private wrapper: typeof fetch | null = null;
  /** Who drove the session that ended, for the late-write note. */
  private lastAgent = '';
  private noteTimer: ReturnType<typeof setTimeout> | null = null;
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;

  // ── state for the overlay ────────────────────────────────────────────────

  get(): HandsState {
    return this.state;
  }

  subscribe(fn: (s: HandsState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<HandsState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  /** The app's router, registered by the overlay. */
  setNavigator(fn: ((path: string) => void) | null) {
    this.navigate = fn;
  }

  // ── the session ──────────────────────────────────────────────────────────

  /** Start a session for `agent`, its writes tagged `tag` (a lesson's
   *  `lesson:<uuid>`; an in-app agent tags each call in `withCall`). On a
   *  session that runs already it only takes the new name and tag: one the
   *  user took over stays paused until they say go on. */
  begin(agent: string, opts: { tag?: string; login?: string | null } = {}): void {
    const name = agent.slice(0, 60) || 'The agent';
    if (this.state.active) {
      if (opts.tag) this.callTag = opts.tag;
      this.set({ agent: name });
      return;
    }
    this.stopped = false;
    this.endedBy = null;
    this.generation += 1;
    this.callTag = opts.tag ?? null;
    this.pinnedLogin = opts.login !== undefined ? opts.login : currentLoginKey();
    this.wrapFetch();
    window.addEventListener('pointerdown', this.onUserInput, true);
    window.addEventListener('keydown', this.onUserInput, true);
    window.addEventListener('storage', this.onStorage);
    this.set({ ...IDLE, active: true, agent: name });
  }

  /** Stop: the session ends and every open or later action is refused. An
   *  action still running keeps the request guard until it returns. */
  end(): void {
    if (!this.state.active) return;
    this.stopped = true;
    window.removeEventListener('pointerdown', this.onUserInput, true);
    window.removeEventListener('keydown', this.onUserInput, true);
    window.removeEventListener('storage', this.onStorage);
    this.state.held?.answer(false);
    this.refs.clear();
    this.lastAgent = this.state.agent;
    this.set(IDLE);
    if (this.acting === 0) this.releaseLater();
  }

  /** The guard and the tag go once no session runs and no action does,
   *  and the last action's late writes have had their LATE_MS. */
  private releaseLater() {
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseTimer = setTimeout(
      () => {
        this.releaseTimer = null;
        try {
          if (!this.state.active && this.acting === 0) this.release();
        } catch {
          /* the window went away first */
        }
      },
      Math.max(0, this.lateUntil - Date.now()),
    );
  }

  private release() {
    // The guard stays while a change the user said Not now to is still in
    // the page: its next save is asked about (`tainted`).
    if (this.tainted.size === 0 && this.discarding.size === 0) this.unwrapFetch();
    this.callTag = null;
    this.lateTag = null;
  }

  // ── a change the user said Not now to ──────────────────────────────────

  /** Writes (`METHOD path`) the user said Not now to, or that went nowhere
   *  after Stop. The editor still holds the agent's change, so the next
   *  write to the same item from this page asks first, untagged or not,
   *  session or not, until the user allows it, discards it, or reloads. */
  private tainted = new Set<string>();
  /** Items whose agent change the user discarded: every write to them is
   *  refused while the page loads again, so the leave flush (a draft save
   *  on pagehide, a beacon) cannot send the change on the way out. */
  private discarding = new Set<string>();

  /** The item a write is to, whatever the write (a draft save, a commit,
   *  a publish all carry its content): `/api/<kind>/<id>`, or the path
   *  itself for a write that is not to an item. Exported as `itemOfWrite`. */
  private taintKey(_method: string, url: string): string {
    return itemOfWrite(url);
  }

  private taint(method: string, url: string) {
    this.tainted.add(this.taintKey(method, url));
  }

  /** Whether some write of this page is waiting to be asked about. */
  hasTaint(): boolean {
    return this.tainted.size > 0 || this.discarding.size > 0;
  }

  /** While the page loads again after a Discard, a beacon to a discarded
   *  item is refused too. */
  private blockBeacons() {
    try {
      const nav = navigator as Navigator & { __agentBeacons?: true };
      if (!nav.sendBeacon || nav.__agentBeacons) return;
      const real = nav.sendBeacon.bind(nav);
      nav.sendBeacon = (url: string | URL, data?: BodyInit | null) =>
        this.discarding.has(itemOfWrite(String(url))) ? false : real(url, data);
      nav.__agentBeacons = true;
    } catch {
      /* no beacons here */
    }
  }

  /** Whether a beacon to `url` would be refused now (for its test). */
  beaconRefused(url: string): boolean {
    return this.discarding.has(itemOfWrite(url));
  }

  /** Ask before a tainted write goes: Save sends it as the user's own,
   *  Discard loads the item again (the change goes), Not now keeps it. */
  private async askTainted(method: string, url: string): Promise<'save' | 'discard' | 'keep'> {
    const key = this.taintKey(method, url);
    let discarded = false;
    const allowed = await this.ask('unsaved', method, url, null, () => {
      discarded = true;
      // Shut before the question closes: a write that comes in between
      // must not open a fresh one.
      this.discarding.add(key);
    });
    if (allowed) {
      this.tainted.delete(key);
      if (!this.state.active && this.acting === 0) this.releaseLater();
      return 'save';
    }
    if (discarded) {
      // Held shut (set as Discard was pressed): the editor still holds the
      // change until the page has loaded again, and leaving flushes it.
      // The reminder stays, for a reload that does not happen.
      this.blockBeacons();
      this.reloadFor(key);
      return 'discard';
    }
    return 'keep';
  }

  /**
   * Load the page again for a discarded change, and open the item again if
   * that did not happen: a leave guard (the app editor's, Recall's) or the
   * desktop app's leave dialog, which defaults to Stay, can cancel it.
   *
   * `location.reload()` asks the page's leave guards first, synchronously.
   * When none of them asked the user, the reload goes on and the item stays
   * shut until the page is gone. When one did, the user may have said Stay:
   * about 2 s later, if the page still has the focus (a dialog takes it),
   * or as soon as it has it back, the item opens again; also on a
   * `pageshow` that brings the page back. The reminder stays, so its next
   * save asks again, and a host note says the page did not reload.
   *
   * Left open: a guard asked, the user said Leave, and the next page took
   * longer than that to answer while this one still had the focus. Then
   * the item opens again before the old page goes, and its leave flush may
   * send the change untagged.
   */
  private reloadFor(key: string) {
    let prompted = false;
    const onBefore = (e: Event) => {
      const b = e as BeforeUnloadEvent;
      prompted =
        prompted ||
        b.defaultPrevented ||
        (typeof b.returnValue === 'string' && b.returnValue !== '');
    };
    try {
      window.addEventListener('beforeunload', onBefore);
    } catch {
      /* no window */
    }
    try {
      location.reload();
    } catch {
      // No page to load again: it is still here.
      prompted = true;
    }
    try {
      window.removeEventListener('beforeunload', onBefore);
      window.addEventListener(
        'pageshow',
        (e) => {
          if ((e as PageTransitionEvent).persisted) this.reloadDidNotHappen(key);
        },
        { once: true },
      );
    } catch {
      /* no window */
    }
    if (!prompted) return;
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null;
      try {
        if (typeof document === 'undefined' || document.hasFocus()) {
          this.reloadDidNotHappen(key);
        } else {
          window.addEventListener('focus', () => this.reloadDidNotHappen(key), { once: true });
        }
      } catch {
        /* the page went */
      }
    }, RELOAD_MS);
  }

  /** The reload a Discard asked for did not happen: the item opens again,
   *  its reminder still standing, and a note says so. */
  private reloadDidNotHappen(key: string) {
    if (!this.discarding.delete(key)) return;
    this.showNote("The page didn't reload. Your unsaved change is still here.");
  }

  /** Stop every timer and take the guard off now: for a page (or a test)
   *  that is going away. */
  dispose(): void {
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    if (this.noteTimer) clearTimeout(this.noteTimer);
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.releaseTimer = null;
    this.noteTimer = null;
    this.reloadTimer = null;
    this.lateUntil = 0;
    this.tainted.clear();
    this.discarding.clear();
    this.end();
    this.release();
  }

  /** The session ended because the login changed (another tab). */
  endedForLoginChange(): boolean {
    return this.endedBy === 'window_gone';
  }

  /** Say that a late write of the agent's went nowhere (after Stop). */
  private noteLate(risk: RequestRisk, reason: string | null) {
    const who = this.lastAgent || 'The agent';
    this.showNote(`${who}'s last action tried to ${heldText(risk, reason)}; not sent.`);
  }

  /** A short host note, closed after NOTE_MS. */
  private showNote(text: string) {
    this.set({ note: text });
    if (this.noteTimer) clearTimeout(this.noteTimer);
    this.noteTimer = setTimeout(() => {
      this.noteTimer = null;
      this.set({ note: null });
    }, NOTE_MS);
  }

  /** Close the host note. */
  dismissNote(): void {
    if (this.noteTimer) clearTimeout(this.noteTimer);
    this.noteTimer = null;
    this.set({ note: null });
  }

  /** The agent drives now: a session runs and the user has not taken over.
   *  A login switch or sign-out is refused then (the kit's login guard). */
  drivingNow(): boolean {
    return !this.state.paused && (this.state.active || this.acting > 0);
  }

  /** Ask the user whether an in-app agent may use this window, for the
   *  rest of this page's life. */
  askConsent(agent: string): Promise<boolean> {
    this.state.consent?.answer(false);
    return new Promise((resolve) => {
      const ask: ConsentAsk = {
        agent: agent.slice(0, 60) || 'The assistant',
        answer: (allow) => {
          if (this.state.consent !== ask) return;
          this.set({ consent: null });
          resolve(allow);
        },
      };
      this.set({ consent: ask });
    });
  }

  /** Run `fn` as the in-app agent's call `callId`. Every write the page
   *  makes from then until the session ends names the last call (a
   *  debounced save lands after the action has returned). */
  async withCall<T>(
    callId: string,
    fn: () => Promise<T>,
    opts: { expiresAt?: number | null } = {},
  ): Promise<T> {
    this.callTag = callId;
    this.callExpiresAt = opts.expiresAt ?? null;
    try {
      return await fn();
    } finally {
      this.callExpiresAt = null;
    }
  }

  /** Whether the login changed since the session began (another tab
   *  switched or signed out): the agent must not act as anyone else. */
  loginChanged(): boolean {
    return loginChangedFrom(this.pinnedLogin, currentLoginKey());
  }

  /** End the session because the login changed: its open and later calls
   *  answer `window_gone`, and nothing more is sent as it. */
  endForLoginChange(): void {
    if (!this.state.active) return;
    this.endedBy = 'window_gone';
    // Not the late window either: nothing more goes out tagged as it.
    this.lateUntil = 0;
    this.end();
  }

  private onStorage = (e: StorageEvent) => {
    if (this.state.active && isLoginStorageKey(e.key) && this.loginChanged()) {
      this.endForLoginChange();
    }
  };

  /** Go on after the user took over (the user said so). */
  resume(): void {
    if (this.state.active) this.set({ paused: false });
  }

  private onUserInput = (e: Event) => {
    if (!e.isTrusted || !this.state.active) return;
    const target = e.target as Element | null;
    if (target?.closest?.('[data-agent-host]')) return;
    this.set({ paused: true, spotlight: null });
  };

  // ── the request guard ────────────────────────────────────────────────────

  // The one guard for every way the page sends a request: the fetch
  // wrapper below and XHR uploads (lib/xhr-upload.ts) both go through
  // `guardRequest` before sending and `allowRefused` on a 403.

  /** Whether a request sent now would be the agent's (a session runs and
   *  is not paused, or one of its actions is running): only then does
   *  `guardRequest` have anything to do. */
  guarding(): boolean {
    return (
      this.acting > 0 || (this.state.active && !this.state.paused) || Date.now() < this.lateUntil
    );
  }

  /**
   * Before a request goes out: hold it when it is risky and the agent set
   * it off, and say which tag it must carry. `blocked` when the user said
   * Not now (or the session ended mid-action): send nothing.
   */
  async guardRequest(
    method: string,
    url: string,
    body?: unknown,
  ): Promise<{ blocked: true } | { blocked: false; tag: string | null }> {
    const m = method.toUpperCase();
    // A write the user said Not now to before: the agent's change is still
    // in the editor. The user's own save of it (not set off by an action of
    // the agent's) is asked about again, session or not. An agent action
    // sending it again meets the usual hold below.
    const key = this.taintKey(m, url);
    const write = m !== 'GET' && m !== 'HEAD';
    // Discarded, and the page is loading again: nothing goes to it.
    if (write && this.discarding.has(key)) return { blocked: true };
    const tainted = write && this.tainted.has(key);
    const agentActing = this.acting > 0 || (this.state.active && !this.state.paused);
    if (tainted && !agentActing) {
      const answer = await this.askTainted(m, url);
      return answer === 'save' ? { blocked: false, tag: null } : { blocked: true };
    }
    // The agent's: sent while it drives, or while one of its actions runs
    // (the user may have paused or stopped it on the way).
    // The window's own answer and a plain cancel go; a cancel that
    // supersedes the turn with a correction is a send like any other.
    const own = agentOwnRequest(url) && !bodyHasKey(body, 'supersede');
    const agents = this.guarding() && !own;
    if (!agents) return { blocked: false, tag: null };
    // Another tab changed the login: the agent's write would go as someone
    // else. The session ends, and nothing is sent.
    if (m !== 'GET' && m !== 'HEAD' && (this.endedBy === 'window_gone' || this.loginChanged())) {
      this.endForLoginChange();
      return { blocked: true };
    }
    const risk = riskOfRequest(m, url, body ?? undefined);
    if (risk) {
      // Stopped meanwhile: nobody is asked, nothing is sent, and a note
      // says so.
      if (!this.state.active) {
        this.noteLate(risk, null);
        this.taint(m, url);
        this.blockedSinceAction = true;
        return { blocked: true };
      }
      const allowed = await this.ask(risk, m, url);
      if (!allowed) {
        this.taint(m, url);
        this.blockedSinceAction = true;
        return { blocked: true };
      }
      // Allowed: the change has gone, nothing is left to ask about.
      if (tainted) this.tainted.delete(key);
      // The user allowed it: it goes as theirs, untagged.
      return { blocked: false, tag: null };
    }
    // A write the agent set off carries its tag: the brain refuses a risky
    // one that is tagged. Background bookkeeping (a frame ticket, an open
    // counted) is the screen's, not the agent's write: never tagged.
    const tag =
      m !== 'GET' && m !== 'HEAD' && !isBookkeepingRequest(m, url)
        ? (this.callTag ?? (Date.now() < this.lateUntil ? this.lateTag : null))
        : null;
    return { blocked: false, tag };
  }

  /**
   * After a tagged request came back 403: when it is the brain's
   * agent_refused, hold it with the brain's reason. True when the user
   * allowed it, so the caller sends it once more, untagged, as theirs.
   * False when it is not a refusal (the page's own 403), or Not now.
   */
  async allowRefused(method: string, url: string, status: number, body: unknown): Promise<boolean> {
    if (!isAgentRefusal(status, body)) return false;
    const reason = (body as { reason?: unknown }).reason;
    const why = typeof reason === 'string' ? reason.slice(0, 40) : null;
    if (!this.state.active) {
      // A late write the brain refused after Stop: nobody to ask; the note
      // says so (the caller keeps the raw 403 off the screen).
      this.noteLate('refused', why);
      this.taint(method, url);
      return false;
    }
    if (await this.ask('refused', method.toUpperCase(), url, why)) {
      this.tainted.delete(this.taintKey(method, url));
      return true;
    }
    this.taint(method, url);
    this.blockedSinceAction = true;
    return false;
  }

  /** Count a request the page sends some other way (an XHR upload) for
   *  the screen settling. */
  async track<T>(sent: Promise<T>): Promise<T> {
    this.inflight += 1;
    this.lastRequestAt = Date.now();
    try {
      return await sent;
    } finally {
      this.inflight -= 1;
      this.lastRequestAt = Date.now();
    }
  }

  private wrapFetch() {
    if (this.realFetch) return;
    const real = window.fetch.bind(window);
    this.realFetch = window.fetch;
    const send = (input: RequestInfo | URL, init?: RequestInit) => this.track(real(input, init));
    this.wrapper = window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (
        init?.method ?? (input instanceof Request ? input.method : 'GET')
      ).toUpperCase();
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const guard = await this.guardRequest(method, url, init?.body ?? undefined);
      if (guard.blocked) throw new TypeError('Blocked: the user did not allow this request.');
      if (!guard.tag) return send(input, init);
      // A Request's body is read once: keep a copy for a resend.
      const spare = input instanceof Request ? input.clone() : null;
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      headers.set(AGENT_CALL_HEADER, guard.tag);
      const res = await send(input, { ...init, headers });
      if (res.status !== 403) return res;
      let body: unknown = null;
      try {
        body = await res.clone().json();
      } catch {
        /* not the brain's refusal */
      }
      if (!isAgentRefusal(res.status, body)) return res;
      if (!(await this.allowRefused(method, url, res.status, body))) {
        // Not the raw 403: the page shows plain words either way.
        throw new TypeError(
          this.state.active
            ? 'Blocked: the user did not allow this request.'
            : 'Not sent: the agent may not do this, and the user was not there to allow it.',
        );
      }
      headers.delete(AGENT_CALL_HEADER);
      return send(spare ?? input, { ...init, headers });
    };
  }

  private unwrapFetch() {
    // The window may be gone already (a page unloading, a test's teardown).
    try {
      if (this.realFetch && typeof window !== 'undefined' && window.fetch === this.wrapper) {
        window.fetch = this.realFetch;
      }
    } catch {
      /* nothing left to unwrap */
    }
    this.realFetch = null;
    this.wrapper = null;
  }

  private ask(
    risk: RequestRisk,
    method: string,
    url: string,
    reason: string | null = null,
    onDiscard?: () => void,
  ): Promise<boolean> {
    // One question at a time: a second risky request while one waits is
    // refused rather than stacked behind it.
    if (this.state.held) return Promise.resolve(false);
    let path = url;
    try {
      if (url) path = new URL(url, location.href).pathname;
    } catch {
      /* the raw text */
    }
    return new Promise((resolve) => {
      const id = ++this.heldSeq;
      const answer = (allow: boolean) => {
        if (this.state.held?.id !== id) return;
        this.set({ held: null });
        resolve(allow);
      };
      const discard = onDiscard
        ? () => {
            if (this.state.held?.id !== id) return;
            onDiscard();
            answer(false);
          }
        : undefined;
      this.set({
        held: {
          id,
          risk,
          reason,
          method,
          path: path.slice(0, 200),
          answer,
          ...(discard ? { discard } : {}),
        },
      });
    });
  }

  // ── actions ──────────────────────────────────────────────────────────────

  /** Run one action after the one before it, refusing when the session is
   *  not running. `fn` gets `alive`: false once the session ended, was
   *  paused, or another began; it checks it after each of its waits and
   *  answers `stopped` without acting when it is false. */
  private run<T extends object>(
    fn: (alive: () => boolean) => Promise<AgentResult<T>>,
  ): Promise<AgentResult<T>> {
    const expiresAt = this.callExpiresAt;
    const next = this.queue.then(async () => {
      if (expiresAt !== null && Date.now() >= expiresAt) return refuse('window_gone');
      if (!this.state.active) {
        return refuse(this.endedBy ?? (this.stopped ? 'stopped' : 'no_session'));
      }
      if (this.loginChanged()) {
        this.endForLoginChange();
        return refuse('window_gone');
      }
      if (this.state.paused) return refuse('user_took_over');
      const generation = this.generation;
      const alive = () => this.state.active && !this.state.paused && this.generation === generation;
      this.blockedSinceAction = false;
      this.acting += 1;
      try {
        let out: AgentResult<T>;
        try {
          out = await fn(alive);
        } catch (err) {
          return refuse('unsupported', err instanceof Error ? err.message : String(err));
        }
        // A request the action set off may still wait for the user's answer:
        // the action is not done until it is answered (or HELD_MS passes,
        // which counts as Not now).
        const deadline = Date.now() + HELD_MS;
        while (this.state.held && this.state.active && Date.now() < deadline) await sleep(80);
        this.state.held?.answer(false);
        if (!this.state.active || this.generation !== generation) {
          return refuse(this.endedBy ?? 'stopped');
        }
        if (!out.ok && out.error === 'stopped') return out;
        if (this.state.paused) return refuse('user_took_over');
        if (out.ok && this.blockedSinceAction) return refuse('needs_user');
        return out;
      } finally {
        this.acting -= 1;
        // Its late writes are still its own for LATE_MS.
        this.lateUntil = Date.now() + LATE_MS;
        this.lateTag = this.callTag;
        if (this.acting === 0 && !this.state.active) this.releaseLater();
      }
    });
    this.queue = next.catch(() => undefined);
    return next as Promise<AgentResult<T>>;
  }

  screen(): Promise<AgentResult<{ screen: Screen }>> {
    return this.run(async () => {
      const read = readScreen();
      this.refs = read.refs;
      return { ok: true, screen: read.screen };
    });
  }

  go(path: string): Promise<AgentResult<{ route: string }>> {
    return this.run(async () => {
      const route = safeAgentRoute(path);
      if (!route || !this.navigate) return refuse('bad_route');
      this.refs.clear();
      this.set({ spotlight: null });
      this.navigate(route);
      const settled = await this.settle(null, MAX_WAIT_MS, () => location.pathname === route);
      return settled ? { ok: true, route: location.pathname } : refuse('timeout');
    });
  }

  click(target: AgentTarget): Promise<AgentResult> {
    return this.run(async (alive) => {
      const el = this.locate(target, 'click');
      if ('error' in el) return el.error;
      await this.moveTo(el.el);
      if (!alive()) return refuse('stopped');
      press(el.el);
      await this.settle(null, 3000);
      return { ok: true };
    });
  }

  /** Type `text` into a field. It is added after what the field holds;
   *  `replace: true` puts it in place of all of it. */
  type(target: AgentTarget, text: string, opts: { replace?: boolean } = {}): Promise<AgentResult> {
    return this.run(async (alive) => {
      const el = this.locate(target, 'type');
      if ('error' in el) return el.error;
      await this.moveTo(el.el);
      if (!alive()) return refuse('stopped');
      // Replacing what a field holds loses it: the user's yes first.
      if (opts.replace === true && fieldText(el.el).trim() !== '') {
        const allowed = await this.ask('replace', '', '');
        if (!alive()) return refuse('stopped');
        if (!allowed) return refuse('needs_user');
      }
      if (!typeInto(el.el, text.slice(0, 2000), opts.replace === true))
        return refuse('unsupported');
      await this.settle(null, 2000);
      return { ok: true };
    });
  }

  select(target: AgentTarget, option: string): Promise<AgentResult> {
    return this.run(async (alive) => {
      const el = this.locate(target, 'select');
      if ('error' in el) return el.error;
      await this.moveTo(el.el);
      if (!alive()) return refuse('stopped');
      if (el.el instanceof HTMLSelectElement) {
        const opt = [...el.el.options].find(
          (o) => o.text.trim().toLowerCase() === option.trim().toLowerCase() || o.value === option,
        );
        if (!opt) return refuse('unsupported', `No option "${option}".`);
        setNativeValue(el.el, opt.value);
        el.el.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true };
      }
      // A menu, a combobox or a tab list: open it, then press the option.
      if (roleOf(el.el) !== 'tab' && roleOf(el.el) !== 'radio') press(el.el);
      await this.settle(null, 1500);
      if (!alive()) return refuse('stopped');
      const hit = findByName(OPTION_ROLES, option);
      if (!('el' in hit)) {
        return hit.error === 'ambiguous'
          ? refuse('ambiguous')
          : refuse('unsupported', `No option "${option}".`);
      }
      const refusal = pressRefusal(hit.el);
      if (refusal) return refuse(refusal);
      await this.moveTo(hit.el);
      if (!alive()) return refuse('stopped');
      press(hit.el);
      await this.settle(null, 2000);
      return { ok: true };
    });
  }

  point(target: AgentTarget, caption: string): Promise<AgentResult> {
    return this.run(async (alive) => {
      const found = findTarget(target, this.refs);
      if ('error' in found) return refuse(found.error);
      if (found.el.closest('[data-agent-host]')) return refuse('host_control');
      found.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      await this.moveTo(found.el);
      if (!alive()) return refuse('stopped');
      this.set({
        spotlight: { el: found.el, caption: caption.slice(0, 200) },
      });
      return { ok: true };
    });
  }

  wait(target: AgentTarget | null, ms = 3000): Promise<AgentResult> {
    return this.run(async () =>
      (await this.settle(target, Math.min(Math.max(0, ms), MAX_WAIT_MS)))
        ? { ok: true }
        : refuse('timeout'),
    );
  }

  /** The element a target names, refused by the guard when it must be. */
  private locate(
    target: AgentTarget,
    action: 'click' | 'type' | 'select',
  ): { el: Element } | { error: AgentResult<never> } {
    const found = findTarget(target, this.refs);
    if ('error' in found) return { error: refuse(found.error) };
    const refusal: AgentRefusal | null =
      action === 'click' ? pressRefusal(found.el) : elementRefusal(factsOf(found.el), action);
    if (refusal) return { error: refuse(refusal) };
    return found;
  }

  private async moveTo(el: Element) {
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.set({ cursor: centerOf(el), spotlight: null });
    await sleep(CURSOR_MS);
  }

  /** Until no request has been open for QUIET_MS, the target (if any) is on
   *  the screen and `ready` holds; false at the deadline. */
  private async settle(
    target: AgentTarget | null,
    ms: number,
    ready: () => boolean = () => true,
  ): Promise<boolean> {
    const deadline = Date.now() + ms;
    await sleep(50);
    while (Date.now() < deadline) {
      if (!this.state.active || this.state.paused) return false;
      const quiet =
        !this.state.held && this.inflight === 0 && Date.now() - this.lastRequestAt >= QUIET_MS;
      const there = !target || 'el' in findTarget(target, this.refs);
      if (quiet && there && ready()) return true;
      await sleep(80);
    }
    return false;
  }
}

/** The item a write is to: `/api/<kind>/<id>` (`/api/files/files/<id>`,
 *  `/api/recall/maps/<id>` count their two-part kinds), so a draft save, a
 *  commit and a publish of one page are one item. A path that names no
 *  item is its own key. */
export function itemOfWrite(url: string): string {
  let path = url;
  try {
    path = new URL(url, 'http://app.invalid').pathname;
  } catch {
    /* the raw text */
  }
  const m =
    /^\/api\/((?:files\/files|files\/folders|recall\/maps|tree\/items)|[a-z-]+)\/([^/]+)/.exec(
      path,
    );
  return m ? `${m[1]}/${m[2]}` : path;
}

/** The roles an option of a menu, a combobox or a tab list has, the
 *  likeliest first. */
const OPTION_ROLES = ['option', 'menuitemradio', 'menuitem', 'menuitemcheckbox', 'tab', 'radio'];

/** Why the agent may not press `el`: the guard's rules, and a link that
 *  leaves the app or opens a route the agent may not (`unsafe_route`). */
function pressRefusal(el: Element): AgentRefusal | null {
  const refusal = elementRefusal(factsOf(el), 'click');
  if (refusal) return refusal;
  return linkRefusal(hrefOf(el), location.href);
}

/** Where pressing `el` would go: its own or its link's href. A role=link
 *  with none acts by script, and its requests meet the request guard. */
function hrefOf(el: Element): string | null {
  const link = el.closest('a[href], area[href]');
  if (link) return link.getAttribute('href');
  return roleOf(el) === 'link' ? el.getAttribute('href') : null;
}

/** The window's own answer to an agent's call, and a turn's cancel: never
 *  held or named, or the agent could not be answered or stopped. */
function agentOwnRequest(url: string): boolean {
  let path = url;
  try {
    path = new URL(url, location.href).pathname;
  } catch {
    /* the raw text */
  }
  return /^\/api\/assistant\/turn\/[^/]+\/(ui\/[^/]+|cancel)$/.test(path);
}

/** A full press: pointer and mouse down and up, then click. Radix opens a
 *  menu on pointerdown, a plain button acts on click. */
function press(el: Element) {
  const { x, y } = centerOf(el);
  const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y };
  const pointer = { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true };
  el.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, button: 0, buttons: 1 }));
  el.dispatchEvent(new MouseEvent('mousedown', { ...base, button: 0, buttons: 1 }));
  if (el instanceof HTMLElement) el.focus({ preventScroll: true });
  el.dispatchEvent(new PointerEvent('pointerup', { ...pointer, button: 0, buttons: 0 }));
  el.dispatchEvent(new MouseEvent('mouseup', { ...base, button: 0, buttons: 0 }));
  el.dispatchEvent(new MouseEvent('click', { ...base, button: 0, buttons: 0 }));
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, v: string) {
  const proto = Object.getPrototypeOf(el) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, v);
  else el.value = v;
}

/** What a field holds now: its value, or a rich-text field's text. */
function fieldText(el: Element): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value;
  if (el instanceof HTMLElement && el.isContentEditable) return el.textContent ?? '';
  return '';
}

/** Type text the way a paste lands: the value changes and React hears an
 *  input event. No key events, so Enter never submits or sends. The text
 *  goes after what the field holds, with the caret at the end; `replace`
 *  puts it in place of all of it. Exported for its tests. */
export function typeInto(el: Element, text: string, replace: boolean): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (el.readOnly || el.disabled) return false;
    el.focus({ preventScroll: true });
    const clean = el instanceof HTMLInputElement ? text.replace(/[\r\n]+/g, ' ') : text;
    const next = replace ? clean : el.value + clean;
    setNativeValue(el, next);
    try {
      el.setSelectionRange(next.length, next.length);
    } catch {
      /* a field type with no caret (email, number) */
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  if (el instanceof HTMLElement && el.isContentEditable) {
    el.focus({ preventScroll: true });
    if (replace) {
      document.execCommand('selectAll');
    } else {
      // The caret at the end of the field, so the text is added after it.
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    return document.execCommand('insertText', false, text);
  }
  return false;
}

let hands: AgentHands | null = null;

/** This window's one controller. */
export function agentHands(): AgentHands {
  if (!hands) {
    const made = new AgentHands();
    hands = made;
    // A login switch or sign-out never runs while the agent drives: its
    // control is data-agent-risk, and this is the second line (the switch
    // writes the device's login list before any request the guard sees).
    setLoginChangeGuard(() => made.drivingNow());
  }
  return hands;
}
