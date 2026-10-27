'use client';

/**
 * The messenger's live wiring in the app (lib/messenger/live.ts is the pure
 * half): ONE `MessengerLiveSync` per tab reads GET /api/messenger/stream
 * through the shared realtime singleton, refreshes the list and the badge on
 * every event, keeps the receipts and the typing lines, and tells the open
 * chat what to fetch over a small in-tab bus. On a reconnect, on tab focus
 * and while the stream is silent, the bus says "gap" and the open chat
 * fetches after the highest seq it holds.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { subscribeRealtime } from '@/components/realtime/use-realtime';
import { messengerKeys } from '@/lib/messenger/api';
import {
  MESSENGER_STREAM_PATH,
  ReceiptBook,
  TYPING_SHOW_MS,
  TypingBook,
  connectMessengerLive,
  type LiveEffect,
  type StreamSource,
} from '@/lib/messenger/live';

export type MessengerBusEvent = { kind: 'effect'; effect: LiveEffect } | { kind: 'gap' };

const busListeners = new Set<(e: MessengerBusEvent) => void>();

function emit(e: MessengerBusEvent) {
  for (const fn of busListeners) {
    try {
      fn(e);
    } catch {
      /* one listener's bug must not stop the others */
    }
  }
}

/** The tab's receipts and typing lines (one each per tab). */
export const receipts = new ReceiptBook();
export const typingBook = new TypingBook();

/** The shared realtime singleton as the live wiring's stream source. */
const realtimeSource: StreamSource = ({ onData, onActivity, onConnect }) =>
  subscribeRealtime(MESSENGER_STREAM_PATH, {
    types: null,
    cb: (c) => onData(c),
    onActivity,
    onConnect,
  });

/**
 * Headless: mount once while the messenger is on (the chats screen, and the
 * shell once the rail badge needs it). Two mounts would only share the one
 * connection, but would poll and invalidate twice.
 */
export function MessengerLiveSync({ enabled = true }: { enabled?: boolean }) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const refreshList = () => {
      void queryClient.invalidateQueries({ queryKey: messengerKeys.list });
      void queryClient.invalidateQueries({ queryKey: messengerKeys.unread });
    };
    const gap = () => {
      refreshList();
      emit({ kind: 'gap' });
    };
    const off = connectMessengerLive({
      source: realtimeSource,
      onEffect: (effect) => {
        if (effect.read) receipts.record(effect.c, effect.read.loginId, effect.read.seq);
        if (effect.typing) {
          typingBook.record(effect.c, effect.typing);
          setTimeout(() => typingBook.tick(), TYPING_SHOW_MS + 50);
        }
        if (effect.refreshList) refreshList();
        emit({ kind: 'effect', effect });
      },
      onGap: gap,
      onPoll: gap,
    });
    const onVisible = () => {
      if (document.visibilityState === 'visible') gap();
    };
    window.addEventListener('focus', gap);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      off();
      window.removeEventListener('focus', gap);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, queryClient]);
  return null;
}

/** Listen to the bus (the open chat). The latest callback runs. */
export function useMessengerBus(fn: (e: MessengerBusEvent) => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const l = (e: MessengerBusEvent) => ref.current(e);
    busListeners.add(l);
    return () => {
      busListeners.delete(l);
    };
  }, []);
}

/** The seq every other person in the chat has read up to, as heard. */
export function useReadByAll(c: string, others: readonly string[]): number {
  useSyncExternalStore(receipts.subscribe, receipts.snapshot, receipts.snapshot);
  return receipts.readByAll(c, others);
}

/** Who is typing in the chat now (login ids). */
export function useTyping(c: string): string[] {
  useSyncExternalStore(typingBook.subscribe, typingBook.snapshot, typingBook.snapshot);
  return typingBook.typing(c);
}
