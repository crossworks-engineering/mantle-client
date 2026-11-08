/**
 * The chat bubbles switch, kept in this browser. Off by default until the
 * owner says otherwise. A tiny external store for useSyncExternalStore, synced
 * across tabs by the `storage` event, the shape of lib/sounds/prefs.ts.
 */

export type BubbleMode = 'off' | 'on';

export const BUBBLE_MODE_KEY = 'mantle_bubbles_mode_v1';

export function parseBubbleMode(raw: string | null | undefined): BubbleMode {
  return raw === 'on' ? 'on' : 'off';
}

let current: BubbleMode | null = null;
const listeners = new Set<() => void>();

export function getBubbleMode(): BubbleMode {
  if (typeof window === 'undefined') return 'off';
  if (current === null) {
    try {
      current = parseBubbleMode(window.localStorage.getItem(BUBBLE_MODE_KEY));
    } catch {
      current = 'off';
    }
  }
  return current;
}

export function serverBubbleMode(): BubbleMode {
  return 'off';
}

export function setBubbleMode(mode: BubbleMode): void {
  current = mode;
  try {
    window.localStorage.setItem(BUBBLE_MODE_KEY, mode);
  } catch {
    /* private mode: the choice lasts for the visit */
  }
  for (const l of listeners) l();
}

export function subscribeBubbleMode(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== BUBBLE_MODE_KEY) return;
    current = parseBubbleMode(e.newValue);
    cb();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}
