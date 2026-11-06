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
  linkRefusal,
  MAX_WAIT_MS,
  refuse,
  riskOfRequest,
  safeAgentRoute,
  type AgentRefusal,
  type AgentResult,
  type AgentTarget,
  type RequestRisk,
  type Screen,
} from './model';
import { centerOf, factsOf, findByName, findTarget, readScreen, roleOf } from './dom';

export type HeldRequest = {
  id: number;
  risk: RequestRisk;
  method: string;
  path: string;
  /** The user's answer. */
  answer: (allow: boolean) => void;
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
};

const IDLE: HandsState = {
  active: false,
  consent: null,
  agent: '',
  paused: false,
  cursor: null,
  spotlight: null,
  held: null,
};

/** How long the cursor takes to reach a target before acting. */
const CURSOR_MS = 350;
/** The screen counts as settled once no request has been open this long. */
const QUIET_MS = 250;
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
  /** Bumped by every new session, so an action of an ended one cannot go
   *  on in the next. */
  private generation = 0;
  /** Actions running now (0 or 1: they are queued). */
  private acting = 0;
  /** What the agent's writes are tagged with (`x-mantle-agent-call`): the
   *  in-app agent's last call, or the lesson's `lesson:<uuid>`. The brain
   *  refuses a risky write that carries it (fix round contract). */
  private callTag: string | null = null;

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
  begin(agent: string, opts: { tag?: string } = {}): void {
    const name = agent.slice(0, 60) || 'The agent';
    if (this.state.active) {
      if (opts.tag) this.callTag = opts.tag;
      this.set({ agent: name });
      return;
    }
    this.stopped = false;
    this.generation += 1;
    this.callTag = opts.tag ?? null;
    this.wrapFetch();
    window.addEventListener('pointerdown', this.onUserInput, true);
    window.addEventListener('keydown', this.onUserInput, true);
    this.set({ ...IDLE, active: true, agent: name });
  }

  /** Stop: the session ends and every open or later action is refused. An
   *  action still running keeps the request guard until it returns. */
  end(): void {
    if (!this.state.active) return;
    this.stopped = true;
    window.removeEventListener('pointerdown', this.onUserInput, true);
    window.removeEventListener('keydown', this.onUserInput, true);
    this.state.held?.answer(false);
    this.refs.clear();
    this.set(IDLE);
    if (this.acting === 0) this.release();
  }

  /** The guard and the tag go once no session runs and no action does. */
  private release() {
    this.unwrapFetch();
    this.callTag = null;
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
  async withCall<T>(callId: string, fn: () => Promise<T>): Promise<T> {
    this.callTag = callId;
    return fn();
  }

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

  private wrapFetch() {
    if (this.realFetch) return;
    const real = window.fetch.bind(window);
    this.realFetch = window.fetch;
    const send = async (input: RequestInfo | URL, init?: RequestInit) => {
      this.inflight += 1;
      this.lastRequestAt = Date.now();
      try {
        return await real(input, init);
      } finally {
        this.inflight -= 1;
        this.lastRequestAt = Date.now();
      }
    };
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (
        init?.method ?? (input instanceof Request ? input.method : 'GET')
      ).toUpperCase();
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      // The agent's: sent while it drives, or while one of its actions runs
      // (the user may have paused or stopped it on the way).
      const agents =
        !agentOwnRequest(url) && (this.acting > 0 || (this.state.active && !this.state.paused));
      const risk = agents
        ? riskOfRequest(method, url, typeof init?.body === 'string' ? init.body : undefined)
        : null;
      let userAllowed = false;
      if (risk) {
        // Stopped mid-action: nobody is asked, nothing is sent.
        const allowed = this.state.active ? await this.ask(risk, method, url) : false;
        if (!allowed) {
          this.blockedSinceAction = true;
          throw new TypeError('Blocked: the user did not allow this request.');
        }
        userAllowed = true;
      }
      // A write the agent set off carries its tag, unless the user allowed
      // it: the brain refuses a risky one that is tagged.
      const tag =
        agents && !userAllowed && method !== 'GET' && method !== 'HEAD' ? this.callTag : null;
      if (!tag) return send(input, init);
      // A Request's body is read once: keep a copy for a resend.
      const spare = input instanceof Request ? input.clone() : null;
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      headers.set(AGENT_CALL_HEADER, tag);
      const res = await send(input, { ...init, headers });
      if (res.status !== 403) return res;
      let body: unknown = null;
      try {
        body = await res.clone().json();
      } catch {
        /* not the brain's refusal */
      }
      if (!isAgentRefusal(res.status, body) || !this.state.active) return res;
      // The brain refused it as the agent's: the user's step, held like a
      // risky write. Allow sends it once more as the user's own, untagged.
      if (!(await this.ask('refused', method, url))) {
        this.blockedSinceAction = true;
        throw new TypeError('Blocked: the user did not allow this request.');
      }
      headers.delete(AGENT_CALL_HEADER);
      return send(spare ?? input, { ...init, headers });
    };
  }

  private unwrapFetch() {
    if (this.realFetch) window.fetch = this.realFetch;
    this.realFetch = null;
  }

  private ask(risk: RequestRisk, method: string, url: string): Promise<boolean> {
    // One question at a time: a second risky request while one waits is
    // refused rather than stacked behind it.
    if (this.state.held) return Promise.resolve(false);
    let path = url;
    try {
      path = new URL(url, location.href).pathname;
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
      this.set({ held: { id, risk, method, path: path.slice(0, 200), answer } });
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
    const next = this.queue.then(async () => {
      if (!this.state.active) return refuse(this.stopped ? 'stopped' : 'no_session');
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
        if (!this.state.active || this.generation !== generation) return refuse('stopped');
        if (!out.ok && out.error === 'stopped') return out;
        if (this.state.paused) return refuse('user_took_over');
        if (out.ok && this.blockedSinceAction) return refuse('needs_user');
        return out;
      } finally {
        this.acting -= 1;
        if (this.acting === 0 && !this.state.active) this.release();
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
  hands ??= new AgentHands();
  return hands;
}
