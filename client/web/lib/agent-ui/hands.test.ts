import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Who the window is signed in as, as the login pin reads it: a test
 *  changes it to play another tab switching the login. */
let loginNow: string | null = 'login:ada';
vi.mock('./login-pin', async (orig) => ({
  ...(await orig<typeof import('./login-pin')>()),
  currentLoginKey: () => loginNow,
}));

/**
 * The hands in a node run: no DOM, so the few globals they touch are
 * stood in for here (a window with a fetch, a location, the event
 * classes), and the controls are small fakes.
 */

type Call = { url: string; method: string; tag: string | null };

const g = globalThis as unknown as Record<string, unknown>;
const saved: Record<string, unknown> = {};
const GLOBALS = [
  'window',
  'location',
  'document',
  'CSS',
  'getComputedStyle',
  'innerWidth',
  'innerHeight',
  'PointerEvent',
  'MouseEvent',
  'HTMLInputElement',
  'HTMLTextAreaElement',
  'HTMLSelectElement',
  'HTMLElement',
  'XMLHttpRequest',
];

class FakeElement extends EventTarget {
  tagName = 'BUTTON';
  isConnected = true;
  attrs: Record<string, string> = {};
  /** What `closest` finds, by the selector's first attribute name. */
  ancestors: Record<string, FakeElement> = {};
  dispatched: string[] = [];
  getAttribute(name: string) {
    return this.attrs[name] ?? null;
  }
  closest(sel: string) {
    for (const [mark, el] of Object.entries(this.ancestors)) if (sel.includes(mark)) return el;
    return null;
  }
  scrollIntoView() {}
  focus() {}
  getBoundingClientRect() {
    return { left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30 };
  }
  override dispatchEvent(e: Event) {
    this.dispatched.push(e.type);
    return super.dispatchEvent(e);
  }
}

class FakeInput extends FakeElement {
  override tagName = 'INPUT';
  value = '';
  type = 'text';
  autocomplete = '';
  readOnly = false;
  disabled = false;
  caret = -1;
  setSelectionRange(a: number) {
    this.caret = a;
  }
}

let calls: Call[] = [];
let answer: (c: Call) => Response;
let control: FakeElement;

beforeEach(() => {
  for (const k of GLOBALS) saved[k] = g[k];
  calls = [];
  answer = () => new Response('{}', { status: 200 });
  const win = new EventTarget() as EventTarget & { fetch: typeof fetch };
  win.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const call: Call = {
      url,
      method: (init?.method ?? 'GET').toUpperCase(),
      tag: new Headers(init?.headers).get('x-mantle-agent-call'),
    };
    calls.push(call);
    return answer(call);
  }) as typeof fetch;
  g.window = win;
  g.location = { href: 'http://app.test/tasks', pathname: '/tasks', origin: 'http://app.test' };
  control = new FakeElement();
  g.document = { querySelectorAll: () => [control] };
  g.CSS = { escape: (s: string) => s };
  g.getComputedStyle = () => ({ visibility: 'visible', display: 'block', opacity: '1' });
  g.innerWidth = 1200;
  g.innerHeight = 800;
  class Ev extends Event {
    constructor(type: string, opts?: EventInit) {
      super(type, opts);
    }
  }
  g.PointerEvent = Ev;
  g.MouseEvent = Ev;
  g.HTMLInputElement = FakeInput;
  g.HTMLTextAreaElement = class {};
  g.HTMLSelectElement = class {};
  g.HTMLElement = FakeElement;
});

/** Every controller a test made, disposed before the window goes: no timer
 *  of theirs (the late-write release, the note) outlives its test. */
const live: { dispose: () => void }[] = [];
function made<T extends { dispose: () => void }>(h: T): T {
  live.push(h);
  return h;
}

afterEach(async () => {
  loginNow = 'login:ada';
  for (const h of live.splice(0)) h.dispose();
  (await import('./hands')).agentHands().dispose();
  for (const k of GLOBALS) g[k] = saved[k];
  vi.useRealTimers();
});

describe('a call past its expiresAt', () => {
  it('an action it queued that starts too late is not run: window_gone', async () => {
    const { AgentHands } = await import('./hands');
    const h = made(new AgentHands());
    h.begin('Agent');
    // The first action holds the queue (its cursor travels for a while).
    const first = h.withCall('c1', () => h.click({ id: 'a' }));
    const late = h.withCall('c2', () => h.click({ id: 'b' }), { expiresAt: Date.now() + 50 });
    expect(await late).toMatchObject({ ok: false, error: 'window_gone' });
    await first;
    h.end();
  });
});

describe('a login change in another tab', () => {
  it('the next action answers window_gone and does nothing', async () => {
    const { AgentHands } = await import('./hands');
    const h = made(new AgentHands());
    h.begin('Agent');
    loginNow = 'login:mo';
    expect(await h.click({ id: 'add' })).toMatchObject({ ok: false, error: 'window_gone' });
    expect(control.dispatched).not.toContain('click');
    expect(h.get().active).toBe(false);
    expect(await h.screen()).toMatchObject({ ok: false, error: 'window_gone' });
  });

  it('the storage event of a login change ends the session at once', async () => {
    const { AgentHands } = await import('./hands');
    const h = made(new AgentHands());
    h.begin('Agent');
    // Another key, nothing changed: the session runs on.
    window.dispatchEvent(Object.assign(new Event('storage'), { key: 'mantle_ui_prefs' }));
    expect(h.get().active).toBe(true);
    loginNow = 'login:mo';
    window.dispatchEvent(Object.assign(new Event('storage'), { key: 'mantle_active_session' }));
    expect(h.get().active).toBe(false);
    expect(await h.screen()).toMatchObject({ ok: false, error: 'window_gone' });
  });

  it('the same login (a rotated bearer) changes nothing', async () => {
    const { AgentHands } = await import('./hands');
    const h = made(new AgentHands());
    h.begin('Agent');
    window.dispatchEvent(Object.assign(new Event('storage'), { key: 'mantle_token' }));
    expect(h.get().active).toBe(true);
    expect(await h.click({ id: 'add' })).toEqual({ ok: true });
    h.end();
  });
});

