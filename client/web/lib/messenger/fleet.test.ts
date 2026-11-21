/**
 * Fleet chat in the chat screen: the @ list's addresses, the chips, the
 * cards, the thread's address, the added lines and the handle check.
 */
import { describe, expect, it } from 'vitest';
import type { MessengerDirectoryEntry, MessengerMessage } from './dto';
import {
  addedLines,
  addressLabel,
  addressPicks,
  bodyWithLines,
  answersToSend,
  deskSite,
  fleetCard,
  formatBytes,
  handleError,
  intakeOf,
  lineChips,
  replyGoesBack,
  replyNote,
  threadTarget,
} from './fleet';
import { mentionsInBody } from './mentions';

const GROUP = 'c0000000-0000-4000-8000-0000000000aa';

const dir: MessengerDirectoryEntry[] = [
  { kind: 'login', id: 'ann', name: 'Ann', online: false },
  {
    kind: 'handle',
    id: GROUP,
    name: 'QA crew',
    handle: 'qa',
    intake: 'bug',
    member: false,
    online: false,
  },
  { kind: 'handle', id: 'here', name: 'This one', handle: 'self', intake: null, online: false },
  {
    kind: 'desk',
    id: 'bug',
    name: 'bugs',
    handle: 'bugs',
    intake: 'bug',
    site: 'IT',
    online: false,
  },
  { kind: 'desk', id: 'feature', name: 'feature', handle: 'feature', site: 'IT', online: false },
];

const line = (over: Partial<MessengerMessage>): MessengerMessage =>
  ({
    id: 'm',
    conversationId: 'c',
    seq: 5,
    authorKind: 'login',
    authorId: 'me',
    authorName: 'Me',
    via: null,
    body: 'hello',
    attachments: [],
    mentions: [],
    replyToSeq: null,
    clientMsgId: null,
    status: 'complete',
    event: null,
    editedAt: null,
    deletedAt: null,
    createdAt: '2026-11-21T10:00:00.000Z',
    reactions: [],
    ...over,
  }) as MessengerMessage;

describe('addressPicks', () => {
  it('lists the handles and desks, never the chat it is in, never a person', () => {
    const picks = addressPicks(dir, 'here');
    expect(picks.map((p) => p.name)).toEqual(['qa', 'bugs (IT)', 'feature (IT)']);
    expect(picks[0]).toMatchObject({
      kind: 'handle',
      id: GROUP,
      intake: 'bug',
      to: { handle: 'qa' },
    });
    expect(picks[1]).toMatchObject({ kind: 'desk', id: 'bug', to: { handle: 'bugs', site: 'IT' } });
    expect(deskSite(dir)).toBe('IT');
    expect(deskSite([])).toBe('IT');
  });

  it('a picked address goes in the send as its kind and id only', () => {
    const picked = [
      { kind: 'handle' as const, id: GROUP, name: 'qa' },
      { kind: 'desk' as const, id: 'bug' as const, name: 'bugs (IT)' },
    ];
    expect(mentionsInBody('to @qa and @bugs (IT) now', picked)).toEqual([
      { kind: 'handle', id: GROUP },
      { kind: 'desk', id: 'bug' },
    ]);
    expect(mentionsInBody('to nobody', picked)).toEqual([]);
  });
});

describe('the intake form of a send', () => {
  const picks = addressPicks(dir);
  it('is the form of its one handle or desk', () => {
    expect(intakeOf([{ kind: 'handle', id: GROUP }], picks)).toBe('bug');
    expect(intakeOf([{ kind: 'desk', id: 'feature' }], picks)).toBe('feature');
    expect(intakeOf([{ kind: 'handle', id: 'here' }], picks)).toBeNull();
  });
  it('two addresses have no form', () => {
    expect(
      intakeOf(
        [
          { kind: 'handle', id: GROUP },
          { kind: 'desk', id: 'bug' },
        ],
        picks,
      ),
    ).toBeNull();
  });
  it('names the address as shown', () => {
    expect(addressLabel({ kind: 'handle', id: GROUP }, picks)).toBe('@qa');
    expect(addressLabel({ kind: 'desk', id: 'request' }, picks, 'NOC')).toBe('@requests (NOC)');
  });
});

describe('lineChips', () => {
  it('shows a handle once the copy is written, and a desk with its status', () => {
    const m = line({
      mentions: [
        { kind: 'handle', id: GROUP, handle: 'qa', seq: 9 },
        { kind: 'handle', id: 'x' },
        { kind: 'desk', id: 'bug', taskId: 't', status: 'received' },
      ],
    });
    expect(lineChips(m, 'IT')).toEqual([
      { key: `h:${GROUP}`, text: 'Sent to @qa' },
      { key: 'd:bug', text: '@bugs (IT): Received by IT', status: 'received' },
    ]);
    expect(lineChips(line({ mentions: [{ kind: 'desk', id: 'feature' }] }))[0]!.text).toBe(
      '@feature (IT): Sent',
    );
    expect(
      lineChips(line({ mentions: [{ kind: 'desk', id: 'request', status: 'answered' }] }))[0]!.text,
    ).toBe('@requests (IT): Answered');
  });
});

