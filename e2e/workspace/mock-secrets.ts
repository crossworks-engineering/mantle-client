/**
 * Shared secrets on the in-memory brain (mantle docs/secrets.md, "Sharing";
 * brain migration 0400): a secret is a workspace kind, shared like a page.
 * The routes, in the brain's shapes:
 *
 *   GET    /api/secrets               the secrets the login reads, with caps
 *   GET    /api/secrets/:id           one of them, or 404
 *   POST   /api/secrets/:id/reveal    its value, for a login that reads it
 *   PATCH  /api/secrets/:id           needs edit (a grant with Write on)
 *   DELETE /api/secrets/:id           needs manage (a Moderator of its home)
 *   GET    /api/tree/secrets[/search] the same rows as a tree
 *   GET    /api/grants/:id            a secret's grants, for the Access panel
 *
 * Three secrets: one in Team (the member moderates it), one in Field crew
 * (the member reads it; `fieldWrite` is that grant's Write switch) and one
 * in Board room (the member is not in it). Every value here is made up for
 * the mock.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

type Role = 'admin' | 'member';
type Ws = { id: string; name: string };

export const MOCK_SECRET_VALUE = 'mock-value-not-a-real-key';
export const MOCK_SECRET_NOTE = 'MOCK_ENV=1';

export const SECRETS = {
  team: { id: '51515151-5151-4515-8515-515151515151', title: 'Team router login' },
  field: { id: '52525252-5252-4525-8525-525252525252', title: 'Field gate code' },
  board: { id: '53535353-5353-4535-8535-535353535353', title: 'Board safe' },
} as const;
type SecretKey = keyof typeof SECRETS;

export type MockSecrets = {
  /** The Write switch of the Field crew grant: off, the member only reads. */
  fieldWrite: boolean;
  /** Every reveal answered: who and which secret. Never a value. */
  reveals: { role: Role; id: string }[];
  /** Every PATCH: who, which secret, and the answer's status. */
  patches: { role: Role; id: string; status: number }[];
  /** The titles as saved (a PATCH that passed changes one). */
  titles: Record<SecretKey, string>;
  handle: (
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    path: string,
    role: Role,
    json: (res: ServerResponse, status: number, body: unknown) => void,
    readBody: (req: IncomingMessage) => Promise<string>,
  ) => Promise<boolean>;
};

const NOW = '2026-11-27T08:00:00.000Z';
const ID = '[0-9a-f-]{36}';

