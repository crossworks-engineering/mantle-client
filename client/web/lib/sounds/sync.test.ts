/**
 * pushSoundPrefs names the login the choice was made as (`loginId`), as the
 * Desk's and the description's saves do: the brain refuses a save for any
 * other login (403 `login-mismatch`), and after that 403, or a 404 from a
 * brain before the route, nothing more is sent this visit. With no login
 * known yet, nothing is sent.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiSend = vi.fn();
vi.mock('@mantle/web-ui/api-fetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@mantle/web-ui/api-fetch')>()),
  apiSend: (...a: unknown[]) => apiSend(...a),
}));
const { ApiError } = await import('@mantle/web-ui/api-fetch');

const LOGIN = '22222222-2222-4222-8222-222222222222';

/** A fresh module each test: the "stop for this visit" flag is module state. */
async function load() {
  vi.resetModules();
  return import('./sync');
}

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  apiSend.mockReset();
  apiSend.mockResolvedValue({ sounds: null });
});

describe('pushSoundPrefs', () => {
  it('sends the login with the choice', async () => {
    const { pushSoundPrefs, SOUNDS_PATH } = await load();
    pushSoundPrefs(LOGIN);
    expect(apiSend).toHaveBeenCalledTimes(1);
    const [path, method, body] = apiSend.mock.calls[0]!;
    expect(path).toBe(SOUNDS_PATH);
    expect(method).toBe('PUT');
    expect(body).toMatchObject({ loginId: LOGIN, sounds: { enabled: expect.any(Boolean) } });
  });

  it('sends nothing while no login is known', async () => {
    const { pushSoundPrefs } = await load();
    pushSoundPrefs(undefined);
    pushSoundPrefs(null);
    pushSoundPrefs('');
    expect(apiSend).not.toHaveBeenCalled();
  });

  it('stops for the visit after a 403 login-mismatch', async () => {
    const { pushSoundPrefs } = await load();
    apiSend.mockRejectedValueOnce(
      new ApiError('loginId is not the login of this session', 403, { code: 'login-mismatch' }),
    );
    pushSoundPrefs(LOGIN);
    await settle();
    pushSoundPrefs(LOGIN);
    expect(apiSend).toHaveBeenCalledTimes(1);
  });

  it('stops for the visit after a 404 (a brain before the route)', async () => {
    const { pushSoundPrefs } = await load();
    apiSend.mockRejectedValueOnce(new ApiError('Not found', 404));
    pushSoundPrefs(LOGIN);
    await settle();
    pushSoundPrefs(LOGIN);
    expect(apiSend).toHaveBeenCalledTimes(1);
  });

  it('keeps sending after any other failure', async () => {
    const { pushSoundPrefs } = await load();
    apiSend.mockRejectedValueOnce(new ApiError('Bad gateway', 502));
    pushSoundPrefs(LOGIN);
    await settle();
    pushSoundPrefs(LOGIN);
    expect(apiSend).toHaveBeenCalledTimes(2);
  });
});