describe('a session ended by a login change', () => {
  it('says so, so no cancel is sent as the other login', async () => {
    const { AgentHands } = await import('./hands');
    const h = made(new AgentHands());
    h.begin('Agent');
    expect(h.endedForLoginChange()).toBe(false);
    loginNow = 'login:mo';
    h.endForLoginChange();
    expect(h.endedForLoginChange()).toBe(true);
    h.begin('Agent');
    expect(h.endedForLoginChange()).toBe(false);
    h.end();
  });
});

describe('a lesson the user started', () => {
  it('acts without the turn question: its Start is the yes', async () => {
    const { AgentHands } = await import('./hands');
    const h = made(new AgentHands());
    h.begin('Your sounds');
    expect(await h.click({ id: 'add' })).toEqual({ ok: true });
    expect(h.get().turnAsk).toBeNull();
    expect(control.dispatched).toContain('click');
    h.end();
  });

  it('Stop answers a turn question that is still open as Not now', async () => {
    const { AgentHands } = await import('./hands');
    const h = made(new AgentHands());
    h.begin('Agent');
    const asking = h.askTurn('Saskia');
    expect(h.get().turnAsk?.agent).toBe('Saskia');
    h.end();
    expect(await asking).toBe(false);
  });
});

describe('the agent acts with the user’s own rights', () => {
  it('the page’s requests go as they are: counted, never tagged or held', async () => {
    const { AgentHands } = await import('./hands');
    const h = made(new AgentHands());
    h.begin('Agent');
    await h.withCall('0a0a0a0a-0a0a-40a0-80a0-000000000001', async () => undefined);
    await window.fetch('/api/notes', { method: 'POST', body: '{}' });
    await window.fetch('/api/tasks/1', { method: 'DELETE' });
    await window.fetch('/api/profile/sounds', { method: 'PUT', body: '{}' });
    expect(calls.map((c) => [c.method, c.tag])).toEqual([
      ['POST', null],
      ['DELETE', null],
      ['PUT', null],
    ]);
    expect(h.get()).not.toHaveProperty('held');
    h.end();
  });
});

describe('Stop really stops', () => {
  it('Stop while the cursor travels: nothing is pressed, the answer is stopped', async () => {
    const { AgentHands } = await import('./hands');
    const h = made(new AgentHands());
    h.begin('Agent');
    const out = h.click({ id: 'add' });
    await new Promise((r) => setTimeout(r, 100));
    h.end();
    expect(await out).toMatchObject({ ok: false, error: 'stopped' });
    expect(control.dispatched).not.toContain('click');
  });

  it('a lesson begun on a session the user took over leaves it paused', async () => {
    const { AgentHands } = await import('./hands');
    const h = made(new AgentHands());
    h.begin('Agent');
    // The user's own click (a trusted event) pauses it.
    const onInput = (h as unknown as { onUserInput: (e: Event) => void }).onUserInput;
    onInput({ isTrusted: true, target: null } as unknown as Event);
    expect(h.get().paused).toBe(true);
    h.begin('A lesson');
    expect(h.get().paused).toBe(true);
    expect(await h.screen()).toMatchObject({ ok: false, error: 'user_took_over' });
    h.end();
  });
});

describe('links stay in the app', () => {
  it('a click on a link to another origin or a refused route is unsafe_route', async () => {
    const { AgentHands } = await import('./hands');
    const h = made(new AgentHands());
    h.begin('Agent');
    const link = new FakeElement();
    control.ancestors['a[href]'] = link;
    for (const href of ['https://elsewhere.invalid/x', '/login', 'javascript:alert(1)']) {
      link.attrs.href = href;
      expect(await h.click({ id: 'link' })).toMatchObject({ ok: false, error: 'unsafe_route' });
    }
    expect(control.dispatched).not.toContain('click');
    h.end();
  });
});

describe('ui_type', () => {
  it('adds to what a field holds, caret at the end; replace puts it in place', async () => {
    const { typeInto } = await import('./hands');
    const input = new FakeInput();
    input.value = 'Buy ';
    expect(typeInto(input as unknown as Element, 'milk', false)).toBe(true);
    expect(input.value).toBe('Buy milk');
    expect(input.caret).toBe('Buy milk'.length);
    expect(typeInto(input as unknown as Element, 'bread', true)).toBe(true);
    expect(input.value).toBe('bread');
  });

  it('an agent’s ui_type appends unless it says replace: true', async () => {
    const { agentHands } = await import('./hands');
    const { runUiCall } = await import('./turn-calls');
    const spy = vi.spyOn(agentHands(), 'type').mockResolvedValue({ ok: true });
    const target = { role: 'textbox', name: 'Title' };
    await runUiCall({ callId: 'c', action: 'type', args: { target, text: 'x' } });
    await runUiCall({ callId: 'c', action: 'type', args: { target, text: 'x', replace: false } });
    await runUiCall({ callId: 'c', action: 'type', args: { target, text: 'x', replace: true } });
    expect(spy.mock.calls.map((c) => c[2])).toEqual([
      { replace: false },
      { replace: false },
      { replace: true },
    ]);
    spy.mockRestore();
  });
});
