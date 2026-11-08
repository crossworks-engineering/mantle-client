import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * The chats of the in-memory brain, for the bubble specs: one list that holds
 * people, groups and an assistant thread, their lines, the two read cursors
 * and the two live streams, open for as long as the page reads them. With `on`
 * false (the default) the mock answers as before: no chats and quiet streams.
 *
 * It answers as a brain does in the ways the client depends on: the stream
 * events carry ids only, a pending reply is a row with no text, and an
 * assistant thread is a list row with no seq.
 */

export type MockChatLine = {
  id: string;
  conversationId: string;
  seq: number;
  authorKind: 'login' | 'agent' | 'system';
  authorId: string | null;
  authorName: string | null;
  via: null;
  body: string;
  attachments: string[];
  mentions: unknown[];
  replyToSeq: null;
  clientMsgId: null;
  status: 'complete';
  event: null;
  editedAt: null;
  deletedAt: string | null;
  createdAt: string;
  reactions: unknown[];
};

type MockRow = {
  kind: 'direct' | 'group' | 'agent';
  id: string;
  title: string;
  lastSeq: number | null;
  lastMessageAt: string | null;
  preview: { authorName: string | null; text: string; authorKind: string } | null;
  unread: number;
  mention: boolean;
  muted: boolean;
  favourite: boolean;
  participants: unknown[];
  agentSlug?: string;
};

type MockToolStats = {
  calls: number;
  succeeded: number;
  failed: number;
  skipped: number;
  queued: number;
  failures: { slug: string; error: string }[];
};

type MockReply = {
  id: string;
  direction: 'inbound' | 'outbound';
  text: string;
  model: null;
  channel: 'web';
  status: 'pending' | 'complete' | 'failed';
  error: null;
  attachments: unknown[];
  createdAt: string;
  toolStats?: MockToolStats;
};

export type MockChats = {
  on: boolean;
  /** A brain without the messenger: every /api/messenger route answers 404. */
  missing: boolean;
  rows: MockRow[];
  /** A chat of people, listed with nothing unread. */
  addChat(id: string, title: string, kind?: 'direct' | 'group'): void;
  /** The assistant's thread, listed with nothing unread. */
  addThread(id: string, slug: string, title: string): void;
  /** Someone says a line: it counts as unread and the stream says so. */
  say(chat: string, body: string, from?: { id: string; name: string }): void;
  /** A line is edited: the stream says that seq changed, and gives no text. */
  edit(chat: string, seq: number, body: string): void;
  /** A line is deleted: it stays, marked, and the stream says that seq changed. */
  deleteLine(chat: string, seq: number): void;
  /** A reply starts: a pending row, and the thread stream pings. */
  replyStarts(slug: string): void;
  /** The reply got its text: the row is complete, and the stream pings.
   *  `toolStats`: the brain's tally of the turn's tools. */
  replyEnds(slug: string, text: string, toolStats?: MockToolStats): void;
  /** The reply failed: the row stays in the count, as on a brain. */
  replyFails(slug: string): void;
  /** The thread's newest reply is no longer there. */
  replyGone(slug: string): void;
  /** A finished reply the login has read already. Answers its time. */
  replyRead(slug: string, text: string): string;
  /** The chat was read on another device: the list says 0, and the people's
   *  stream says a cursor moved (an assistant thread has no such event). */
  readElsewhere(chat: string): void;
  /** The reads this run asked for. */
  reads: { chat: string; seq: number }[];
  /** The lines this login sent (POST /api/messenger/c/:id/messages). */
  sent: { chat: string; body: string }[];
  /** The chats this login may not write in: a send there is refused, as a
   *  brain refuses a login that may not write by hand. */
  readOnly: Set<string>;
  /** Each reaction call this login made. The route toggles, as a brain's does. */
  reacted: { chat: string; seq: number; emoji: string }[];
  /** The reactions this login has on now, `chat:seq:emoji`. */
  reactionsOn: Set<string>;
  threadReads: { agentSlug: string; at: string | null }[];
  /** Serve the routes this module owns. False: not one of them. */
  handle(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    path: string,
    json: (res: ServerResponse, status: number, body: unknown) => void,
    cors: Record<string, string>,
    readBody: (req: IncomingMessage) => Promise<string>,
  ): Promise<boolean>;
};

