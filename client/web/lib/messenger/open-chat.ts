/**
 * The chat open on screen (fleet chat, plan section 4): the area capture's
 * "Send to chat" puts its picture in the draft of this chat. A room says
 * it is open while it shows its composer; the room opened last wins (the
 * Chats screen and the Chats window can both hold one). In memory only.
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
