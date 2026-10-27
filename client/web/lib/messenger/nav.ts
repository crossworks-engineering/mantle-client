/**
 * The Chats entry of the nav (Messenger V1 Phase 2): kept only while the
 * brain has the messenger. Pure; pinned by nav.test.ts.
 */
export const CHATS_HREF = '/chats';

export function withChats<G extends { items: { href: string }[] }>(
  groups: readonly G[],
  available: boolean,
): G[] {
  if (available) return [...groups];
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => i.href !== CHATS_HREF) }))
    .filter((g) => g.items.length > 0);
}
