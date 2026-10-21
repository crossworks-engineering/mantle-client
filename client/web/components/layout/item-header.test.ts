import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { fitTools } from './header-overflow';
import { ItemHeader } from './item-header';
import { ZenModeContext } from './zen-mode';
import { ToastProvider } from '@mantle/web-ui/ui/toast';
import { AccessStack, accessStackLabel } from '../share/access-stack';

/**
 * The item header contract (2026-10-21): one row, fixed slots counted from
 * the right (More, Focus, Info, Access), the kind's tools and Delete to
 * their left, folding into More from the end; one back link while
 * maximised.
 */
function render(props: Record<string, unknown>, zen = false): string {
  return renderToStaticMarkup(
    createElement(
      ToastProvider,
      null,
      createElement(
        ZenModeContext.Provider,
        { value: { zen, toggle: () => {} } },
        createElement(ItemHeader, { title: 'A page', ...props } as never),
      ),
    ),
  );
}

const slotOrder = (html: string) => [...html.matchAll(/data-slot="(\w+)"/g)].map((m) => m[1]);

describe('fitTools', () => {
  it('keeps every tool when they fit', () => {
    expect(fitTools(500, 3)).toBe(3);
  });

  it('folds from the end as the room shrinks', () => {
    // Two 36px tools and one 4px gap.
    expect(fitTools(76, 3)).toBe(2);
    expect(fitTools(75, 3)).toBe(1);
    expect(fitTools(35, 3)).toBe(0);
  });

  it('never a negative count', () => {
    expect(fitTools(-40, 2)).toBe(0);
    expect(fitTools(100, 0)).toBe(0);
  });
});

describe('ItemHeader slots', () => {
  it('Access, Info, Focus, Edit, More in that order, More last', () => {
    const html = render({
      access: createElement('span', null, 'ACCESS'),
      info: { rows: [{ label: 'Updated', value: 'today' }] },
      edit: { href: '/pages/1' },
      onDelete: () => {},
    });
    expect(slotOrder(html)).toEqual(['access', 'info', 'focus', 'delete', 'edit', 'more']);
  });

  it('a login that may not edit keeps the pencil in its slot, greyed', () => {
    const html = render({ edit: { disabled: true } });
    expect(slotOrder(html).slice(-2)).toEqual(['edit', 'more']);
    expect(html).toMatch(/aria-label="Edit"[^>]*disabled|disabled[^>]*aria-label="Edit"/);
  });

  it('Delete sits right before Edit, Edit right before More', () => {
    const order = slotOrder(render({ edit: { onSelect: () => {} }, onDelete: () => {} }));
    expect(order.slice(-4)).toEqual(['focus', 'delete', 'edit', 'more']);
  });

  it('a login that may not delete keeps the bin in its slot, greyed', () => {
    const html = render({ deleteDisabled: true, deleteLabel: 'Delete page' });
    expect(slotOrder(html)).toContain('delete');
    expect(html).toMatch(
      /aria-label="Delete page"[^>]*disabled|disabled[^>]*aria-label="Delete page"/,
    );
  });

  it('tools sit left of the fixed slots', () => {
    const html = render({
      tools: [{ key: 'download', label: 'Download', icon: null, onSelect: () => {} }],
      onDelete: () => {},
      deleteLabel: 'Delete page',
      info: {},
    });
    const download = html.indexOf('aria-label="Download"');
    const slots = html.indexOf('data-testid="item-header-slots"');
    const del = html.indexOf('aria-label="Delete page"');
    expect(download).toBeGreaterThan(-1);
    expect(download).toBeLessThan(slots);
    expect(slots).toBeLessThan(del);
  });

  it('the title is 15px (in rem) on one 44px row', () => {
    const html = render({});
    expect(html).toContain('h-11');
    expect(html).toContain('text-[0.9375rem]');
  });

  it('the back link only while maximised, before the title', () => {
    expect(render({ section: 'Pages' })).not.toContain('item-header-back');
    const html = render({ section: 'Pages' }, true);
    expect(html).toContain('aria-label="Back to Pages (Esc)"');
    expect(html.indexOf('item-header-back')).toBeLessThan(html.indexOf('A page'));
  });

  it('a screen with its own icon group keeps it, without the slots', () => {
    const html = render({ iconActions: createElement('span', null, 'OWN') });
    expect(html).toContain('OWN');
    expect(slotOrder(html)).toEqual([]);
  });
});

describe('AccessStack', () => {
  const ws = (id: string, name: string) => ({ id, name, kind: 'team' });

  it('the icon alone when shared with no one', () => {
    expect(accessStackLabel({ workspaces: [] })).toBe('Access: not shared');
    expect(renderToStaticMarkup(createElement(AccessStack, { item: {} }))).not.toContain('+');
  });

  it('names every workspace and the open link', () => {
    expect(accessStackLabel({ workspaces: [ws('b', 'Ops'), ws('a', 'Dev')], hasLink: true })).toBe(
      'Access: shared with Dev, Ops, anyone with the link',
    );
  });

  it('three faces, then +N', () => {
    const item = {
      workspaces: [ws('a', 'A'), ws('b', 'B'), ws('c', 'C'), ws('d', 'D'), ws('e', 'E')],
    };
    expect(renderToStaticMarkup(createElement(AccessStack, { item }))).toContain('+2');
  });
});
