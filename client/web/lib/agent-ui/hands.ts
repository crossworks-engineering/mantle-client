/**
 * Agent UI, the hands: one controller per window that runs an agent's
 * actions on the screen while the user watches. Browser only.
 *
 * A session is begun by whoever drives (a scripted lesson, or an in-app
 * agent's turn) and shows the Stop bar (components/agent-ui). The agent
 * acts with the user's own rights, as the user would: its clicks and
 * typing reach the same screens and the same requests a person's do.
 * While a session runs:
 *
 *  - Actions run one at a time. Each moves the agent cursor to its target
 *    first, then acts with real pointer and keyboard-free events, so React
 *    and Radix handlers run as they do for a user.
 *  - It never presses its own controls (`data-agent-host`), a control
 *    marked `data-agent-risk` (sign-out, a login switch),
 *    anything in a confirm (`alertdialog`), or a link out of the app; it
 *    never reads or types in a secret field.
 *  - Any real click or key press by the user outside the agent's controls
 *    pauses the session: actions answer `user_took_over` until `resume`.
 *  - Stop (or Esc) ends it. An action checks after every wait that the
 *    session still runs and is not paused, and answers `stopped` if not.
 *  - A session acts as the login it began as: another tab switching the
 *    login ends it (`window_gone`).
 *
 * The page's requests are only counted (to know when the screen has
 * settled), never changed or held.
 */
import {
  elementRefusal,
  linkRefusal,
  MAX_WAIT_MS,
  refuse,
  safeAgentRoute,
  type AgentRefusal,
  type AgentResult,
  type AgentTarget,
  type Screen,
} from './model';
import { setLoginChangeGuard } from '@mantle/web-ui/login-change-guard';
import { currentLoginKey, isLoginStorageKey, loginChangedFrom } from './login-pin';
import { centerOf, factsOf, findByName, findTarget, readScreen, roleOf } from './dom';

export type ConsentAsk = { agent: string; answer: (allow: boolean) => void };

export type HandsState = {
  active: boolean;
  /** An in-app agent asks to use this window (lib/agent-ui/turn-calls). */
  consent: ConsentAsk | null;
  /** An in-app agent's turn asks, at its first click, type or select,
   *  whether it may act in this window for the rest of the turn. */
  turnAsk: ConsentAsk | null;
  agent: string;
  paused: boolean;
  cursor: { x: number; y: number } | null;
  /** The control pointed at; the overlay follows it as the page moves. */
  spotlight: { el: Element; caption: string } | null;
};

const IDLE: HandsState = {
  active: false,
  consent: null,
  turnAsk: null,
  agent: '',
  paused: false,
  cursor: null,
  spotlight: null,
};

