import { describe, expect, it } from 'vitest';
import { NAV_GROUPS } from '@mantle/web-ui/layout/nav-items';
import { CHATS_HREF, withChats } from './nav';

describe('the Chats nav entry', () => {
  const hrefs = (gs: { items: { href: string }[] }[]) =>
    gs.flatMap((g) => g.items.map((i) => i.href));

  it('is in the shared list, right after Home', () => {
    const work = NAV_GROUPS.find((g) => g.label === 'Workspace')!;
    const at = work.items.findIndex((i) => i.href === CHATS_HREF);
    expect(at).toBeGreaterThan(-1);
    expect(work.items[at - 1]?.href).toBe('/');
  });

  it('hides on a brain without the messenger and shows with it', () => {
    expect(hrefs(withChats(NAV_GROUPS, false))).not.toContain(CHATS_HREF);
    expect(hrefs(withChats(NAV_GROUPS, true))).toContain(CHATS_HREF);
  });
});
