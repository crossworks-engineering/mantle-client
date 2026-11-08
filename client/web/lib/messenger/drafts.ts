/**
 * The composer's unsent text for each chat, in memory only (never browser
 * storage: the browser keeps keys, never message text). A room that
 * unmounts (back to the list in the Chats window, Open in Chats, another
 * chat) finds its draft again while this tab lives.
 */

export type ChatDraft<M> = { text: string; picked: readonly M[] };

const drafts = new Map<string, ChatDraft<unknown>>();
/** Only recent chats matter; the oldest goes first. */
const KEEP = 50;

export function getDraft<M>(chat: string): ChatDraft<M> | undefined {
  return drafts.get(chat) as ChatDraft<M> | undefined;
}

export function setDraft<M>(chat: string, draft: ChatDraft<M>): void {
  drafts.delete(chat);
  if (!draft.text) return;
  drafts.set(chat, draft);
  if (drafts.size > KEEP) drafts.delete(drafts.keys().next().value!);
}

export function clearDrafts(): void {
  drafts.clear();
}
