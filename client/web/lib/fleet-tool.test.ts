import { describe, expect, it } from 'vitest';
import {
  callFleetTool,
  FLEET_TOOL_PATH,
  isNoChannel,
  NO_CHANNEL_TEXT,
  parseToolAnswer,
  toolReasonText,
  USERS_LIST_TOOL,
  WORKSPACE_USER_SET_TOOL,
} from './fleet-tool';

describe('fleet tool (the admin channel)', () => {
  it('names its route and the two box tools', () => {
    expect(FLEET_TOOL_PATH).toBe('/api/fleet/tool');
    expect(USERS_LIST_TOOL).toBe('users_list');
    expect(WORKSPACE_USER_SET_TOOL).toBe('workspace_user_set');
  });

  it('reads either reply shape, and a box left out', () => {
    const boxes = parseToolAnswer({
      boxes: [
        { boxId: 'a', ok: true, output: { n: 1 } },
        { boxId: 'b', ok: false, reason: 'scope' },
        { boxId: 'c', ok: true, result: { n: 3 } },
        { nope: true },
        'junk',
      ],
    });
    expect(boxes).toEqual([
      { boxId: 'a', ok: true, output: { n: 1 }, reason: null },
      { boxId: 'b', ok: false, output: undefined, reason: 'scope' },
      { boxId: 'c', ok: true, output: { n: 3 }, reason: null },
    ]);
    const results = parseToolAnswer({ results: [{ id: 'a', reason: 'unreachable' }] }, ['a', 'd']);
    expect(results).toEqual([
      { boxId: 'a', ok: false, output: undefined, reason: 'unreachable' },
      { boxId: 'd', ok: false, output: undefined, reason: 'missing' },
    ]);
    // ok without a word is not ok; a reason that is not a short code reads as error.
    expect(
      parseToolAnswer([{ boxId: 'a', ok: false, reason: 'Some <b>text</b>' }])[0]!.reason,
    ).toBe('error');
    expect(parseToolAnswer({ boxes: [{ boxId: 'a', ok: true, reason: 'scope' }] })[0]!.ok).toBe(
      false,
    );
  });

  it('words each reason', () => {
    expect(toolReasonText('scope')).toBe(
      'This box has not opened its admin tools to the Control Center (MANTLE_CONTROL_CENTER_SCOPE).',
    );
    for (const r of ['unknown-tool', 'bad-call']) {
      expect(toolReasonText(r)).toBe('This box runs a release before Fleet users.');
    }
    expect(toolReasonText('error')).toBe('The box could not run it.');
    expect(toolReasonText('unreachable')).toBe('This box cannot reach the box over HTTPS.');
    expect(toolReasonText('sig')).toBe('The box holds another key. Copy the key line again.');
    expect(toolReasonText('no-channel')).toBe(NO_CHANNEL_TEXT);
  });

  it('calls the route, and says when it is missing', async () => {
    const sent: unknown[] = [];
    const out = await callFleetTool(['a'], USERS_LIST_TOOL, {}, async (path, method, body) => {
      sent.push({ path, method, body });
      return { boxes: [{ boxId: 'a', ok: true, output: 1 }] };
    });
    expect(sent).toEqual([
      {
        path: '/api/fleet/tool',
        method: 'POST',
        body: { boxIds: ['a'], name: 'users_list', args: {} },
      },
    ]);
    expect(out).toEqual([{ boxId: 'a', ok: true, output: 1, reason: null }]);
    const gone = Object.assign(new Error('not found'), { status: 404 });
    expect(isNoChannel(gone)).toBe(true);
    expect(
      await callFleetTool(['a'], USERS_LIST_TOOL, {}, async () => {
        throw gone;
      }),
    ).toBeNull();
    await expect(
      callFleetTool(['a'], USERS_LIST_TOOL, {}, async () => {
        throw Object.assign(new Error('boom'), { status: 500 });
      }),
    ).rejects.toThrow('boom');
  });
});
