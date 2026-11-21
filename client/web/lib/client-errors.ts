/**
 * The last client errors (fleet chat plan section 4): a small list in
 * memory of the newest 10 uncaught errors and refused promises of this tab,
 * the message and the source line only, so a bug report can add them (the
 * sender sees and may remove each before send). Never sent anywhere by
 * itself, never kept in browser storage.
 */

export type ClientError = { message: string; source: string | null };

/** The most errors kept. */
export const CLIENT_ERRORS_MAX = 10;
/** The longest message kept. */
const MESSAGE_MAX = 300;

const list: ClientError[] = [];

/** Keep one error (the oldest goes past the cap). */
export function recordClientError(message: string, source: string | null = null): void {
  const m = message.trim().slice(0, MESSAGE_MAX);
  if (!m) return;
  list.push({ message: m, source: source ? source.slice(0, 300) : null });
  if (list.length > CLIENT_ERRORS_MAX) list.splice(0, list.length - CLIENT_ERRORS_MAX);
}

/** The errors kept, oldest first. */
export function clientErrors(): readonly ClientError[] {
  return [...list];
}

export function clearClientErrors(): void {
  list.length = 0;
}

/** Where an error was raised, as `file:line`, without the query (a URL's
 *  query can carry a token). */
export function errorSource(file: string | undefined, line: number | undefined): string | null {
  if (!file) return null;
  const path = file.split(/[?#]/)[0]!;
  return line ? `${path}:${line}` : path;
}

let installed = false;

/** Listen for this tab's errors, once. */
export function installClientErrors(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (e) => {
    recordClientError(e.message || String(e.error ?? 'Error'), errorSource(e.filename, e.lineno));
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r: unknown = e.reason;
    recordClientError(r instanceof Error ? r.message : String(r ?? 'Unhandled rejection'));
  });
}
