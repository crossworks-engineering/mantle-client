/** The last client errors: the newest 10, message and source only. */
import { afterEach, expect, it } from 'vitest';
import {
  CLIENT_ERRORS_MAX,
  clearClientErrors,
  clientErrors,
  errorSource,
  recordClientError,
  withoutQueries,
} from './client-errors';

afterEach(() => clearClientErrors());

it('keeps the newest 10 errors, oldest first', () => {
  for (let i = 0; i < 12; i += 1) recordClientError(`error ${i}`);
  const list = clientErrors();
  expect(list).toHaveLength(CLIENT_ERRORS_MAX);
  expect(list[0]!.message).toBe('error 2');
  expect(list.at(-1)!.message).toBe('error 11');
});

it('drops an empty message and cuts a long one', () => {
  recordClientError('   ');
  recordClientError('x'.repeat(1000), 'a.js:1');
  expect(clientErrors()).toEqual([{ message: 'x'.repeat(300), source: 'a.js:1' }]);
});

it('a source is the file and line, never the query', () => {
  expect(errorSource('https://box/app.js?at=token#h', 12)).toBe('https://box/app.js:12');
  expect(errorSource('https://box/app.js', 0)).toBe('https://box/app.js');
  expect(errorSource(undefined, 3)).toBeNull();
});

it('cuts the query of a URL inside a message, and keeps the rest', () => {
  expect(withoutQueries('Failed to fetch https://box/api/x?at=secret&q=1 (500)')).toBe(
    'Failed to fetch https://box/api/x (500)',
  );
  expect(withoutQueries('GET /api/files?path=files.x#top failed')).toBe('GET /api/files failed');
  expect(withoutQueries('What happened? Nothing.')).toBe('What happened? Nothing.');
  recordClientError('boom at https://box/a.js?token=t');
  expect(clientErrors()).toEqual([{ message: 'boom at https://box/a.js', source: null }]);
});
