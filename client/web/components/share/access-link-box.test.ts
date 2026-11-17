/**
 * The open link part of the Access panel (W5b2, plan 8.1, kept): a user who
 * may change the item makes, copies and stops the link; anyone else reads
 * only that one exists. Nothing when there is no link and no right to make one.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AccessLinkBox, HAS_LINK_TEXT, OPEN_LINK_TEXT } from './access-link-box';

const noop = () => {};
const box = (over: Record<string, unknown>) =>
  renderToStaticMarkup(
    createElement(AccessLinkBox, {
      url: null,
      hasLink: false,
      mayLink: false,
      copied: false,
      onCopy: noop,
      onMake: noop,
      onStop: noop,
      ...over,
    }),
  );

describe('AccessLinkBox', () => {
  it('a user who may: Make an open link', () => {
    const html = box({ mayLink: true });
    expect(html).toContain('Make an open link');
    expect(html).toContain(OPEN_LINK_TEXT);
  });

  it('with a link: the address, Copy and Stop', () => {
    const html = box({ mayLink: true, hasLink: true, url: 'https://brain.example/s/tok' });
    expect(html).toContain('value="https://brain.example/s/tok"');
    expect(html).toContain('aria-label="Copy link"');
    expect(html).toContain('aria-label="Stop the link"');
    expect(html).not.toContain('Make an open link');
  });

  it('a user who may not: only that a link exists, never the address', () => {
    const html = box({ hasLink: true });
    expect(html).toContain(HAS_LINK_TEXT);
    expect(html).not.toContain('<input');
    expect(html).not.toContain('Make an open link');
  });

  it('shows the served list under a live link only (contract 30)', () => {
    const list = createElement('p', null, 'SERVED');
    expect(
      box({ mayLink: true, hasLink: true, url: 'https://brain.example/s/tok', served: list }),
    ).toContain('SERVED');
    expect(box({ mayLink: true, served: list })).not.toContain('SERVED');
    expect(box({ hasLink: true, url: 'https://brain.example/s/tok', served: list })).not.toContain(
      'SERVED',
    );
  });

  it('nothing with no link and no right', () => {
    expect(box({})).toBe('');
  });
});
