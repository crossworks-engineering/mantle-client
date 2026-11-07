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

  it('a tagged write after it is not sent, and the session ends', async () => {
    const { AgentHands } = await import('./hands');
    const h = made(new AgentHands());
    h.begin('Lesson', { tag: 'lesson:x' });
    loginNow = 'login:mo';
    await expect(window.fetch('/api/notes', { method: 'POST', body: '{}' })).rejects.toThrow();
    expect(calls).toHaveLength(0);
    expect(h.get().active).toBe(false);
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

describe('a change the user said Not now to', () => {
  it('its next save from this page is asked again, after the session too; Save sends it untagged', async () => {
    const { AgentHands } = await import('./hands');
    const h = made(new AgentHands());
    h.begin('Agent');
    const first = window.fetch('/api/profile/sounds', { method: 'PUT', body: '{"a":1}' });
    (await heldOf(h))!.answer(false);
    await expect(first).rejects.toThrow();
    h.end();
    // The user's own save, untagged, the session over: asked again.
    const again = window.fetch('/api/profile/sounds', { method: 'PUT', body: '{"a":1}' });
    const held = await heldOf(h);
    expect(held?.risk).toBe('unsaved');
    expect((held as unknown as { discard?: unknown }).discard).toBeTypeOf('function');
    held!.answer(true);
    expect((await again).status).toBe(200);
    expect(calls.map((c) => c.tag)).toEqual([null]);
    // Allowed once: the next one goes as ever.
    await window.fetch('/api/profile/sounds', { method: 'PUT', body: '{"a":2}' });
    expect(calls).toHaveLength(2);
    expect(h.get().held).toBeNull();
  });

  it('a write the brain refused and the user said Not now to is asked again too', async () => {
    const { AgentHands } = await import('./hands');
    const h = made(new AgentHands());
    answer = (c) => (c.tag ? refusal() : new Response('{}', { status: 200 }));
    h.begin('Lesson', { tag: 'lesson:x' });
    const first = window.fetch('/api/notes/n1', { method: 'PATCH', body: '{}' });
    (await heldOf(h))!.answer(false);
    await expect(first).rejects.toThrow();
    h.end();
    const again = window.fetch('/api/notes/n1', { method: 'PATCH', body: '{}' });
    expect((await heldOf(h))?.risk).toBe('unsaved');
    h.get().held!.answer(false);
    await expect(again).rejects.toThrow();
    // Another item is not asked about: the user's own write goes as ever.
    expect((await window.fetch('/api/notes/n2', { method: 'PATCH', body: '{}' })).status).toBe(200);
  });

  it('the agent sending it again meets the usual hold, and Allow clears it', async () => {
    const { AgentHands } = await import('./hands');
    const h = made(new AgentHands());
    h.begin('Agent');
    const first = window.fetch('/api/profile/sounds', { method: 'PUT', body: '{}' });
    (await heldOf(h))!.answer(false);
    await expect(first).rejects.toThrow();
    const again = window.fetch('/api/profile/sounds', { method: 'PUT', body: '{}' });
    const held = await heldOf(h);
    expect(held?.risk).toBe('settings');
    held!.answer(true);
    expect((await again).status).toBe(200);
    h.end();
    // Nothing is left to ask about.
    await window.fetch('/api/profile/sounds', { method: 'PUT', body: '{}' });
    expect(h.get().held).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it('Discard the assistant’s change loads the item again and sends nothing', async () => {
    const { AgentHands } = await import('./hands');
    const h = made(new AgentHands());
    const reload = vi.fn();
    (g.location as Record<string, unknown>).reload = reload;
    h.begin('Agent');
    const first = window.fetch('/api/profile/sounds', { method: 'PUT', body: '{}' });
    (await heldOf(h))!.answer(false);
    await expect(first).rejects.toThrow();
    h.end();
    const again = window.fetch('/api/profile/sounds', { method: 'PUT', body: '{}' });
    const held = (await heldOf(h)) as unknown as { discard: () => void };
    held.discard();
    await expect(again).rejects.toThrow();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
  });
});

describe('the reminder is the item’s', () => {
  it('a Commit (or ⌘S) after Not now to a draft save is asked about too', async () => {
    const { AgentHands, itemOfWrite } = await import('./hands');
    expect(itemOfWrite('/api/pages/p1/draft')).toBe(itemOfWrite('/api/pages/p1/commit'));
    expect(itemOfWrite('https://brain.invalid/api/pages/p1')).toBe('pages/p1');
    expect(itemOfWrite('/api/files/files/f1')).toBe('files/files/f1');
    expect(itemOfWrite('/api/pages/p2/commit')).not.toBe(itemOfWrite('/api/pages/p1/commit'));
    const h = made(new AgentHands());
    answer = (c) => (c.tag ? refusal() : new Response('{}', { status: 200 }));
    h.begin('Agent');
    await h.withCall('0a0a0a0a-0a0a-40a0-80a0-00000000000a', async () => undefined);
    const draft = window.fetch('/api/pages/p1/draft', { method: 'PUT', body: '{"doc":{}}' });
    (await heldOf(h))!.answer(false);
    await expect(draft).rejects.toThrow();
    h.end();
    const commit = window.fetch('/api/pages/p1/commit', { method: 'POST', body: '{"doc":{}}' });
    const held = await heldOf(h);
    expect(held?.risk).toBe('unsaved');
    held!.answer(false);
    await expect(commit).rejects.toThrow();
    expect(calls.filter((c) => c.url.includes('/commit'))).toHaveLength(0);
  });

  it('after Discard, no write to the item leaves, fetch or beacon, while the page loads again', async () => {
    const { AgentHands } = await import('./hands');
    const h = made(new AgentHands());
    const reload = vi.fn();
    (g.location as Record<string, unknown>).reload = reload;
    const beacons: string[] = [];
    vi.stubGlobal('navigator', {
      sendBeacon: (url: string) => {
        beacons.push(url);
        return true;
      },
    });
    h.begin('Agent');
    const first = window.fetch('/api/pages/p1/publish', { method: 'POST', body: '{}' });
    (await heldOf(h))!.answer(false);
    await expect(first).rejects.toThrow();
    h.end();
    const save = window.fetch('/api/pages/p1/draft', { method: 'PUT', body: '{}' });
    ((await heldOf(h)) as unknown as { discard: () => void }).discard();
    await expect(save).rejects.toThrow();
    expect(reload).toHaveBeenCalledTimes(1);
    // The leave flush on the way out: refused, and nobody is asked.
    await expect(
      window.fetch('/api/pages/p1/draft', { method: 'PUT', body: '{}' }),
    ).rejects.toThrow();
    await expect(
      window.fetch('/api/pages/p1/commit', { method: 'POST', body: '{}' }),
    ).rejects.toThrow();
    expect(h.get().held).toBeNull();
    expect(navigator.sendBeacon('/api/pages/p1/draft', '{}')).toBe(false);
    expect(h.beaconRefused('/api/pages/p1/draft')).toBe(true);
    // Another item goes as ever.
    expect((await window.fetch('/api/pages/p2/draft', { method: 'PUT', body: '{}' })).status).toBe(
      200,
    );
    expect(navigator.sendBeacon('/api/pages/p2/draft', '{}')).toBe(true);
    expect(calls.map((c) => c.url)).toEqual(['/api/pages/p2/draft']);
    expect(beacons).toEqual(['/api/pages/p2/draft']);
    vi.unstubAllGlobals();
  });
});

describe('a Discard whose reload is cancelled', () => {
  it('opens the item again about 2 s later, says so, and the next save asks first', async () => {
    const { AgentHands } = await import('./hands');
    const h = made(new AgentHands());
    (g.document as Record<string, unknown>).hasFocus = () => true;
    // A leave guard asks, and the user says Stay: reload() comes back.
    const reload = vi.fn(() => {
      const ask = new Event('beforeunload', { cancelable: true });
      ask.preventDefault();
      window.dispatchEvent(ask);
    });
    (g.location as Record<string, unknown>).reload = reload;
    h.begin('Agent');
    const first = window.fetch('/api/pages/p1/publish', { method: 'POST', body: '{}' });
    (await heldOf(h))!.answer(false);
    await expect(first).rejects.toThrow();
    h.end();
    const save = window.fetch('/api/pages/p1/draft', { method: 'PUT', body: '{}' });
    ((await heldOf(h)) as unknown as { discard: () => void }).discard();
    // Shut at once: a write right behind the answer opens no new question.
    const behind = window.fetch('/api/pages/p1/draft', { method: 'PUT', body: '{}' });
    await expect(save).rejects.toThrow();
    await expect(behind).rejects.toThrow();
    expect(h.get().held).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);

    await new Promise((r) => setTimeout(r, 2100));
    expect(h.get().note).toBe("The page didn't reload. Your unsaved change is still here.");
    // The reminder stands: the next save asks, and Save sends it.
    const again = window.fetch('/api/pages/p1/draft', { method: 'PUT', body: '{}' });
    const held = await heldOf(h);
    expect(held?.risk).toBe('unsaved');
    held!.answer(true);
    expect((await again).status).toBe(200);
    expect(calls.map((c) => c.url)).toEqual(['/api/pages/p1/draft']);
  });

  it('a reload no guard asked about keeps the item shut', async () => {
    const { AgentHands } = await import('./hands');
    const h = made(new AgentHands());
    (g.document as Record<string, unknown>).hasFocus = () => true;
    (g.location as Record<string, unknown>).reload = vi.fn();
    h.begin('Agent');
    const first = window.fetch('/api/pages/p1/publish', { method: 'POST', body: '{}' });
    (await heldOf(h))!.answer(false);
    await expect(first).rejects.toThrow();
    h.end();
    const save = window.fetch('/api/pages/p1/draft', { method: 'PUT', body: '{}' });
    ((await heldOf(h)) as unknown as { discard: () => void }).discard();
    await expect(save).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 2100));
    await expect(
      window.fetch('/api/pages/p1/draft', { method: 'PUT', body: '{}' }),
    ).rejects.toThrow();
    expect(h.get().held).toBeNull();
    expect(h.get().note).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('a Discard after the agent saved the draft', () => {
  const ITEMS = [
    { kind: 'pages', save: { method: 'PUT', path: '/api/pages/p1/draft' } },
    { kind: 'tables', save: { method: 'POST', path: '/api/tables/t1/draft-ops' } },
    { kind: 'draws', save: { method: 'PUT', path: '/api/draws/d1/draft' } },
  ] as const;

  it.each(ITEMS)(
    '$kind: the draft goes back to the last commit, untagged, before the page loads again',
    async ({ save }) => {
      const { AgentHands } = await import('./hands');
      const h = made(new AgentHands());
      const reload = vi.fn();
      (g.location as Record<string, unknown>).reload = reload;
      const item = save.path.replace(/\/(draft|draft-ops)$/, '');
      h.begin('Lesson', { tag: 'lesson:x' });
      // The agent's draft save goes through (the brain allows it).
      await window.fetch(save.path, { method: save.method, body: '{}' });
      // Its Commit is held, and the user says Not now.
      const commit = window.fetch(`${item}/commit`, { method: 'POST', body: '{}' });
      (await heldOf(h))!.answer(false);
      await expect(commit).rejects.toThrow();
      h.end();
      // The user's own save asks, and says the whole draft goes.
      const mine = window.fetch(save.path, { method: save.method, body: '{}' });
      const held = (await heldOf(h)) as unknown as { wipesDraft?: boolean; discard: () => void };
      expect(held.wipesDraft).toBe(true);
      held.discard();
      await expect(mine).rejects.toThrow();
      await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      expect(calls.map((c) => [c.method, c.url, c.tag])).toEqual([
        [save.method, save.path, 'lesson:x'],
        ['POST', `${item}/discard-draft`, null],
      ]);
      // And nothing more goes to the item while the page loads again.
      await expect(window.fetch(save.path, { method: save.method, body: '{}' })).rejects.toThrow();
      expect(calls).toHaveLength(2);
    },
  );

  it('with no draft of the agent’s, Discard only loads the page again', async () => {
    const { AgentHands } = await import('./hands');
    const h = made(new AgentHands());
    const reload = vi.fn();
    (g.location as Record<string, unknown>).reload = reload;
    h.begin('Agent');
    const first = window.fetch('/api/pages/p1/commit', { method: 'POST', body: '{}' });
    (await heldOf(h))!.answer(false);
    await expect(first).rejects.toThrow();
    h.end();
    const mine = window.fetch('/api/pages/p1/draft', { method: 'PUT', body: '{}' });
    const held = (await heldOf(h)) as unknown as { wipesDraft?: boolean; discard: () => void };
    expect(held.wipesDraft).toBeUndefined();
    held.discard();
    await expect(mine).rejects.toThrow();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
  });

  it('a discard-draft that fails changes nothing and says so', async () => {
    const { AgentHands } = await import('./hands');
    const h = made(new AgentHands());
    const reload = vi.fn();
    (g.location as Record<string, unknown>).reload = reload;
    answer = (c) =>
      c.url.endsWith('/discard-draft')
        ? new Response('{}', { status: 500 })
        : new Response('{}', { status: 200 });
    h.begin('Lesson', { tag: 'lesson:x' });
    await window.fetch('/api/pages/p1/draft', { method: 'PUT', body: '{}' });
    const commit = window.fetch('/api/pages/p1/commit', { method: 'POST', body: '{}' });
    (await heldOf(h))!.answer(false);
    await expect(commit).rejects.toThrow();
    h.end();
    const mine = window.fetch('/api/pages/p1/draft', { method: 'PUT', body: '{}' });
    ((await heldOf(h)) as unknown as { discard: () => void }).discard();
    await expect(mine).rejects.toThrow();
    await vi.waitFor(() =>
      expect(h.get().note).toBe(
        'The draft could not be thrown away, so nothing was changed. Try again.',
      ),
    );
    expect(reload).not.toHaveBeenCalled();
    // Not shut: the next save asks again.
    const again = window.fetch('/api/pages/p1/draft', { method: 'PUT', body: '{}' });
    expect((await heldOf(h))?.risk).toBe('unsaved');
    h.get().held!.answer(false);
    await expect(again).rejects.toThrow();
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
