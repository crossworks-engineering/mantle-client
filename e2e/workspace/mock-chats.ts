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
};

export type MockChats = {
  on: boolean;
  rows: MockRow[];
  /** A chat of people, listed with nothing unread. */
  addChat(id: string, title: string, kind?: 'direct' | 'group'): void;
  /** The assistant's thread, listed with nothing unread. */
  addThread(id: string, slug: string, title: string): void;
  /** Someone says a line: it counts as unread and the stream says so. */
  say(chat: string, body: string, from?: { id: string; name: string }): void;
  /** A reply starts: a pending row, and the thread stream pings. */
  replyStarts(slug: string): void;
  /** The reply got its text: the row is complete, and the stream pings. */
  replyEnds(slug: string, text: string): void;
  /** The chat was read on another device: the list says 0, and the people's
   *  stream says a cursor moved (an assistant thread has no such event). */
  readElsewhere(chat: string): void;
  /** The reads this run asked for. */
  reads: { chat: string; seq: number }[];
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

const NOW = Date.parse('2026-11-07T10:00:00.000Z');

export function createMockChats(): MockChats {
  const lines = new Map<string, MockChatLine[]>();
  const replies = new Map<string, MockReply[]>();
  const peopleStreams = new Set<ServerResponse>();
  const threadStreams = new Set<ServerResponse>();
  let clock = NOW;
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
    rows: [],
    reads: [],
    threadReads: [],
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
      row.unread += 1;
      emit(threadStreams, { agentSlug: slug, direction: 'outbound' });
    },
    replyEnds(slug, text) {
      const row = threadOf(slug);
      const reply = (replies.get(slug) ?? []).find((r) => r.status === 'pending');
      if (!reply) throw new Error(`no pending reply in ${slug}`);
      reply.status = 'complete';
      reply.text = text;
      row.preview = { authorName: row.title, text: text.slice(0, 80), authorKind: 'agent' };
      emit(threadStreams, { agentSlug: slug, direction: 'outbound' });
    },
    readElsewhere(chat) {
      const row = rowOf(chat);
      row.unread = 0;
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
        json(res, 200, { rows: chats.rows });
        return true;
      }
      if (method === 'GET' && path === '/api/messenger/unread') {
        const count = (kind: (r: MockRow) => boolean) =>
          chats.rows.filter(kind).reduce((sum, r) => sum + r.unread, 0);
        const agents = count((r) => r.kind === 'agent');
        const messenger = count((r) => r.kind !== 'agent');
        json(res, 200, { total: messenger + agents, messenger, agents });
        return true;
      }
      if (method === 'GET' && path === '/api/assistant/messages') {
        const slug = url.searchParams.get('agent') ?? '';
        json(res, 200, { messages: replies.get(slug) ?? [] });
        return true;
      }
      if (method === 'POST' && path === '/api/assistant/read') {
        const body = JSON.parse(await readBody(req)) as { agentSlug: string; at?: string };
        chats.threadReads.push({ agentSlug: body.agentSlug, at: body.at ?? null });
        threadOf(body.agentSlug).unread = 0;
        json(res, 200, { ok: true });
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
        const messages = all.slice(-limit);
        json(res, 200, { messages, hasMore: false, lastSeq: messages.at(-1)?.seq ?? 0 });
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
