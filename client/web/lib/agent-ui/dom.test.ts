import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SecretInput } from '@mantle/web-ui/ui/secret-input';
import { factsOf, findTarget, isSecretField, isShut, nameOf } from './dom';

/** A stand-in element: a tag, attributes, the ancestors `closest` finds
 *  and the descendants `querySelector` finds (keyed by a piece of the
 *  selector). */
function el(
  tagName: string,
  props: Record<string, unknown> = {},
  ancestors: Record<string, object> = {},
  inside: Record<string, object> = {},
): Element {
  const find = (from: Record<string, object>) => (sel: string) => {
    for (const [mark, a] of Object.entries(from)) if (sel.includes(mark)) return a;
    return null;
  };
  return {
    tagName,
    isConnected: true,
    getAttribute: (n: string) => (props[n] as string | undefined) ?? null,
    closest: find(ancestors),
    querySelector: find(inside),
    ...props,
  } as unknown as Element;
}

// nameOf asks instanceof of these; the stand-ins are none of them.
beforeAll(() => {
  for (const k of ['HTMLInputElement', 'HTMLTextAreaElement', 'HTMLIFrameElement']) {
    vi.stubGlobal(k, class {});
  }
});
afterAll(() => vi.unstubAllGlobals());

describe('secret fields', () => {
  it('a password or one-time code field is secret', () => {
    expect(isSecretField(el('INPUT', { type: 'password' }))).toBe(true);
    expect(isSecretField(el('INPUT', { type: 'text', autocomplete: 'one-time-code' }))).toBe(true);
    expect(isSecretField(el('INPUT', { type: 'text' }))).toBe(false);
    expect(isSecretField(el('TEXTAREA'))).toBe(false);
  });

  it('a revealed SecretInput (type text) stays secret by its data-secret wrapper', () => {
    const wrapper = el('DIV', { 'data-secret': '' });
    const revealed = el('INPUT', { type: 'text' }, { '[data-secret]': wrapper });
    expect(isSecretField(revealed)).toBe(true);
  });

  it('SecretInput wraps its field in data-secret', () => {
    const html = renderToStaticMarkup(createElement(SecretInput, { id: 'k', noun: 'key' }));
    expect(html).toMatch(/^<div data-secret=""[^>]*><input[^>]*id="k"/);
  });

  it('a data-secret field of its own (the invite code, a token) is secret', () => {
    const self = el('INPUT', { type: 'text', readOnly: true });
    const marked = el('INPUT', { type: 'text' }, { '[data-secret]': self });
    expect(isSecretField(marked)).toBe(true);
  });
});

describe('controls behind an open modal', () => {
  it('is shut under aria-hidden or inert', () => {
    expect(isShut(el('BUTTON', {}, { 'aria-hidden': el('DIV') }))).toBe(true);
    expect(isShut(el('BUTTON', {}, { inert: el('DIV') }))).toBe(true);
    expect(isShut(el('BUTTON'))).toBe(false);
  });

  it('a ref read before the modal opened is refused as stale', () => {
    const behind = el('BUTTON', {}, { 'aria-hidden': el('DIV') });
    const open = el('BUTTON');
    const refs = new Map<string, Element>([
      ['r1', behind],
      ['r2', open],
    ]);
    expect(findTarget({ ref: 'r1' }, refs)).toEqual({ error: 'stale_ref' });
    expect(findTarget({ ref: 'r2' }, refs)).toEqual({ el: open });
    expect(findTarget({ ref: 'r9' }, refs)).toEqual({ error: 'stale_ref' });
  });
});

describe('a person-only mark', () => {
  it('a span inside a marked button counts', () => {
    const button = { getAttribute: () => 'person' };
    expect(factsOf(el('SPAN', {}, { 'data-agent-risk': button })).risk).toBe('person');
    expect(factsOf(el('SPAN')).risk).toBeNull();
  });
});

