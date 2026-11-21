/**
 * The chat open on screen (fleet chat, plan section 4): the area capture's
 * "Send to chat" puts its picture in the draft of this chat. A room says
 * it is open while it shows its composer; the room used last wins (the
 * Chats screen and the Chats window can both hold one): opened last, or
 * clicked or typed in last (`raiseChat`). In memory only.
 */
import { useSyncExternalStore } from 'react';

export type OpenChat = { id: string; title: string };

const open: OpenChat[] = [];
const listeners = new Set<() => void>();
let current: OpenChat | null = null;

const emit = () => {
  current = open.at(-1) ?? null;
  for (const l of listeners) l();
};

/** Room `chat` is open; the answer closes it again. */
export function openChat(chat: OpenChat): () => void {
  const entry = { ...chat };
  open.push(entry);
  emit();
  return () => {
    const i = open.indexOf(entry);
    if (i !== -1) open.splice(i, 1);
    emit();
  };
}

/** Room `id` was used (a click or a key in it): it is the open one now. */
export function raiseChat(id: string): void {
  const i = open.findLastIndex((c) => c.id === id);
  if (i === -1 || i === open.length - 1) return;
  open.push(...open.splice(i, 1));
  emit();
}

export function currentChat(): OpenChat | null {
  return current;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useOpenChat(): OpenChat | null {
  return useSyncExternalStore(subscribe, currentChat, () => null);
}
