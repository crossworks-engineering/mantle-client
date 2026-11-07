import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "Ask once per turn" (Jason, 2026-11-07): a turn's first click, type or
 * select asks the person whether the agent may act in this window for the
 * rest of the turn. Reads need only the page's consent. The hands
 * themselves are stood in for: this is the window's turn logic.
 */

type Answer = { path: string; result: { ok: boolean; error?: string } };
const answers: Answer[] = [];
vi.mock('@mantle/web-ui/api-fetch', () => ({
  apiFetch: async () => ({ enabled: true }),
  apiSend: async (path: string, _m: string, body: { result: Answer['result'] }) => {
    answers.push({ path, result: body.result });
    return {};
  },
}));
vi.mock('./login-pin', async (orig) => ({
  ...(await orig<typeof import('./login-pin')>()),
  currentLoginKey: () => 'login:ada',
}));

let n = 0;
const callId = () => `0a0a0a0a-0a0a-40a0-80a0-${String(++n).padStart(12, '0')}`;

async function setup() {
  const calls = await import('./turn-calls');
  const { agentHands } = await import('./hands');
  const hands = agentHands();
  vi.spyOn(hands, 'begin').mockImplementation(() => undefined);
  vi.spyOn(hands, 'askConsent').mockResolvedValue(true);
  for (const m of ['click', 'type', 'select', 'screen', 'point'] as const)
    vi.spyOn(hands, m).mockResolvedValue({ ok: true } as never);
  await calls.loadAgentUiSetting(true);
  return { calls, hands };
}

/** One call of `turn`, answered; its answer. */
async function run(
  calls: typeof import('./turn-calls'),
  turn: string,
  action: string,
  args: Record<string, unknown> = { target: { role: 'button', name: 'Add' }, text: 'x' },
) {
  const id = callId();
  const done = calls.handleUiCall(turn, { callId: id, action, args }, 'Saskia');
  return { id, done };
}

const answerOf = (id: string) => answers.find((a) => a.path.endsWith(id))?.result;

describe('ask once per turn', () => {
  beforeEach(() => {
    answers.length = 0;
  });

  it('the first acting call of a turn asks; the second does not; a new turn asks again', async () => {
    const { calls, hands } = await setup();
    let asked = 0;
    const askTurn = vi.spyOn(hands, 'askTurn').mockImplementation(async () => {
      asked += 1;
      return true;
    });
    // The page's consent, once.
    calls.claimTurn('turn-a', null);
    await (
      await run(calls, 'turn-a', 'screen')
    ).done;

    const first = await run(calls, 'turn-a', 'click');
    await first.done;
    expect(asked).toBe(1);
    expect(answerOf(first.id)).toEqual({ ok: true });

    const second = await run(calls, 'turn-a', 'type');
    await second.done;
    expect(asked).toBe(1);
    expect(answerOf(second.id)).toEqual({ ok: true });

    calls.claimTurn('turn-b', null);
    const next = await run(calls, 'turn-b', 'select', {
      target: { role: 'combobox', name: 'X' },
      option: 'Y',
    });
    await next.done;
    expect(asked).toBe(2);
    expect(answerOf(next.id)).toEqual({ ok: true });
    askTurn.mockRestore();
  });

  it('reads never ask', async () => {
    const { calls, hands } = await setup();
    const askTurn = vi.spyOn(hands, 'askTurn').mockResolvedValue(true);
    calls.claimTurn('turn-r', null);
    for (const action of ['screen', 'point'])
      await (
        await run(calls, 'turn-r', action, { target: { id: 'x' }, caption: 'c' })
      ).done;
    expect(askTurn).not.toHaveBeenCalled();
    askTurn.mockRestore();
  });

  it('Not now refuses that call and the rest of the turn, without asking again', async () => {
    const { calls, hands } = await setup();
    const askTurn = vi.spyOn(hands, 'askTurn').mockResolvedValue(false);
    const click = vi.mocked(hands.click);
    click.mockClear();
    calls.claimTurn('turn-c', null);
    const first = await run(calls, 'turn-c', 'click');
    await first.done;
    expect(answerOf(first.id)).toMatchObject({ ok: false, error: 'needs_user' });
    const second = await run(calls, 'turn-c', 'type');
    await second.done;
    expect(answerOf(second.id)).toMatchObject({ ok: false, error: 'needs_user' });
    expect(askTurn).toHaveBeenCalledTimes(1);
    expect(click).not.toHaveBeenCalled();
    // A read of the same turn still runs.
    const read = await run(calls, 'turn-c', 'screen');
    await read.done;
    expect(answerOf(read.id)).toEqual({ ok: true });
    askTurn.mockRestore();
  });

  it('two acting calls at once share the one question', async () => {
    const { calls, hands } = await setup();
    let release: (ok: boolean) => void = () => undefined;
    const askTurn = vi
      .spyOn(hands, 'askTurn')
      .mockImplementation(() => new Promise<boolean>((r) => (release = r)));
    calls.claimTurn('turn-d', null);
    const a = await run(calls, 'turn-d', 'click');
    const b = await run(calls, 'turn-d', 'click');
    await vi.waitFor(() => expect(askTurn).toHaveBeenCalledTimes(1));
    release(true);
    await Promise.all([a.done, b.done]);
    expect(answerOf(a.id)).toEqual({ ok: true });
    expect(answerOf(b.id)).toEqual({ ok: true });
    expect(askTurn).toHaveBeenCalledTimes(1);
    askTurn.mockRestore();
  });
});