describe('a confirm', () => {
  it('any element inside an alert dialog counts, not only a button', () => {
    const dialog = el('DIV', { role: 'alertdialog' });
    const link = el('A', { href: '/x' }, { alertdialog: dialog });
    const field = el('INPUT', { type: 'text' }, { alertdialog: dialog });
    expect(factsOf(link).inAlertDialog).toBe(true);
    expect(factsOf(field).inAlertDialog).toBe(true);
    expect(factsOf(el('BUTTON')).inAlertDialog).toBe(false);
  });
});

describe('names of secret things', () => {
  it('anything inside or carrying data-secret is named (hidden), whatever its text', () => {
    const wrapper = el('DIV', { 'data-secret': '' });
    const field = el(
      'INPUT',
      { 'aria-label': 'Invite code', type: 'text' },
      { '[data-secret]': wrapper },
    );
    const button = el('BUTTON', { innerText: 'sk-live-1234' }, { '[data-secret]': wrapper });
    expect(nameOf(field)).toBe('(hidden)');
    expect(nameOf(button)).toBe('(hidden)');
    expect(nameOf(el('BUTTON', { 'aria-label': 'Save' }))).toBe('Save');
  });

  it('a name from aria-labelledby that holds a secret is not used', () => {
    const label = el(
      'SPAN',
      { textContent: 'openrouter sk-or-v1-abc\u2026wxyz' },
      {},
      { '[data-secret]': {} },
    );
    const button = el('BUTTON', {
      'aria-labelledby': 'l1',
      'data-agent': 'key',
      dataset: { agent: 'key' },
      ownerDocument: { getElementById: (id: string) => (id === 'l1' ? label : null) },
      querySelector: () => null,
      innerText: 'Open',
    });
    expect(nameOf(button)).toBe('Open');
    // A label that is itself a secret names nothing of it either.
    const secretLabel = el('SPAN', { textContent: 'sk-live-1234' }, { '[data-secret]': {} });
    const field = el('INPUT', {
      'aria-labelledby': 'l2',
      ownerDocument: { getElementById: () => secretLabel },
      querySelector: () => null,
      innerText: '',
    });
    expect(nameOf(field)).not.toContain('sk-live');
  });

  it('a <label> that holds a secret is not used', () => {
    const label = el(
      'LABEL',
      { textContent: 'Key sk-or-v1-abc\u2026wxyz' },
      {},
      { '[data-secret]': {} },
    );
    const name = nameOf(el('INPUT', { labels: [label], querySelector: () => null, innerText: '' }));
    expect(name).not.toContain('sk-or');
    expect(name).not.toContain('wxyz');
  });
});

describe('a box that holds a shown secret', () => {
  const box = (props: Record<string, unknown>, secret: boolean) =>
    el('DIV', props, {}, secret ? { '[data-secret]': {} } : {});

  it('a short and a long secret inside: nothing of either in the name', () => {
    const row = box(
      { innerText: 'Body a\nabc', textContent: 'Body aabc', dataset: { agent: 'key-row' } },
      true,
    );
    const name = nameOf(row);
    expect(name).toBe('key-row');
    expect(name).not.toContain('Body');
    expect(name).not.toContain('bc');
  });
  it('a textarea secret inside (empty innerText, the body in textContent)', () => {
    const name = nameOf(box({ innerText: 'Notes', textContent: 'Notes the secret body' }, true));
    expect(name).not.toContain('secret body');
    expect(name).not.toContain('Notes');
    expect(name).toBe('generic');
  });
  it('no agent id: a plain word for its role', () => {
    expect(nameOf(box({ role: 'row', innerText: 'openrouter sk-or-v1-abc\u2026wxyz' }, true))).toBe(
      'row',
    );
  });
  it('an aria-label or a mark label still names it', () => {
    expect(nameOf(box({ 'aria-label': 'Box A keys', innerText: 'x sk-1' }, true))).toBe(
      'Box A keys',
    );
    expect(nameOf(box({ dataset: { markLabel: 'Key row' }, innerText: 'x sk-1' }, true))).toBe(
      'Key row',
    );
  });
  it('a box with no secret keeps its text name', () => {
    expect(nameOf(box({ innerText: 'openrouter Works' }, false))).toBe('openrouter Works');
  });
});