export function createMockChats(): MockChats {
  const lines = new Map<string, MockChatLine[]>();
  const replies = new Map<string, MockReply[]>();
  const peopleStreams = new Set<ServerResponse>();
  const threadStreams = new Set<ServerResponse>();
  // Behind the browser's own clock, so a read at "now" passes every row.
  let clock = Date.now() - 3_600_000;
  // Each thread's read cursor. A POST overwrites it, also backwards, as on a
  // brain (mantle_read_cursor_mark).
  const cursors = new Map<string, number>();
  /** A thread counts every reply past its cursor, whatever its status. */
  const threadUnread = (slug: string) =>
    (replies.get(slug) ?? []).filter(
      (r) => r.direction === 'outbound' && Date.parse(r.createdAt) > (cursors.get(slug) ?? 0),
    ).length;
  const rowsNow = () =>
    chats.rows.map((r) => (r.agentSlug ? { ...r, unread: threadUnread(r.agentSlug) } : r));
  const tick = () => new Date((clock += 1000)).toISOString();
  const rowOf = (id: string) => {
    const row = chats.rows.find((r) => r.id === id);
    if (!row) throw new Error(`no chat ${id}`);
    return row;
  };
  const threadOf = (slug: string) => {
    const row = chats.rows.find((r) => r.agentSlug === slug);
    if (!row) throw new Error(`no thread ${slug}`);
    return row;
  };
  const emit = (streams: Set<ServerResponse>, event: unknown) => {
    for (const s of streams) s.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const chats: MockChats = {
    on: false,
    missing: false,
    rows: [],
    reads: [],
    threadReads: [],
    sent: [],
    reacted: [],
    reactionsOn: new Set(),
    readOnly: new Set(),
    addChat(id, title, kind = 'direct') {
      chats.rows.push({
        kind,
        id,
        title,
        lastSeq: 0,
        lastMessageAt: null,
        preview: null,
        unread: 0,
        mention: false,
        muted: false,
        favourite: false,
        participants: [],
      });
      lines.set(id, []);
    },
    addThread(id, slug, title) {
      chats.rows.push({
        kind: 'agent',
        id,
        title,
        lastSeq: null,
        lastMessageAt: null,
        preview: null,
        unread: 0,
        mention: false,
        muted: false,
        favourite: false,
        participants: [],
        agentSlug: slug,
      });
      replies.set(slug, []);
    },
    say(chat, body, from = { id: 'ann-id', name: 'Ann' }) {
      const row = rowOf(chat);
      const list = lines.get(chat) ?? [];
      const seq = (row.lastSeq ?? 0) + 1;
      const createdAt = tick();
      list.push({
        id: `${chat}-${seq}`,
        conversationId: chat,
        seq,
        authorKind: 'login',
        authorId: from.id,
        authorName: from.name,
        via: null,
        body,
        attachments: [],
        mentions: [],
        replyToSeq: null,
        clientMsgId: null,
        status: 'complete',
        event: null,
        editedAt: null,
        deletedAt: null,
        createdAt,
        reactions: [],
      });
      lines.set(chat, list);
      row.lastSeq = seq;
      row.lastMessageAt = createdAt;
      row.preview = { authorName: from.name, text: body.slice(0, 80), authorKind: 'login' };
      row.unread += 1;
      emit(peopleStreams, { c: chat, seq, kind: 'new', actor: from.id, type: 'message' });
    },
    edit(chat, seq, body) {
      const line = (lines.get(chat) ?? []).find((l) => l.seq === seq);
      if (!line) throw new Error(`no line ${seq} in ${chat}`);
      line.body = body;
      emit(peopleStreams, { c: chat, seq, kind: 'edit', actor: line.authorId, type: 'message' });
    },
    deleteLine(chat, seq) {
      const line = (lines.get(chat) ?? []).find((l) => l.seq === seq);
      if (!line) throw new Error(`no line ${seq} in ${chat}`);
      line.deletedAt = tick();
      emit(peopleStreams, { c: chat, seq, kind: 'delete', actor: line.authorId, type: 'message' });
    },
    replyStarts(slug) {
      const row = threadOf(slug);
      const createdAt = tick();
      (replies.get(slug) ?? []).push({
        id: `${slug}-${createdAt}`,
        direction: 'outbound',
        text: '',
        model: null,
        channel: 'web',
        status: 'pending',
        error: null,
        attachments: [],
        createdAt,
      });
      row.lastMessageAt = createdAt;
      row.preview = null;
      emit(threadStreams, { agentSlug: slug, direction: 'outbound' });
    },
    replyEnds(slug, text, toolStats) {
      const row = threadOf(slug);
      const reply = (replies.get(slug) ?? []).find((r) => r.status === 'pending');
      if (!reply) throw new Error(`no pending reply in ${slug}`);
      reply.status = 'complete';
      reply.text = text;
      if (toolStats) reply.toolStats = toolStats;
      row.preview = { authorName: row.title, text: text.slice(0, 80), authorKind: 'agent' };
      emit(threadStreams, { agentSlug: slug, direction: 'outbound' });
    },
    replyFails(slug) {
      const reply = (replies.get(slug) ?? []).find((r) => r.status === 'pending');
      if (!reply) throw new Error(`no pending reply in ${slug}`);
      reply.status = 'failed';
      emit(threadStreams, { agentSlug: slug, direction: 'outbound' });
    },
    replyGone(slug) {
      (replies.get(slug) ?? []).pop();
    },
    replyRead(slug, text) {
      const row = threadOf(slug);
      const createdAt = tick();
      (replies.get(slug) ?? []).push({
        id: `${slug}-${createdAt}`,
        direction: 'outbound',
        text,
        model: null,
        channel: 'web',
        status: 'complete',
        error: null,
        attachments: [],
        createdAt,
      });
      row.lastMessageAt = createdAt;
      row.preview = { authorName: row.title, text: text.slice(0, 80), authorKind: 'agent' };
      cursors.set(slug, Date.parse(createdAt));
      return createdAt;
    },
    readElsewhere(chat) {
      const row = rowOf(chat);
      row.unread = 0;
      if (row.agentSlug) cursors.set(row.agentSlug, clock);
      if (row.kind !== 'agent') {
        emit(peopleStreams, {
          c: chat,
          seq: row.lastSeq,
          kind: 'read',
          loginId: 'me',
          type: 'read',
        });
      }
    },
    async handle(req, res, url, path, json, cors, readBody) {
      if (chats.missing && path.startsWith('/api/messenger/')) {
        json(res, 404, { error: 'not found' });
        return true;
      }
      if (!chats.on) return false;
      const method = req.method ?? 'GET';
      const hold = (streams: Set<ServerResponse>) => {
        res.writeHead(200, {
          ...cors,
          'content-type': 'text/event-stream',
          'cache-control': 'no-store',
        });
        res.write(':\n\n');
        streams.add(res);
        req.on('close', () => streams.delete(res));
      };
      if (method === 'GET' && path === '/api/messenger/stream') {
        hold(peopleStreams);
        return true;
      }
      if (method === 'GET' && path === '/api/assistant/stream') {
        hold(threadStreams);
        return true;
      }
      if (method === 'GET' && path === '/api/messenger/conversations') {
        json(res, 200, { rows: rowsNow() });
        return true;
      }
      if (method === 'GET' && path === '/api/messenger/directory') {
        // The agents with a thread, and Ann (New chat's pick list).
        const entries = [
          ...chats.rows
            .filter((r) => r.agentSlug)
            .map((r) => ({
              kind: 'agent',
              id: r.id,
              name: r.title,
              online: false,
              slug: r.agentSlug,
            })),
          { kind: 'login', id: 'ann-id', name: 'Ann', online: false },
        ];
        json(res, 200, { entries });
        return true;
      }
      if (method === 'GET' && path === '/api/messenger/unread') {
        const count = (kind: (r: MockRow) => boolean) =>
          rowsNow()
            .filter(kind)
            .reduce((sum, r) => sum + r.unread, 0);
        const agents = count((r) => r.kind === 'agent');
        const messenger = count((r) => r.kind !== 'agent');
        json(res, 200, { total: messenger + agents, messenger, agents });
        return true;
      }
      if (method === 'GET' && path === '/api/assistant/messages') {
        const slug = url.searchParams.get('agent') ?? '';
        const limit = Number(url.searchParams.get('limit') ?? 100);
        const before = Date.parse(url.searchParams.get('before') ?? '') || Infinity;
        const rows = (replies.get(slug) ?? []).filter((r) => Date.parse(r.createdAt) < before);
        json(res, 200, { messages: rows.slice(-limit) });
        return true;
      }
      if (method === 'GET' && path === '/api/assistant/conversations') {
        const conversations = rowsNow()
          .filter((r) => r.agentSlug)
          .map((r) => ({
            agentId: r.id,
            slug: r.agentSlug,
            name: r.title,
            unreadCount: r.unread,
            lastMessage: null,
          }));
        json(res, 200, { conversations });
        return true;
      }
      if (method === 'POST' && path === '/api/assistant/read') {
        const body = JSON.parse(await readBody(req)) as { agentSlug: string; at?: string };
        chats.threadReads.push({ agentSlug: body.agentSlug, at: body.at ?? null });
        cursors.set(body.agentSlug, body.at ? Date.parse(body.at) : Date.now());
        json(res, 200, { ok: true });
        return true;
      }
      // A reaction, as the chat's own button gives it.
      // One chat, as the room reads it (GET /api/messenger/c/:id).
      const one = /^\/api\/messenger\/c\/([^/]+)$/.exec(path);
      if (one && method === 'GET') {
        const id = decodeURIComponent(one[1]!);
        const row = chats.rows.find((x) => x.id === id && x.kind !== 'agent');
        if (!row) {
          json(res, 404, { error: 'not found' });
          return true;
        }
        json(res, 200, {
          conversation: {
            id,
            kind: row.kind,
            title: row.kind === 'group' ? row.title : null,
            icon: null,
            color: null,
            info: null,
            createdBy: null,
            createdAt: new Date(0).toISOString(),
            archivedAt: null,
            lastSeq: row.lastSeq ?? 0,
            lastMessageAt: row.lastMessageAt,
            workspaceId: null,
            agentId: null,
            participants: [
              {
                kind: 'login',
                id: 'ann-id',
                name: row.kind === 'group' ? 'Ann' : row.title,
                admin: false,
                leftAt: null,
              },
            ],
            me: {
              admin: true,
              lastReadSeq: 0,
              clearedBeforeSeq: 0,
              muted: row.muted,
              leftSeq: null,
            },
          },
        });
        return true;
      }
      if (method === 'POST' && /^\/api\/messenger\/c\/[^/]+\/typing$/.test(path)) {
        json(res, 200, { ok: true });
        return true;
      }
      const r = /^\/api\/messenger\/c\/([^/]+)\/messages\/(\d+)\/reactions$/.exec(path);
      if (r && method === 'POST') {
        const chat = decodeURIComponent(r[1]!);
        const { emoji } = JSON.parse(await readBody(req)) as { emoji: string };
        chats.reacted.push({ chat, seq: Number(r[2]), emoji });
        const key = `${chat}:${r[2]}:${emoji}`;
        const on = !chats.reactionsOn.has(key);
        if (on) chats.reactionsOn.add(key);
        else chats.reactionsOn.delete(key);
        json(res, 200, { on });
        return true;
      }
      const m = /^\/api\/messenger\/c\/([^/]+)\/(messages|read)$/.exec(path);
      if (!m) return false;
      const chat = decodeURIComponent(m[1]!);
      if (m[2] === 'messages' && method === 'GET') {
        const all = lines.get(chat);
        if (!all) {
          json(res, 404, { error: 'not found' });
          return true;
        }
        const limit = Number(url.searchParams.get('limit') ?? 20);
        const after = url.searchParams.get('after_seq');
        const messages =
          after === null
            ? all.slice(-limit)
            : all.filter((l) => l.seq > Number(after)).slice(0, limit);
        json(res, 200, { messages, hasMore: false, lastSeq: messages.at(-1)?.seq ?? 0 });
        return true;
      }
      // A line of mine: as on a brain, it moves my read cursor to it.
      if (m[2] === 'messages' && method === 'POST') {
        const all = lines.get(chat);
        if (!all) {
          json(res, 404, { error: 'not found' });
          return true;
        }
        const { body, clientMsgId } = JSON.parse(await readBody(req)) as {
          body: string;
          clientMsgId?: string;
        };
        if (chats.readOnly.has(chat)) {
          json(res, 403, { error: 'You can read this chat, not write in it.' });
          return true;
        }
        chats.sent.push({ chat, body });
        const row = rowOf(chat);
        const seq = (row.lastSeq ?? 0) + 1;
        const createdAt = tick();
        const line: MockChatLine = {
          id: `${chat}-${seq}`,
          conversationId: chat,
          seq,
          authorKind: 'login',
          authorId: 'me',
          authorName: 'Me',
          via: null,
          body,
          attachments: [],
          mentions: [],
          replyToSeq: null,
          clientMsgId: null,
          status: 'complete',
          event: null,
          editedAt: null,
          deletedAt: null,
          createdAt,
          reactions: [],
        };
        all.push(line);
        row.lastSeq = seq;
        row.lastMessageAt = createdAt;
        row.unread = 0;
        emit(peopleStreams, { c: chat, seq, kind: 'new', actor: 'me', type: 'message' });
        json(res, 200, { message: { ...line, clientMsgId: clientMsgId ?? null } });
        return true;
      }
      if (m[2] === 'read' && method === 'POST') {
        const { seq } = JSON.parse(await readBody(req)) as { seq: number };
        chats.reads.push({ chat, seq });
        const row = rowOf(chat);
        row.unread = (lines.get(chat) ?? []).filter((l) => l.seq > seq).length;
        json(res, 200, { lastReadSeq: seq });
        return true;
      }
      return false;
    },
  };
  return chats;
}
