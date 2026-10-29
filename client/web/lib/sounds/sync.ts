/**
 * The sound preference on the brain: GET/PUT /api/profile/sounds, the login's
 * own copy, so the choice follows the person across browsers and devices.
 *
 * - `pullSoundPrefs` (the app shell, once a page load) takes the brain's copy
 *   as this browser's, unless the person changed it here while the read was
 *   on its way. `null` (never saved) keeps this browser's.
 * - `pushSoundPrefs` (the Sounds settings, after a change) sends this
 *   browser's copy. Last write wins: it is one person's switch.
 * - The save names the login it was made as (`loginId`, from the shell), as
 *   the Desk's and the description's do: the brain refuses it for any other
 *   (403 `login-mismatch`), so a tab left on one login never writes another's
 *   sounds after the browser switched logins. On that 403 nothing more is
 *   sent this visit. With no login known yet, nothing is sent.
 * - A brain before the route answers 404: the preference stays in this
 *   browser, and nothing more is sent this visit. A brain before the login
 *   check ignores the extra field.
 *
 * Best effort: a failed read or save leaves this browser's copy as it is.
 */
import { apiFetch, apiSend } from '@mantle/web-ui/api-fetch';
import { adoptSoundPrefs, getSoundPrefs, soundPrefEdits, type SoundPrefs } from './prefs';

export const SOUNDS_PATH = '/api/profile/sounds';

type SoundsBody = { sounds: SoundPrefs | null };

/** False once the brain said it has no such route (404), or that this tab's
 *  login is not the session's any more (403). */
let roams = true;

const statusOf = (err: unknown): number | undefined =>
  (err as { status?: unknown } | null)?.status as number | undefined;

export async function pullSoundPrefs(): Promise<void> {
  const before = soundPrefEdits();
  try {
    const body = await apiFetch<SoundsBody>(SOUNDS_PATH);
    if (body?.sounds && soundPrefEdits() === before) adoptSoundPrefs(body.sounds);
  } catch (err) {
    if (statusOf(err) === 404) roams = false;
  }
}

export function pushSoundPrefs(loginId: string | null | undefined): void {
  if (!roams || !loginId) return;
  const { enabled, volume } = getSoundPrefs();
  void apiSend<SoundsBody>(SOUNDS_PATH, 'PUT', { sounds: { enabled, volume }, loginId }).catch(
    (err) => {
      const status = statusOf(err);
      if (status === 404 || status === 403) roams = false;
    },
  );
}
