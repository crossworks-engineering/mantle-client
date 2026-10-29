/**
 * The sound preference (on/off and a volume). The brain keeps the login's
 * copy (GET/PUT /api/profile/sounds, lib/sounds/sync.ts) so it follows the
 * person across devices; this browser keeps the last one seen, so a sound
 * can play before the brain answers and on a brain without the route.
 * Pure parse half pinned by sounds.test.ts; the store half is a tiny
 * external store for useSyncExternalStore, synced across tabs by the
 * `storage` event.
 */

export type SoundPrefs = {
  /** Every sound in the app, the ring included. */
  enabled: boolean;
  /** 0..1, applied on top of each sound's own level. */
  volume: number;
};

export const SOUND_PREFS_KEY = 'mantle_sounds_v1';

export const DEFAULT_SOUND_PREFS: SoundPrefs = { enabled: true, volume: 0.7 };

/** A stored value as prefs: anything unreadable falls back to the default,
 *  a volume out of range is clamped. */
export function parseSoundPrefs(raw: string | null | undefined): SoundPrefs {
  if (!raw) return DEFAULT_SOUND_PREFS;
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof SoundPrefs, unknown>> | null;
    const enabled = typeof v?.enabled === 'boolean' ? v.enabled : DEFAULT_SOUND_PREFS.enabled;
    const volume =
      typeof v?.volume === 'number' && Number.isFinite(v.volume)
        ? Math.min(1, Math.max(0, v.volume))
        : DEFAULT_SOUND_PREFS.volume;
    return { enabled, volume };
  } catch {
    return DEFAULT_SOUND_PREFS;
  }
}

let current: SoundPrefs | null = null;
/** Changes made here (setSoundPrefs), so a brain read that started before
 *  one does not undo it (sync.ts). */
let edits = 0;
const listeners = new Set<() => void>();

function read(): SoundPrefs {
  try {
    return parseSoundPrefs(window.localStorage.getItem(SOUND_PREFS_KEY));
  } catch {
    return DEFAULT_SOUND_PREFS;
  }
}

export function getSoundPrefs(): SoundPrefs {
  if (typeof window === 'undefined') return DEFAULT_SOUND_PREFS;
  current ??= read();
  return current;
}

/** A change made here, by the person. */
export function setSoundPrefs(next: Partial<SoundPrefs>): void {
  edits += 1;
  store(next);
}

/** The count of changes made here so far. */
export function soundPrefEdits(): number {
  return edits;
}

/** The brain's copy, taken as this browser's (not an edit: nothing to send). */
export function adoptSoundPrefs(next: Partial<SoundPrefs>): void {
  store(next);
}

function store(next: Partial<SoundPrefs>): void {
  current = parseSoundPrefs(JSON.stringify({ ...getSoundPrefs(), ...next }));
  try {
    window.localStorage.setItem(SOUND_PREFS_KEY, JSON.stringify(current));
  } catch {
    /* private mode: the choice lasts for the visit */
  }
  for (const l of listeners) l();
}

export function subscribeSoundPrefs(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== SOUND_PREFS_KEY) return;
    current = parseSoundPrefs(e.newValue);
    cb();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

export function serverSoundPrefs(): SoundPrefs {
  return DEFAULT_SOUND_PREFS;
}