/** The mock's secrets, in the workspaces the main mock names. */
export function createMockSecrets(ws: { team: Ws; field: Ws; board: Ws }): MockSecrets {
  const HOME: Record<SecretKey, Ws> = { team: ws.team, field: ws.field, board: ws.board };
  const state: MockSecrets = {
    fieldWrite: false,
    reveals: [],
    patches: [],
    titles: {
      team: SECRETS.team.title,
      field: SECRETS.field.title,
      board: SECRETS.board.title,
    },
    handle: async () => false,
  };

  const keyOf = (id: string): SecretKey | null =>
    (Object.keys(SECRETS) as SecretKey[]).find((k) => SECRETS[k].id === id) ?? null;
  /** Who reads what: the admin all three; the member Team and Field crew. */
  const reads = (role: Role, k: SecretKey) => role === 'admin' || k !== 'board';
  /** The caps, as the brain's row rules give them. */
  const capsOf = (role: Role, k: SecretKey) => {
    if (role === 'admin' || k === 'team') return { mayEdit: true, mayManage: true, mayMove: true };
    return { mayEdit: state.fieldWrite, mayManage: false, mayMove: false };
  };
  const row = (role: Role, k: SecretKey) => ({
    id: SECRETS[k].id,
    title: state.titles[k],
    description: '',
    kind: k === 'field' ? 'password' : 'server',
    tags: [],
    hasNote: true,
    fieldCount: 2,
    summary: null,
    createdAt: NOW,
    updatedAt: NOW,
    workspaces: [{ id: HOME[k].id, name: HOME[k].name }],
    hasLink: false,
    ...capsOf(role, k),
  });
  const treeItem = (role: Role, k: SecretKey) => ({
    id: SECRETS[k].id,
    title: state.titles[k],
    icon: null,
    color: null,
    subtype: k === 'field' ? 'password' : 'server',
    level: 'team',
    state: null,
    updatedAt: NOW,
    workspaces: [{ id: HOME[k].id, name: HOME[k].name }],
    hasLink: false,
    ...capsOf(role, k),
  });
  const mine = (role: Role) => (Object.keys(SECRETS) as SecretKey[]).filter((k) => reads(role, k));
  const gone = { error: 'not found' };

  state.handle = async (req, res, url, path, role, json, readBody) => {
    const method = req.method ?? 'GET';

    const treeM = /^\/api\/tree\/secrets(\/search)?$/.exec(path);
    if (treeM && method === 'GET') {
      const items = mine(role).map((k) => treeItem(role, k));
      if (treeM[1]) {
        const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
        const hits = items
          .filter((i) => i.title.toLowerCase().includes(q))
          .map((i) => ({ ...i, crumbs: [] }));
        json(res, 200, { kind: 'secrets', folders: [], items: hits, nextCursor: null });
        return true;
      }
      json(res, 200, {
        kind: 'secrets',
        folder: null,
        crumbs: [],
        folders: [],
        items,
        sort: url.searchParams.get('sort') ?? 'name',
        nextCursor: null,
      });
      return true;
    }

    if (path === '/api/secrets' && method === 'GET') {
      const secrets = mine(role).map((k) => row(role, k));
      json(res, 200, { secrets, total: secrets.length, page: 1, pageSize: 50 });
      return true;
    }

    const grantsM = new RegExp(`^/api/grants/(${ID})$`).exec(path);
    if (grantsM && method === 'GET') {
      const k = keyOf(grantsM[1]!);
      if (!k) return false;
      if (!reads(role, k)) return (json(res, 404, gone), true);
      const caps = capsOf(role, k);
      json(res, 200, {
        item: { id: SECRETS[k].id, title: state.titles[k], type: 'secret' },
        home: { wsId: HOME[k].id, name: HOME[k].name },
        rows: [
          {
            wsId: HOME[k].id,
            name: HOME[k].name,
            write: k === 'field' ? state.fieldWrite : true,
            isHome: true,
            viaFolder: null,
            excluded: false,
          },
        ],
        addable: [],
        mayManage: caps.mayManage,
        // A secret never carries a public link (the kind's `publicLink`).
        mayLink: false,
        hasLink: false,
        link: null,
        serveCandidates: [],
        embedsNotGranted: [],
      });
      return true;
    }

    const revealM = new RegExp(`^/api/secrets/(${ID})/reveal$`).exec(path);
    if (revealM && method === 'POST') {
      const k = keyOf(revealM[1]!);
      if (!k || !reads(role, k)) return (json(res, 404, gone), true);
      state.reveals.push({ role, id: SECRETS[k].id });
      json(res, 200, {
        metadata: row(role, k),
        payload: {
          note: MOCK_SECRET_NOTE,
          fields: [
            { label: 'username', value: 'crew' },
            { label: 'password', value: MOCK_SECRET_VALUE },
          ],
        },
      });
      return true;
    }

    const oneM = new RegExp(`^/api/secrets/(${ID})$`).exec(path);
    if (oneM) {
      const k = keyOf(oneM[1]!);
      if (!k || !reads(role, k)) return (json(res, 404, gone), true);
      if (method === 'GET') return (json(res, 200, { secret: row(role, k) }), true);
      const refused = { error: 'forbidden', reason: 'item-workspace' };
      if (method === 'PATCH') {
        const body = JSON.parse((await readBody(req)) || '{}') as { title?: unknown };
        const ok = capsOf(role, k).mayEdit;
        state.patches.push({ role, id: SECRETS[k].id, status: ok ? 200 : 403 });
        if (!ok) return (json(res, 403, refused), true);
        if (typeof body.title === 'string' && body.title) state.titles[k] = body.title;
        return (json(res, 200, { secret: row(role, k) }), true);
      }
      if (method === 'DELETE') {
        if (!capsOf(role, k).mayManage) return (json(res, 403, refused), true);
        return (json(res, 200, { ok: true }), true);
      }
    }
    return false;
  };
  return state;
}
