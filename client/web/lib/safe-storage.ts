/**
 * This browser's localStorage, without the throws: a private window, blocked
 * site data or a full quota make every call a quiet no-op (a read is null).
 * Storage here is a convenience that can vanish at any time, so a caller
 * always has a fallback for null.
 */

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readStored(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    storage()?.setItem(key, value);
  } catch {
    // Quota or blocked storage: the value holds for this visit only.
  }
}

export function forgetStored(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // Blocked storage: nothing was kept to forget.
  }
}