describe('fleetCard and the Reply that goes back', () => {
  const copy = line({
    authorKind: 'system',
    authorName: 'Ann',
    event: { type: 'intake', from: { conversationId: 'c1', seq: 3 }, by: 'ann' },
  });
  const report = line({
    authorKind: 'system',
    authorName: 'Ann (NATREF)',
    event: { type: 'desk_copy', taskId: 't', box: { id: 'b', name: 'NATREF' } },
  });
  const back = line({
    authorKind: 'system',
    event: {
      type: 'intake_answer',
      group: { conversationId: GROUP, handle: 'qa', seq: 4 },
      by: 'x',
    },
  });

  it('draws copy lines and lines back as cards', () => {
    expect(fleetCard(copy, 'qa')).toEqual({ label: 'Ann, to @qa', goesBack: true });
    expect(fleetCard(report)).toEqual({
      label: 'Ann (NATREF), report from NATREF',
      goesBack: true,
    });
    expect(fleetCard(back)).toEqual({ label: 'Answer from @qa', goesBack: false });
    expect(
      fleetCard(
        line({ authorKind: 'system', event: { type: 'desk_answer', desk: 'bug', taskId: 't' } }),
      ),
    ).toMatchObject({ goesBack: false });
  });

  it('leaves every other line as it is', () => {
    expect(fleetCard(line({}))).toBeNull();
    expect(
      fleetCard(line({ authorKind: 'system', event: { type: 'call_started', callId: 'k' } })),
    ).toBeNull();
    expect(
      fleetCard(line({ authorKind: 'system', event: { type: 'intake_sender_left', seq: 2 } })),
    ).toBeNull();
  });

  it('only a Reply on a copy line goes back, and the bar says so', () => {
    expect(replyGoesBack(copy)).toBe(true);
    expect(replyGoesBack(report)).toBe(true);
    expect(replyGoesBack(back)).toBe(false);
    expect(replyGoesBack(line({}))).toBe(false);
    expect(replyNote(copy)).toMatch(/goes back to the chat/);
    expect(replyNote(report)).toMatch(/answers the report/);
    expect(replyNote(line({}))).toBeNull();
  });
});

describe('threadTarget', () => {
  it('reads the address from the first line of my own thread', () => {
    const first = (to: object) =>
      line({
        seq: 1,
        authorKind: 'system',
        event: { type: 'to_thread', to } as MessengerMessage['event'],
      });
    expect(threadTarget(first({ conversationId: GROUP }))).toEqual({ kind: 'handle', id: GROUP });
    expect(threadTarget(first({ desk: 'bug' }))).toEqual({ kind: 'desk', id: 'bug' });
    expect(threadTarget(first({ desk: 'nope' }))).toBeNull();
  });
  it('anything else is no thread', () => {
    expect(threadTarget(undefined)).toBeNull();
    expect(threadTarget(line({ seq: 1 }))).toBeNull();
    expect(
      threadTarget(
        line({ seq: 2, authorKind: 'system', event: { type: 'to_thread', to: { desk: 'bug' } } }),
      ),
    ).toBeNull();
  });
});

describe('the lines the app adds', () => {
  it('gives the version, shell, page without query, screen and errors', () => {
    const lines = addedLines({
      appVersion: '0.16.1',
      shell: 'web',
      route: '/files?q=secret#x',
      screen: ' Files ',
      errors: [
        { message: 'boom', source: 'app.js:3' },
        { message: 'bad', source: null },
      ],
    });
    expect(lines.map((l) => `${l.label}: ${l.value}`)).toEqual([
      'App version: 0.16.1',
      'Shell: web',
      'Page: /files',
      'Screen: Files',
      'Client error: boom (app.js:3)',
      'Client error: bad',
    ]);
    expect(bodyWithLines(' text ', lines.slice(0, 2))).toBe(
      'text\n\nApp version: 0.16.1\nShell: web',
    );
    expect(bodyWithLines('', [])).toBe('');
    expect(bodyWithLines('', lines.slice(0, 1))).toBe('App version: 0.16.1');
  });
  it('sends the answers given, trimmed', () => {
    expect(answersToSend({ did: ' clicked ', happened: '  ', expected: 'x' })).toEqual({
      did: 'clicked',
      expected: 'x',
    });
  });
});

describe('handleError', () => {
  it('takes a good handle, a blank one, and a leading @', () => {
    expect(handleError('qa')).toBeNull();
    expect(handleError('@Safety-Team')).toBeNull();
    expect(handleError('  ')).toBeNull();
  });
  it('refuses a bad or reserved handle', () => {
    expect(handleError('a')).toMatch(/2 to 30/);
    expect(handleError('-qa')).toMatch(/2 to 30/);
    expect(handleError('q a')).toMatch(/2 to 30/);
    expect(handleError('bugs')).toMatch(/kept for the box/);
    expect(handleError('everyone')).toMatch(/kept for the box/);
  });
});

it('formatBytes', () => {
  expect(formatBytes(900)).toBe('900 B');
  expect(formatBytes(2048)).toBe('2.0 KB');
  expect(formatBytes(12 * 1024 * 1024)).toBe('12.0 MB');
});
