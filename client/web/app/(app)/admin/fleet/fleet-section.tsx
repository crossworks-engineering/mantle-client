import { ApiError } from '@mantle/web-ui/api-fetch';

/** The brain's own words for a refusal. */
export function refusalText(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) return fallback;
  const message = err.body?.message;
  return typeof message === 'string' && message ? message : err.message || fallback;
}
