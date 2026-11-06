import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

afterEach(() => {
  for (const k of GLOBALS) g[k] = saved[k];
  vi.useRealTimers();
});

const refusal = () =>
  new Response(JSON.stringify({ error: 'agent_refused', reason: 'settings' }), {
    status: 403,
    headers: { 'content-type': 'application/json' },
  });

async function heldOf(h: { get: () => { held: unknown } }) {
  for (let i = 0; i < 50 && !h.get().held; i++) await new Promise((r) => setTimeout(r, 5));
  return h.get().held as { risk: string; answer: (allow: boolean) => void } | null;
}

describe('the request guard and the brain’s refusal', () => {
  it('holds a tagged write the brain refused, and on Allow sends it once untagged', async () => {
    const { AgentHands } = await import('./hands');
    const h = new AgentHands();
    answer = (c) => (c.tag ? refusal() : new Response('{"ok":true}', { status: 201 }));
    h.begin('Lesson', { tag: 'lesson:0a0a0a0a-0a0a-40a0-80a0-000000000001' });
    const sent = window.fetch('/api/notes', { method: 'POST', body: '{"title":"x"}' });
    const held = await heldOf(h);
    expect(held?.risk).toBe('refused');
    expect((held as unknown as { reason: string }).reason).toBe('settings');
    held!.answer(true);
    const res = await sent;
    expect(res.status).toBe(201);
    expect(calls.map((c) => c.tag)).toEqual(['lesson:0a0a0a0a-0a0a-40a0-80a0-000000000001', null]);
    h.end();
  });

  it('Not now sends nothing more', async () => {
    const { AgentHands } = await import('./hands');
    const h = new AgentHands();
    answer = (c) => (c.tag ? refusal() : new Response('{}', { status: 201 }));
    h.begin('Agent');
    await h.withCall('0a0a0a0a-0a0a-40a0-80a0-000000000002', async () => undefined);
    const sent = window.fetch('/api/notes', { method: 'POST', body: '{}' });
    const held = await heldOf(h);
    held!.answer(false);
    await expect(sent).rejects.toThrow(/did not allow/);
    expect(calls).toHaveLength(1);
    h.end();
  });

  it('never tags background bookkeeping: a frame ticket, an open counted', async () => {
    const { AgentHands } = await import('./hands');
    const h = new AgentHands();
    h.begin('Lesson', { tag: 'lesson:x' });
    await window.fetch('/api/apps/a1/frame-ticket', { method: 'POST' });
    await window.fetch('/api/tree/items/i1/opened', { method: 'POST' });
    await window.fetch('/api/notes', { method: 'POST', body: '{}' });
    expect(calls.map((c) => c.tag)).toEqual([null, null, 'lesson:x']);
    h.end();
  });

  it('a 403 that is not the brain’s refusal is the page’s own answer', async () => {
    const { AgentHands } = await import('./hands');
    const h = new AgentHands();
    answer = () => new Response('{"error":"forbidden"}', { status: 403 });
    h.begin('Lesson', { tag: 'lesson:x' });
    const res = await window.fetch('/api/notes', { method: 'POST', body: '{}' });
    expect(res.status).toBe(403);
    expect(h.get().held).toBeNull();
    expect(calls).toHaveLength(1);
    h.end();
  });

  it('holds a percent-encoded risky path before it is sent', async () => {
    const { AgentHands } = await import('./hands');
    const h = new AgentHands();
    h.begin('Agent');
    const sent = window.fetch('/api/%73hares', { method: 'POST', body: '{}' });
    const held = await heldOf(h);
    expect(held?.risk).toBe('share');
    held!.answer(false);
    await expect(sent).rejects.toThrow();
    expect(calls).toHaveLength(0);
    h.end();
  });

  it('a request an action sets off is checked though the action ended the session', async () => {
    const { AgentHands } = await import('./hands');
    const h = new AgentHands();
    h.begin('Agent');
    let caught: unknown = null;
    control.addEventListener('click', () => {
      // The click's handler: the user's Stop lands, then the page deletes.
      h.end();
      window.fetch('/api/tasks/1', { method: 'DELETE' }).catch((e: unknown) => (caught = e));
    });
    const out = await h.click({ id: 'delete-task' });
    expect(out).toMatchObject({ ok: false, error: 'stopped' });
    expect(caught).toBeInstanceOf(TypeError);
    expect(calls).toHaveLength(0);
  });
});

describe('Stop really stops', () => {
  it('Stop while the cursor travels: nothing is pressed, the answer is stopped', async () => {
    const { AgentHands } = await import('./hands');
    const h = new AgentHands();
    h.begin('Agent');
    const out = h.click({ id: 'add' });
    await new Promise((r) => setTimeout(r, 100));
    h.end();
    expect(await out).toMatchObject({ ok: false, error: 'stopped' });
    expect(control.dispatched).not.toContain('click');
  });

  it('a lesson begun on a session the user took over leaves it paused', async () => {
    const { AgentHands } = await import('./hands');
    const h = new AgentHands();
    h.begin('Agent');
    // The user's own click (a trusted event) pauses it.
    const onInput = (h as unknown as { onUserInput: (e: Event) => void }).onUserInput;
    onInput({ isTrusted: true, target: null } as unknown as Event);
    expect(h.get().paused).toBe(true);
    h.begin('A lesson', { tag: 'lesson:x' });
    expect(h.get().paused).toBe(true);
    expect(await h.screen()).toMatchObject({ ok: false, error: 'user_took_over' });
    h.end();
  });
});

describe('links stay in the app', () => {
  it('a click on a link to another origin or a refused route is unsafe_route', async () => {
    const { AgentHands } = await import('./hands');
    const h = new AgentHands();
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
