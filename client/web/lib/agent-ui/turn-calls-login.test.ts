import { describe, expect, it, vi } from 'vitest';

/**
 * A turn's calls run only as the login that sent it: another tab switching
 * the login ends the session, and the window sends nothing more for it.
 */
let loginNow: string | null = 'login:ada';
const sent: string[] = [];
let reads = 0;
vi.mock('./login-pin', async (orig) => ({
  ...(await orig<typeof import('./login-pin')>()),
  currentLoginKey: () => loginNow,
}));
vi.mock('@mantle/web-ui/api-fetch', () => ({
  apiFetch: async () => {
    reads += 1;
    return { enabled: true };
  },
  apiSend: async (path: string) => {
    sent.push(path);
    return {};
  },
}));

describe('handleUiCall after a login change', () => {
  it('runs nothing, sends nothing, and ends the session', async () => {
    const calls = await import('./turn-calls');
    const { agentHands } = await import('./hands');
    await calls.loadAgentUiSetting(true);
    calls.claimTurn('turn-1', null);
    const end = vi.spyOn(agentHands(), 'endForLoginChange');
    loginNow = 'login:mo';
    await calls.handleUiCall(
      'turn-1',
      { callId: '0a0a0a0a-0a0a-40a0-80a0-000000000001', action: 'screen', args: {} },
      'Saskia',
    );
    expect(sent).toEqual([]);
    expect(end).toHaveBeenCalled();
    // A later call of the same turn too, even back on the first login.
    loginNow = 'login:ada';
    await calls.handleUiCall(
      'turn-1',
      { callId: '0a0a0a0a-0a0a-40a0-80a0-000000000002', action: 'screen', args: {} },
      'Saskia',
    );
    expect(sent).toEqual([]);
  });

  it('the login it was sent as answers as ever', async () => {
    const calls = await import('./turn-calls');
    loginNow = 'login:ada';
    calls.claimTurn('turn-2', null);
    // Not awaited: the first call asks the user, who is not here.
    void calls.handleUiCall(
      'turn-2',
      { callId: '0a0a0a0a-0a0a-40a0-80a0-000000000003', action: 'screen', args: {} },
      'Saskia',
    );
    // Answered at once (needs_consent while the user is asked), as ever.
    await vi.waitFor(() => expect(sent.length).toBe(1));
    expect(sent).toEqual(['/api/assistant/turn/turn-2/ui/0a0a0a0a-0a0a-40a0-80a0-000000000003']);
  });
});

describe('the setting and the consent are the login’s', () => {
  it('a login change between turns forgets both, and the setting is read again', async () => {
    const calls = await import('./turn-calls');
    loginNow = 'login:ada';
    await calls.loadAgentUiSetting(true);
    expect(calls.agentUiEnabled()).toBe(true);
    const before = reads;
    loginNow = 'login:mo';
    // No window is named until the new login's setting is read.
    expect(calls.withWindowId('{"text":"hi"}', true)).toBe('{"text":"hi"}');
    expect(reads).toBe(before + 1);
    await calls.loadAgentUiSetting();
    expect(calls.agentUiEnabled()).toBe(true);
    expect(JSON.parse(calls.withWindowId('{"text":"hi"}', true) as string).windowId).toBe(
      calls.WINDOW_ID,
    );
  });
});
