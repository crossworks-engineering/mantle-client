import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SecretInput } from '@mantle/web-ui/ui/secret-input';
import { factsOf, findTarget, isSecretField, isShut, nameOf } from './dom';

/** A stand-in element: a tag, attributes, and the ancestors `closest`
 *  finds (keyed by a piece of the selector). */
function el(
  tagName: string,
  props: Record<string, unknown> = {},
  ancestors: Record<string, object> = {},
): Element {
  return {
    tagName,
    isConnected: true,
    getAttribute: (n: string) => (props[n] as string | undefined) ?? null,
    closest: (sel: string) => {
      for (const [mark, a] of Object.entries(ancestors)) if (sel.includes(mark)) return a;
      return null;
    },
    ...props,
  } as unknown as Element;
}

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
});
