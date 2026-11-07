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
  for (const h of live.splice(0)) h.dispose();
  (await import('./hands')).agentHands().dispose();
  for (const k of GLOBALS) g[k] = saved[k];
  vi.useRealTimers();
});

const refusal = () =>
  new Response(JSON.stringify({ error: 'agent_refused', reason: 'settings' }), {
    status: 403,
    headers: { 'content-type': 'application/json' },
  });

async function heldOf(h: { get: () => { held: unknown } }) {
  for (let i = 0; i < 100 && !h.get().held; i++) await new Promise((r) => setTimeout(r, 10));
  return h.get().held as { risk: string; answer: (allow: boolean) => void } | null;
}

describe('the request guard and the brain’s refusal', () => {
  it('holds a tagged write the brain refused, and on Allow sends it once untagged', async () => {
    const { AgentHands } = await import('./hands');
    const h = made(new AgentHands());
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
    const h = made(new AgentHands());
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
    const h = made(new AgentHands());
    h.begin('Lesson', { tag: 'lesson:x' });
    await window.fetch('/api/apps/a1/frame-ticket', { method: 'POST' });
    await window.fetch('/api/tree/items/i1/opened', { method: 'POST' });
    await window.fetch('/api/notes', { method: 'POST', body: '{}' });
    expect(calls.map((c) => c.tag)).toEqual([null, null, 'lesson:x']);
    h.end();
  });

  it('a 403 that is not the brain’s refusal is the page’s own answer', async () => {
    const { AgentHands } = await import('./hands');
    const h = made(new AgentHands());
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
    const h = made(new AgentHands());
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
    const h = made(new AgentHands());
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

/** A stand-in XMLHttpRequest that answers like the fake fetch. */
function fakeXhr() {
  return class {
    status = 0;
    statusText = '';
    responseText = '';
    responseType = '';
    withCredentials = false;
    upload: Record<string, unknown> = {};
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    private url = '';
    private headers: Record<string, string> = {};
    open(_m: string, url: string) {
      this.url = url;
    }
    setRequestHeader(k: string, v: string) {
      this.headers[k.toLowerCase()] = v;
    }
    abort() {}
    send() {
      const call: Call = {
        url: this.url,
        method: 'POST',
        tag: this.headers['x-mantle-agent-call'] ?? null,
      };
      calls.push(call);
      const res = answer(call);
      void res.text().then((text) => {
        this.status = res.status;
        this.responseText = text;
        this.onload?.();
      });
    }
  };
}

describe('XHR uploads meet the same guard', () => {
  it('an upload the agent sets off is tagged; a refused one is held and re-sent untagged', async () => {
    g.XMLHttpRequest = fakeXhr();
    const hands = (await import('./hands')).agentHands();
    const { xhrUpload } = await import('../xhr-upload');
    answer = (c) => (c.tag ? refusal() : new Response('{"ok":true}', { status: 201 }));
    hands.begin('Lesson', { tag: 'lesson:x' });
    const sent = xhrUpload({ url: '/api/files/files', form: new FormData() });
    const held = await heldOf(hands);
    expect(held?.risk).toBe('refused');
    held!.answer(true);
    expect(await sent).toEqual({ ok: true });
    expect(calls.map((c) => c.tag)).toEqual(['lesson:x', null]);
    hands.end();
  });

  it('a risky upload waits for the user; Not now sends nothing', async () => {
    g.XMLHttpRequest = fakeXhr();
    const hands = (await import('./hands')).agentHands();
    const { xhrUpload, UploadAbortedError } = await import('../xhr-upload');
    hands.begin('Agent');
    const form = new FormData();
    form.set('folderId', 'f1');
    const sent = xhrUpload({ url: '/api/files/files', form });
    const held = await heldOf(hands);
    expect(held?.risk).toBe('move');
    held!.answer(false);
    await expect(sent).rejects.toBeInstanceOf(UploadAbortedError);
    expect(calls).toHaveLength(0);
    hands.end();
  });

  it('with no session an upload goes as ever, untagged', async () => {
    g.XMLHttpRequest = fakeXhr();
    const { xhrUpload } = await import('../xhr-upload');
    answer = () => new Response('{"id":"f"}', { status: 201 });
    expect(await xhrUpload({ url: '/api/files/files', form: new FormData() })).toEqual({
      id: 'f',
    });
    expect(calls.map((c) => c.tag)).toEqual([null]);
  });
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

describe('a supersede cancel the agent sets off', () => {
  it('is held, though a plain cancel is the window’s own', async () => {
    const { AgentHands } = await import('./hands');
    const h = made(new AgentHands());
    h.begin('Agent');
    await window.fetch('/api/assistant/turn/t1/cancel', { method: 'POST' });
    expect(h.get().held).toBeNull();
    const sent = window.fetch('/api/assistant/turn/t1/cancel', {
      method: 'POST',
      body: '{"supersede":{"inboundId":"a","outboundId":"b","newTurnId":"k"}}',
    });
    const held = await heldOf(h);
    expect(held?.risk).toBe('send');
    held!.answer(false);
    await expect(sent).rejects.toThrow();
    expect(calls).toHaveLength(1);
    h.end();
  });
});

describe('ui_type with replace', () => {
  it('on a field that holds something waits for the user; on an empty one it does not', async () => {
    const { AgentHands } = await import('./hands');
    const h = made(new AgentHands());
    const input = new FakeInput();
    g.document = { querySelectorAll: () => [input] };
    h.begin('Agent');
    input.value = 'Keep me';
    const typing = h.type({ id: 'title' }, 'New', { replace: true });
    const held = await heldOf(h);
    expect(held?.risk).toBe('replace');
    held!.answer(false);
    expect(await typing).toMatchObject({ ok: false, error: 'needs_user' });
    expect(input.value).toBe('Keep me');

    input.value = '';
    expect(await h.type({ id: 'title' }, 'New', { replace: true })).toEqual({ ok: true });
    expect(input.value).toBe('New');
    h.end();
  });
});

describe('a multipart write the brain refuses', () => {
  it('a fetch with FormData is held and sent again untagged on Allow', async () => {
    const { AgentHands } = await import('./hands');
    const h = made(new AgentHands());
    answer = (c) => (c.tag ? refusal() : new Response('{"ok":true}', { status: 201 }));
    h.begin('Lesson', { tag: 'lesson:x' });
    const form = new FormData();
    form.set('file', new Blob(['x']), 'x.txt');
    const sent = window.fetch('/api/files/files', { method: 'POST', body: form });
    const held = await heldOf(h);
    expect(held?.risk).toBe('refused');
    held!.answer(true);
    expect((await sent).status).toBe(201);
    expect(calls.map((c) => c.tag)).toEqual(['lesson:x', null]);
    h.end();
  });
});

describe('late writes of the last action', () => {
  it('after Stop, a write within 2 s is still tagged; after that it is not', async () => {
    const { AgentHands } = await import('./hands');
    const h = made(new AgentHands());
    h.begin('Lesson', { tag: 'lesson:late' });
    expect(await h.click({ id: 'add' })).toEqual({ ok: true });
    vi.useFakeTimers({ now: Date.now(), toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    h.end();
    await window.fetch('/api/notes', { method: 'POST', body: '{}' });
    // A risky one has nobody to ask any more: it is not sent, and a host
    // note says so.
    await expect(window.fetch('/api/tasks/1', { method: 'DELETE' })).rejects.toThrow();
    expect(h.get().note).toBe("Lesson's last action tried to delete something; not sent.");
    vi.advanceTimersByTime(2100);
    await window.fetch('/api/notes', { method: 'POST', body: '{}' });
    expect(calls.map((c) => c.tag)).toEqual(['lesson:late', null]);
  });

  it('after the user takes over, a write within 2 s is tagged and a risky one held', async () => {
    const { AgentHands } = await import('./hands');
    const h = made(new AgentHands());
    h.begin('Agent');
    await h.withCall('0a0a0a0a-0a0a-40a0-80a0-000000000009', () => h.click({ id: 'add' }));
    const onInput = (h as unknown as { onUserInput: (e: Event) => void }).onUserInput;
    onInput({ isTrusted: true, target: null } as unknown as Event);
    expect(h.get().paused).toBe(true);
    await window.fetch('/api/notes', { method: 'POST', body: '{}' });
    const deleting = window.fetch('/api/tasks/1', { method: 'DELETE' });
    const held = await heldOf(h);
    expect(held?.risk).toBe('delete');
    held!.answer(false);
    await expect(deleting).rejects.toThrow();
    expect(calls.map((c) => c.tag)).toEqual(['0a0a0a0a-0a0a-40a0-80a0-000000000009']);
    h.end();
  });
});

describe('a late write the brain refuses after Stop', () => {
  it('shows a note, not the raw 403', async () => {
    const { AgentHands } = await import('./hands');
    const h = made(new AgentHands());
    answer = (c) => (c.tag ? refusal() : new Response('{}', { status: 201 }));
    h.begin('Saskia', { tag: 'lesson:x' });
    expect(await h.click({ id: 'add' })).toEqual({ ok: true });
    h.end();
    await expect(window.fetch('/api/notes', { method: 'POST', body: '{}' })).rejects.toThrow(
      /^Not sent/,
    );
    expect(h.get().note).toBe("Saskia's last action tried to change a setting; not sent.");
    expect(calls).toHaveLength(1);
    h.dismissNote();
    expect(h.get().note).toBeNull();
  });

  it('a release after the window has gone does not throw', async () => {
    const { AgentHands } = await import('./hands');
    const h = made(new AgentHands());
    h.begin('Agent');
    expect(await h.click({ id: 'add' })).toEqual({ ok: true });
    vi.useFakeTimers({ now: Date.now(), toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    h.end();
    const win = g.window;
    g.window = undefined;
    expect(() => vi.advanceTimersByTime(2100)).not.toThrow();
    g.window = win;
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
    h.begin('A lesson', { tag: 'lesson:x' });
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