/** How long the cursor takes to reach a target before acting. */
const CURSOR_MS = 350;
/** The screen counts as settled once no request has been open this long. */
const QUIET_MS = 250;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class AgentHands {
  private state: HandsState = IDLE;
  private listeners = new Set<(s: HandsState) => void>();
  private refs = new Map<string, Element>();
  private queue: Promise<unknown> = Promise.resolve();
  private navigate: ((path: string) => void) | null = null;
  private realFetch: typeof fetch | null = null;
  /** The counting wrapper this controller put on `window.fetch`, so it
   *  only takes off its own. */
  private wrapper: typeof fetch | null = null;
  private inflight = 0;
  private lastRequestAt = 0;
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
  /** When the in-app agent's current call expires (epoch ms): an action it
   *  queued that only starts after that is not run (`window_gone`). */
  private callExpiresAt: number | null = null;

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

  /** Start a session for `agent`, acting as `login` (default: who is signed
   *  in now). On a session that runs already it only takes the new name:
   *  one the user took over stays paused until they say go on. */
  begin(agent: string, opts: { login?: string | null } = {}): void {
    const name = agent.slice(0, 60) || 'The agent';
    if (this.state.active) {
      this.set({ agent: name });
      return;
    }
    this.stopped = false;
    this.endedBy = null;
    this.generation += 1;
    this.pinnedLogin = opts.login !== undefined ? opts.login : currentLoginKey();
    this.wrapFetch();
    window.addEventListener('pointerdown', this.onUserInput, true);
    window.addEventListener('keydown', this.onUserInput, true);
    window.addEventListener('storage', this.onStorage);
    this.set({ ...IDLE, active: true, agent: name });
  }

  /** Stop: the session ends and every open or later action is refused. */
  end(): void {
    if (!this.state.active) return;
    this.stopped = true;
    try {
      window.removeEventListener('pointerdown', this.onUserInput, true);
      window.removeEventListener('keydown', this.onUserInput, true);
      window.removeEventListener('storage', this.onStorage);
    } catch {
      /* the window went */
    }
    this.state.turnAsk?.answer(false);
    this.refs.clear();
    this.set(IDLE);
    if (this.acting === 0) this.unwrapFetch();
  }

  /** End the session and take the counter off now: for a page (or a test)
   *  that is going away. */
  dispose(): void {
    this.end();
    this.unwrapFetch();
  }

  /** The session ended because the login changed (another tab). */
  endedForLoginChange(): boolean {
    return this.endedBy === 'window_gone';
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

  /** Ask whether an in-app agent may act (click, type, select) in this
   *  window for the rest of its turn. Not now, or Stop meanwhile, is a no. */
  askTurn(agent: string): Promise<boolean> {
    this.state.turnAsk?.answer(false);
    return new Promise((resolve) => {
      const ask: ConsentAsk = {
        agent: agent.slice(0, 60) || 'The assistant',
        answer: (allow) => {
          if (this.state.turnAsk !== ask) return;
          this.set({ turnAsk: null });
          resolve(allow);
        },
      };
      this.set({ turnAsk: ask });
    });
  }

  /** Run `fn` as one call of an in-app agent, which the brain stops
   *  waiting for at `expiresAt` (in this window's clock): an action it
   *  queued that only starts after that is not run. */
  async withCall<T>(
    _callId: string,
    fn: () => Promise<T>,
    opts: { expiresAt?: number | null } = {},
  ): Promise<T> {
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
   *  answer `window_gone`. */
  endForLoginChange(): void {
    if (!this.state.active) return;
    this.endedBy = 'window_gone';
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

  // ── the screen settling ──────────────────────────────────────────────────

  /** Count the page's requests while a session runs, so an action waits
   *  for the screen to settle. Nothing is changed or held. */
  private wrapFetch() {
    if (this.realFetch) return;
    const real = window.fetch.bind(window);
    this.realFetch = window.fetch;
    this.wrapper = window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      this.inflight += 1;
      this.lastRequestAt = Date.now();
      try {
        return await real(input, init);
      } finally {
        this.inflight -= 1;
        this.lastRequestAt = Date.now();
      }
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
      this.acting += 1;
      try {
        let out: AgentResult<T>;
        try {
          out = await fn(alive);
        } catch (err) {
          return refuse('unsupported', err instanceof Error ? err.message : String(err));
        }
        if (!this.state.active || this.generation !== generation) {
          return refuse(this.endedBy ?? 'stopped');
        }
        if (!out.ok && out.error === 'stopped') return out;
        if (this.state.paused) return refuse('user_took_over');
        return out;
      } finally {
        this.acting -= 1;
        if (this.acting === 0 && !this.state.active) this.unwrapFetch();
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
      action === 'type' ? elementRefusal(factsOf(found.el), action) : pressRefusal(found.el);
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
      const quiet = this.inflight === 0 && Date.now() - this.lastRequestAt >= QUIET_MS;
      const there = !target || 'el' in findTarget(target, this.refs);
      if (quiet && there && ready()) return true;
      await sleep(80);
    }
    return false;
  }
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
 *  with none acts by script, as the user's own press would. */
function hrefOf(el: Element): string | null {
  const link = el.closest('a[href], area[href]');
  if (link) return link.getAttribute('href');
  return roleOf(el) === 'link' ? el.getAttribute('href') : null;
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
    // writes the device's login list before anything else).
    setLoginChangeGuard(() => made.drivingNow());
  }
  return hands;
}
