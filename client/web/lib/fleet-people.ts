/**
 * Fleet users (Control Center task 4): every login on every linked box,
 * one person per email across boxes, the workspaces each login is in, and
 * the workspace changes the Control Center sends. The data comes over the
 * admin channel (lib/fleet-tool.ts): each box's own `users_list` tool, and
 * `workspace_user_set` for the changes, each box answering for itself.
 * Pure, so it is unit-tested.
 *
 * A ban is fleet-wide: it disables the person on every linked box (the Bans
 * write). The brain has no per-box ban.
 */
import { boxName, FLEET_KEY, type FleetBan } from './fleet';
import type { Tone } from './fleet-view';
import { toolReasonText, UUID, type BoxOutcome } from './fleet-tool';

/** Under FLEET_KEY: the Fleet's refresh reads the people again too. */
export const FLEET_PEOPLE_KEY = [...FLEET_KEY, 'users'];

/** The most workspace changes one confirm sends (split per box into calls
 *  of at most 20, MAX_TOOL_CHANGES). */
export const MAX_MEMBER_CHANGES = 40;
/** Not seen for this long reads as stale. */
export const STALE_DAYS = 30;

export type MemberRole = 'user' | 'moderator';
/** What a login is in one workspace: a user, a Moderator, or not in it. */
export type MemberState = MemberRole | 'none';

export type FleetPeopleWorkspace = { id: string; name: string; admin: boolean };

export type FleetPeopleLogin = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  owner: boolean;
  disabled: boolean;
  archived: boolean;
  lastSignInAt: string | null;
  createdAt: string | null;
  workspaces: { id: string; moderator: boolean }[];
};

export type FleetPeople = {
  schema: 1;
  at: string;
  workspaces: FleetPeopleWorkspace[];
  logins: FleetPeopleLogin[];
};

/** A box's login from the ban list: what a box a release behind still gives. */
export type FleetBanLogin = {
  id: string;
  email: string;
  owner: boolean;
  disabled: boolean;
  archived: boolean;
  marked: boolean;
};

export type FleetPeopleBox = {
  id: string;
  url: string;
  label: string | null;
  lastOkAt: string | null;
  lastReason: string | null;
  /** Null: no people list yet, or the box is a release behind. */
  people: FleetPeople | null;
  peopleReason: string | null;
  /** The ban path's login list, only while `people` is null. */
  logins: FleetBanLogin[] | null;
};

export type MemberChange = {
  boxId: string;
  loginId: string;
  workspaceId: string;
  role: MemberState;
};

// --- people --------------------------------------------------------------------

/** One login of a person, on one box. `full`: the box sent its people list
 *  (name, role, workspaces); else only the ban list's email and state. */
export type PersonLogin = {
  boxId: string;
  box: string;
  loginId: string;
  /** The login's own email, as the box sent it. */
  email: string;
  name: string | null;
  role: string | null;
  owner: boolean;
  disabled: boolean;
  archived: boolean;
  lastSignInAt: string | null;
  createdAt: string | null;
  full: boolean;
  workspaces: { id: string; name: string; admin: boolean; moderator: boolean }[];
};

export type Person = {
  /** Lowercase: the key that groups one person across boxes. */
  email: string;
  name: string | null;
  logins: PersonLogin[];
  lastSignInAt: string | null;
  admin: boolean;
  /** Disabled or archived on at least one box. */
  disabled: boolean;
  /** The active bans that hold this email. */
  bans: FleetBan[];
  /** Workspace memberships over every box, the Admin workspace too. */
  memberships: number;
  /** Every login is from a full people list. */
  full: boolean;
};

const lower = (s: string) => s.trim().toLowerCase();
const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);

/** The box's name for each box. */
export function boxNames(boxes: readonly FleetPeopleBox[]): Map<string, string> {
  return new Map(boxes.map((b) => [b.id, boxName(b)]));
}

/** Every login of every box, grouped by email into people, sorted by name
 *  then email. `bans`: the Fleet's bans (only active ones count). */
export function groupPeople(
  boxes: readonly FleetPeopleBox[],
  bans: readonly FleetBan[] = [],
): Person[] {
  const byEmail = new Map<string, PersonLogin[]>();
  const add = (email: string, l: PersonLogin) => {
    const key = lower(email);
    if (!key) return;
    const list = byEmail.get(key) ?? [];
    list.push(l);
    byEmail.set(key, list);
  };
  for (const b of boxes) {
    const name = boxName(b);
    if (b.people) {
      const ws = new Map(b.people.workspaces.map((w) => [w.id, w]));
      for (const l of b.people.logins) {
        add(l.email, {
          boxId: b.id,
          box: name,
          loginId: l.id,
          email: l.email,
          name: l.name?.trim() || null,
          role: l.role,
          owner: l.owner,
          disabled: l.disabled,
          archived: l.archived,
          lastSignInAt: l.lastSignInAt,
          createdAt: l.createdAt,
          full: true,
          workspaces: l.workspaces
            .map((m) => {
              const w = ws.get(m.id);
              return w ? { id: w.id, name: w.name, admin: w.admin, moderator: m.moderator } : null;
            })
            .filter((w): w is NonNullable<typeof w> => w !== null)
            .sort((x, y) => Number(y.admin) - Number(x.admin) || x.name.localeCompare(y.name)),
        });
      }
    } else {
      for (const l of b.logins ?? []) {
        add(l.email, {
          boxId: b.id,
          box: name,
          loginId: l.id,
          email: l.email,
          name: null,
          role: null,
          owner: l.owner,
          disabled: l.disabled,
          archived: l.archived,
          lastSignInAt: null,
          createdAt: null,
          full: false,
          workspaces: [],
        });
      }
    }
  }
  const active = bans.filter((b) => !b.liftedAt);
  const people: Person[] = [];
  for (const [email, logins] of byEmail) {
    logins.sort((a, b) => a.box.localeCompare(b.box));
    people.push({
      email,
      name: logins.find((l) => l.name)?.name ?? null,
      logins,
      lastSignInAt: logins.reduce<string | null>((m, l) => later(m, l.lastSignInAt), null),
      admin: logins.some((l) => l.role === 'admin'),
      disabled: logins.some((l) => l.disabled || l.archived),
      bans: active.filter((b) => b.emails.some((e) => lower(e) === email)),
      memberships: logins.reduce((n, l) => n + l.workspaces.length, 0),
      full: logins.every((l) => l.full),
    });
  }
  return people.sort(
    (a, b) =>
      (a.name ?? a.email).localeCompare(b.name ?? b.email) || a.email.localeCompare(b.email),
  );
}

// --- filters -------------------------------------------------------------------

export const PEOPLE_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'banned', label: 'Banned' },
  { id: 'admins', label: 'Admins' },
  { id: 'noWorkspace', label: 'No workspace' },
  { id: 'stale', label: `Not seen in ${STALE_DAYS} days` },
  { id: 'oneBox', label: 'On one box only' },
  { id: 'disabled', label: 'Disabled' },
] as const;

export type PeopleFilter = (typeof PEOPLE_FILTERS)[number]['id'];

/** Whether a person has not signed in for STALE_DAYS (never counts too).
 *  Only a person every box sent full facts for: a box a release behind
 *  sends no sign-in time. */
export function isStale(p: Person, now: number = Date.now()): boolean {
  if (!p.full) return false;
  if (!p.lastSignInAt) return true;
  const at = new Date(p.lastSignInAt).getTime();
  return Number.isNaN(at) || now - at > STALE_DAYS * 86_400_000;
}

export function matchesFilter(p: Person, f: PeopleFilter, now: number = Date.now()): boolean {
  switch (f) {
    case 'all':
      return true;
    case 'banned':
      return p.bans.length > 0;
    case 'admins':
      return p.admin;
    case 'noWorkspace':
      // The Admin workspace counts as one: an Admin is in a workspace.
      return p.full && p.memberships === 0;
    case 'stale':
      return isStale(p, now);
    case 'oneBox':
      return new Set(p.logins.map((l) => l.boxId)).size === 1;
    case 'disabled':
      return p.disabled;
  }
}

/** A search over email and name: every word must be found. */
export function matchesSearch(p: Person, q: string): boolean {
  const words = lower(q).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = `${p.email} ${p.name ?? ''} ${p.logins.map((l) => l.box).join(' ')}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function filterPeople(
  people: readonly Person[],
  f: PeopleFilter,
  q: string,
  now: number = Date.now(),
): Person[] {
  return people.filter((p) => matchesFilter(p, f, now) && matchesSearch(p, q));
}

/** How many people each filter holds (the search applied). */
export function filterCounts(
  people: readonly Person[],
  q: string,
  now: number = Date.now(),
): Record<PeopleFilter, number> {
  const found = people.filter((p) => matchesSearch(p, q));
  const out = {} as Record<PeopleFilter, number>;
  for (const f of PEOPLE_FILTERS)
    out[f.id] = found.filter((p) => matchesFilter(p, f.id, now)).length;
  return out;
}

/** A login's state in one word. */
export function loginState(l: Pick<PersonLogin, 'owner' | 'disabled' | 'archived'>): {
  tone: Tone | 'muted';
  label: string;
} {
  if (l.archived) return { tone: 'bad', label: 'Archived' };
  if (l.disabled) return { tone: 'bad', label: 'Disabled' };
  if (l.owner) return { tone: 'muted', label: 'Owner' };
  return { tone: 'ok', label: 'Live' };
}

export function roleWord(role: string | null): string {
  if (role === 'admin') return 'Admin';
  if (role === 'member') return 'Member';
  return role ?? 'Unknown';
}

export function stateWord(s: MemberState): string {
  return s === 'moderator' ? 'Moderator' : s === 'user' ? 'User' : 'Not in it';
}

// --- names that need a mark -------------------------------------------------------

/** The shortest id prefix (4 or more) that tells `id` from every other in
 *  `ids`. */
function shortId(id: string, ids: readonly string[]): string {
  for (let n = 4; n < id.length; n++) {
    const p = id.slice(0, n);
    if (ids.every((o) => o === id || !o.startsWith(p))) return p;
  }
  return id;
}

/**
 * A workspace's name as a choice or a confirm shows it. When another
 * workspace of the same box has the same name (case and spaces aside) the
 * name gets a mark, its member count and a short id, so the two never look
 * the same: "Ops (2 people, id 3f2a)".
 */
export function wsLabel(
  people: FleetPeople | null | undefined,
  w: Pick<FleetPeopleWorkspace, 'id' | 'name'>,
): string {
  const same = (people?.workspaces ?? []).filter((x) => normName(x.name) === normName(w.name));
  if (same.length < 2) return w.name;
  const n = (people?.logins ?? []).filter((l) => l.workspaces.some((m) => m.id === w.id)).length;
  const who = n === 1 ? '1 person' : `${n} people`;
  return `${w.name} (${who}, id ${shortId(
    w.id,
    same.map((x) => x.id),
  )})`;
}

/** A login's column when the person has two logins on one box (emails
 *  arrive lowercase, so the email cannot tell them apart): the box, the
 *  day it was made and a short login id. */
export function loginLabel(
  l: Pick<PersonLogin, 'box' | 'loginId' | 'createdAt'>,
  siblings: readonly string[] = [],
): string {
  const made = l.createdAt ? `, made ${l.createdAt.slice(0, 10)}` : '';
  return `${l.box} (login ${shortId(l.loginId, siblings)}${made})`;
}

/** How long ago `iso` was, in plain words. */
export function agoText(iso: string | null, now: number = Date.now()): string {
  const at = iso ? new Date(iso).getTime() : NaN;
  if (Number.isNaN(at)) return 'an unknown time';
  const min = Math.max(0, Math.floor((now - at) / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} days ago`;
}

// --- the membership grid --------------------------------------------------------

/** Why a cell cannot be changed here: the Admin workspace (a role), the box
 *  owner, or a disabled or archived login that is not in the workspace (it
 *  may be taken out of one, never put in). */
export type CellLock = 'admin' | 'owner' | 'disabled';

export type GridCell =
  | { kind: 'missing' }
  /** The box has more than one workspace by this name: see its own rows. */
  | { kind: 'ambiguous'; count: number }
  | {
      kind: 'cell';
      boxId: string;
      loginId: string;
      workspaceId: string;
      state: MemberState;
      lock: CellLock | null;
      /** A disabled or archived login: only Not in it may be picked. */
      removeOnly: boolean;
    };

export type GridRow = {
  key: string;
  name: string;
  /** What the screen shows: the name, marked (wsLabel) when two workspaces
   *  of one box share it. */
  label: string;
  admin: boolean;
  /** One of several workspaces with this name on its box: never merged
   *  with another box's, never copied by name. */
  ambiguous: boolean;
  /** By column key (colKey). */
  cells: Record<string, GridCell>;
};

export type GridColumn = {
  /** boxId:loginId: one person may hold two logins on one box. */
  key: string;
  boxId: string;
  box: string;
  /** The box, and the login's email when the person has two there. */
  label: string;
  loginId: string;
  /** The box sent its people list: its cells can be changed. */
  full: boolean;
  owner: boolean;
  /** Disabled or archived on this box. */
  off: boolean;
};

export const colKey = (boxId: string, loginId: string) => `${boxId}:${loginId}`;

/** A workspace name as copy-by-name compares it: case and spaces aside. */
export const normName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

/** A box's workspaces by normalised name. */
function byName(ws: readonly FleetPeopleWorkspace[]): Map<string, FleetPeopleWorkspace[]> {
  const out = new Map<string, FleetPeopleWorkspace[]>();
  for (const w of ws) {
    const k = normName(w.name);
    out.set(k, [...(out.get(k) ?? []), w]);
  }
  return out;
}

/**
 * The person's workspaces box by box: one row per workspace name on any of
 * the person's boxes (matched without case or extra spaces), one column per
 * login (a box, or two logins on one box). A cell is missing when that box
 * has no workspace by that name, and locked on the Admin workspace (who is
 * an Admin is a role, changed on the box), for the box owner, and for a
 * disabled login that is not in it. A box with two workspaces of one name
 * shows each in its own row (`ambiguous`), never merged. Rows: Admin first,
 * then the workspaces the person is in, then the rest, each by name.
 */
export function membershipGrid(
  person: Person,
  boxes: readonly FleetPeopleBox[],
): { columns: GridColumn[]; rows: GridRow[] } {
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const columns: GridColumn[] = person.logins.map((l) => ({
    key: colKey(l.boxId, l.loginId),
    boxId: l.boxId,
    box: l.box,
    label:
      person.logins.filter((x) => x.boxId === l.boxId).length > 1
        ? loginLabel(
            l,
            person.logins.filter((x) => x.boxId === l.boxId).map((x) => x.loginId),
          )
        : l.box,
    loginId: l.loginId,
    full: l.full,
    owner: l.owner,
    off: l.disabled || l.archived,
  }));
  const rows = new Map<string, GridRow & { member: boolean }>();
  const row = (key: string, w: FleetPeopleWorkspace, ambiguous: boolean, people: FleetPeople) => {
    const r = rows.get(key) ?? {
      key,
      name: w.name,
      label: ambiguous ? wsLabel(people, w) : w.name,
      admin: w.admin,
      ambiguous,
      member: false,
      cells: {},
    };
    rows.set(key, r);
    return r;
  };
  for (const l of person.logins) {
    const people = byId.get(l.boxId)?.people;
    if (!l.full || !people) continue;
    const col = colKey(l.boxId, l.loginId);
    const login = people.logins.find((x) => x.id === l.loginId);
    const mine = new Map((login?.workspaces ?? []).map((m) => [m.id, m.moderator]));
    const off = l.disabled || l.archived;
    const cell = (w: FleetPeopleWorkspace): GridCell => {
      const has = mine.has(w.id);
      const state: MemberState = has ? (mine.get(w.id) ? 'moderator' : 'user') : 'none';
      return {
        kind: 'cell',
        boxId: l.boxId,
        loginId: l.loginId,
        workspaceId: w.id,
        state,
        lock: w.admin ? 'admin' : l.owner ? 'owner' : off && state === 'none' ? 'disabled' : null,
        removeOnly: off,
      };
    };
    for (const [name, list] of byName(people.workspaces)) {
      if (list.length === 1) {
        const r = row(`n:${name}`, list[0]!, false, people);
        r.cells[col] = cell(list[0]!);
        r.admin ||= list[0]!.admin;
        r.member ||= mine.has(list[0]!.id);
        continue;
      }
      // Two or more of one name on this box: each in its own row, and the
      // name's shared row says so for this box.
      const shared = rows.get(`n:${name}`);
      if (shared) shared.cells[col] = { kind: 'ambiguous', count: list.length };
      for (const w of list) {
        const r = row(`id:${l.boxId}:${w.id}`, w, true, people);
        r.cells[col] = cell(w);
        r.member ||= mine.has(w.id);
      }
    }
  }
  // A shared row made after a box's ambiguous name was seen: mark it there.
  for (const l of person.logins) {
    const people = byId.get(l.boxId)?.people;
    if (!l.full || !people) continue;
    const col = colKey(l.boxId, l.loginId);
    for (const [name, list] of byName(people.workspaces)) {
      const shared = rows.get(`n:${name}`);
      if (list.length > 1 && shared && !shared.cells[col]) {
        shared.cells[col] = { kind: 'ambiguous', count: list.length };
      }
    }
  }
  for (const r of rows.values()) {
    for (const c of columns) if (!r.cells[c.key]) r.cells[c.key] = { kind: 'missing' };
  }
  const sorted = [...rows.values()].sort(
    (a, b) =>
      Number(b.admin) - Number(a.admin) ||
      Number(b.member) - Number(a.member) ||
      a.name.localeCompare(b.name) ||
      a.key.localeCompare(b.key),
  );
  return { columns, rows: sorted.map(({ member, ...r }) => (void member, r)) };
}

/** The roles a cell offers: Not in it only, besides its own, for a
 *  disabled login. */
export function cellChoices(cell: Extract<GridCell, { kind: 'cell' }>): MemberState[] {
  if (!cell.removeOnly) return ['none', 'user', 'moderator'];
  return cell.state === 'none' ? ['none'] : [cell.state, 'none'];
}

// --- copy one box's workspaces to another ------------------------------------------

export type CopySkip = {
  name: string;
  why: 'missing' | 'admin' | 'owner' | 'ambiguous' | 'disabled';
  /** For `ambiguous`: the box with more than one, and how many. */
  box?: string;
  count?: number;
};
export type CopyPlan = { changes: MemberChange[]; same: string[]; skipped: CopySkip[] };

/**
 * "Set one box up, then copy": the workspaces the person is in on login
 * column `from` (colKey), given the same role on column `to`, matched by
 * name without case or extra spaces. It adds and sets roles only: a
 * workspace the person is in on `to` and not on `from` stays. Skipped: no
 * workspace by that name on `to`; a name more than one workspace has on
 * either box (never guessed); the Admin workspace (a role); the owner of
 * `to`; a disabled or archived login on `to`.
 */
export function copyPlan(
  person: Person,
  from: string,
  to: string,
  boxes: readonly FleetPeopleBox[],
): CopyPlan {
  const grid = membershipGrid(person, boxes);
  const cols = new Map(grid.columns.map((c) => [c.key, c]));
  const fromBox = cols.get(from)?.label ?? 'that box';
  const toBox = cols.get(to)?.label ?? 'that box';
  const out: CopyPlan = { changes: [], same: [], skipped: [] };
  for (const row of grid.rows) {
    const a = row.cells[from];
    if (!a || a.kind !== 'cell' || a.state === 'none') continue;
    const b = row.cells[to];
    if (row.admin || a.lock === 'admin') {
      out.skipped.push({ name: row.name, why: 'admin' });
    } else if (row.ambiguous) {
      const count = countOnBox(a.boxId, row.name, boxes);
      out.skipped.push({ name: row.name, why: 'ambiguous', box: fromBox, count });
    } else if (b?.kind === 'ambiguous') {
      out.skipped.push({ name: row.name, why: 'ambiguous', box: toBox, count: b.count });
    } else if (!b || b.kind !== 'cell') {
      out.skipped.push({ name: row.name, why: 'missing' });
    } else if (b.lock === 'admin' || b.lock === 'owner') {
      out.skipped.push({ name: row.name, why: b.lock });
    } else if (b.state === a.state) {
      out.same.push(row.name);
    } else if (b.removeOnly) {
      out.skipped.push({ name: row.name, why: 'disabled' });
    } else {
      out.changes.push({
        boxId: b.boxId,
        loginId: b.loginId,
        workspaceId: b.workspaceId,
        role: a.state,
      });
    }
  }
  return out;
}

function countOnBox(boxId: string, name: string, boxes: readonly FleetPeopleBox[]): number {
  const ws = boxes.find((x) => x.id === boxId)?.people?.workspaces ?? [];
  return ws.filter((w) => normName(w.name) === normName(name)).length;
}

export function skipText(s: CopySkip): string {
  switch (s.why) {
    case 'missing':
      return `${s.name}: that box has no workspace by this name.`;
    case 'admin':
      return `${s.name}: the Admin workspace. Who is an Admin is changed on the box itself.`;
    case 'owner':
      return `${s.name}: the owner of that box is never changed here.`;
    case 'ambiguous':
      return `${s.name}: ${s.count ?? 2} workspaces are named ${s.name} on ${s.box ?? 'one box'}, so it is not copied. Set it in the grid.`;
    case 'disabled':
      return `${s.name}: this login is disabled on that box, so it gets no workspace.`;
  }
}

// --- bulk ----------------------------------------------------------------------------

export type BulkSkip = {
  email: string;
  why: 'not-on-box' | 'owner' | 'same' | 'old' | 'disabled';
};

/** Many people into (or out of) one workspace of one box, with one role:
 *  each login the person has on that box. Skipped: a person with no login
 *  there, the owner, a box a release behind, one already so, and a
 *  disabled or archived login given a role (taking it out is fine). */
export function bulkPlan(
  people: readonly Person[],
  boxId: string,
  workspaceId: string,
  role: MemberState,
  boxes: readonly FleetPeopleBox[],
): { changes: MemberChange[]; skipped: BulkSkip[] } {
  const box = boxes.find((b) => b.id === boxId);
  const out = { changes: [] as MemberChange[], skipped: [] as BulkSkip[] };
  for (const p of people) {
    const logins = p.logins.filter((x) => x.boxId === boxId);
    if (logins.length === 0) {
      out.skipped.push({ email: p.email, why: 'not-on-box' });
      continue;
    }
    for (const l of logins) {
      const skip = (why: BulkSkip['why']) => out.skipped.push({ email: l.email, why });
      if (!l.full || !box?.people) {
        skip('old');
        continue;
      }
      if (l.owner) {
        skip('owner');
        continue;
      }
      const m = l.workspaces.find((w) => w.id === workspaceId);
      const now: MemberState = m ? (m.moderator ? 'moderator' : 'user') : 'none';
      if (now === role) {
        skip('same');
        continue;
      }
      if ((l.disabled || l.archived) && role !== 'none') {
        skip('disabled');
        continue;
      }
      out.changes.push({ boxId, loginId: l.loginId, workspaceId, role });
    }
  }
  return out;
}

export function bulkSkipText(s: BulkSkip): string {
  switch (s.why) {
    case 'not-on-box':
      return `${s.email}: no login on that box.`;
    case 'owner':
      return `${s.email}: the owner of that box is never changed here.`;
    case 'same':
      return `${s.email}: already so.`;
    case 'old':
      return `${s.email}: that box runs a release before Fleet users.`;
    case 'disabled':
      return `${s.email}: disabled on that box, so it gets no workspace. Lift the ban or enable it first.`;
  }
}

/** The workspaces of a box a change may name: shared, never Admin. */
export function assignableWorkspaces(
  box: FleetPeopleBox | undefined,
): (FleetPeopleWorkspace & { label: string })[] {
  return (box?.people?.workspaces ?? [])
    .filter((w) => !w.admin)
    .map((w) => ({ ...w, label: wsLabel(box?.people, w) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// --- the admin channel's answers ----------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
const str = (v: unknown) => (typeof v === 'string' ? v : null);

/** What one users_list answer may hold; more is cut. */
export const PEOPLE_CAPS = { logins: 10_000, workspaces: 2_000, memberships: 2_000, text: 200 };

const cap = (v: string | null, n = PEOPLE_CAPS.text) => (v === null ? null : v.slice(0, n));
const uuid = (v: unknown) => (typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : null);

/**
 * A box's `users_list` output as a people list, or null when it is not one.
 * Held to its shape: ids are uuids, `owner` and `admin` are booleans (a row
 * without is dropped as bad), an id seen twice is dropped, counts and
 * strings are capped.
 */
export function parsePeople(output: unknown): FleetPeople | null {
  if (!isObj(output) || !Array.isArray(output.workspaces) || !Array.isArray(output.logins)) {
    return null;
  }
  const wsSeen = new Set<string>();
  const workspaces: FleetPeopleWorkspace[] = [];
  for (const w of output.workspaces.slice(0, PEOPLE_CAPS.workspaces)) {
    if (!isObj(w) || typeof w.admin !== 'boolean') continue;
    const id = uuid(w.id);
    if (!id || wsSeen.has(id)) continue;
    wsSeen.add(id);
    workspaces.push({ id, name: cap(str(w.name)) ?? '', admin: w.admin });
  }
  const loginSeen = new Set<string>();
  const logins: FleetPeopleLogin[] = [];
  for (const l of output.logins.slice(0, PEOPLE_CAPS.logins)) {
    if (!isObj(l) || typeof l.owner !== 'boolean') continue;
    const id = uuid(l.id);
    const email = str(l.email);
    if (!id || !email || loginSeen.has(id)) continue;
    loginSeen.add(id);
    const mine = new Set<string>();
    const ws: { id: string; moderator: boolean }[] = [];
    for (const m of (Array.isArray(l.workspaces) ? l.workspaces : []).slice(
      0,
      PEOPLE_CAPS.memberships,
    )) {
      const wid = isObj(m) ? uuid(m.id) : null;
      if (!wid || mine.has(wid)) continue;
      mine.add(wid);
      ws.push({ id: wid, moderator: (m as Record<string, unknown>).moderator === true });
    }
    logins.push({
      id,
      email: email.toLowerCase().slice(0, 320),
      name: cap(str(l.name)),
      role: cap(str(l.role), 20) ?? 'member',
      owner: l.owner,
      disabled: l.disabled === true,
      archived: l.archived === true,
      lastSignInAt: cap(str(l.lastSignInAt), 40),
      createdAt: cap(str(l.createdAt), 40),
      workspaces: ws,
    });
  }
  return { schema: 1, at: cap(str(output.at), 40) ?? new Date().toISOString(), workspaces, logins };
}

/**
 * The linked boxes with their people, from one `users_list` run. A box
 * that did not answer, or answered something this box cannot read, keeps
 * the list it had (`kept`, by box id), with its reason: the screen says how
 * old it is.
 */
export function peopleBoxes(
  boxes: readonly {
    id: string;
    url: string;
    label: string | null;
    lastOkAt: string | null;
    lastReason: string | null;
  }[],
  outcomes: readonly BoxOutcome[],
  kept: ReadonlyMap<string, FleetPeople> = new Map(),
): FleetPeopleBox[] {
  return boxes.map((b) => {
    const a = outcomes.find((x) => x.boxId === b.id.toLowerCase());
    const people = a?.outcome === 'ok' ? parsePeople(a.output) : null;
    const reason = !a ? null : a.outcome === 'ok' ? (people ? null : 'bad-reply') : a.reason;
    return {
      id: b.id,
      url: b.url,
      label: b.label,
      lastOkAt: b.lastOkAt,
      lastReason: b.lastReason,
      people: people ?? kept.get(b.id) ?? null,
      peopleReason: reason,
      logins: null,
    };
  });
}

/** How one change ended: made, refused by the box, never run, or unknown
 *  (sent, no answer read: the box may still make it). */
export type MemberOutcome = 'ok' | 'refused' | 'not-run' | 'unknown';

/** One change's answer: the box's word for it, or the call's reason. */
export type MemberAnswer = MemberChange & {
  outcome: MemberOutcome;
  was: MemberState | null;
  reason: string | null;
  done: string;
};

const asState = (v: unknown): MemberState | null =>
  v === 'none' || v === 'user' || v === 'moderator' ? v : null;

/** Every change of one call, answered: from the box's results when it ran
 *  the tool (then any per-change ok: false is a refusal, whatever its code),
 *  else each with the call's outcome and reason. */
export function memberAnswers(
  changes: readonly MemberChange[],
  box: BoxOutcome | undefined,
  done: string = new Date().toISOString(),
): MemberAnswer[] {
  const each = (c: MemberChange, outcome: MemberOutcome, reason: string | null, was = null) => ({
    ...c,
    outcome,
    was: was as MemberState | null,
    reason,
    done,
  });
  if (!box) return changes.map((c) => each(c, 'unknown', 'pending'));
  if (box.outcome !== 'ok') return changes.map((c) => each(c, box.outcome, box.reason));
  const results =
    isObj(box.output) && Array.isArray(box.output.results)
      ? box.output.results.filter(isObj)
      : null;
  return changes.map((c) => {
    // The box ran it: a change it does not name is unknown, never not made.
    const r = results?.find((x) => x.loginId === c.loginId && x.workspaceId === c.workspaceId);
    if (!r) return each(c, 'unknown', 'bad-reply');
    if (r.ok === true) return { ...each(c, 'ok', null), was: asState(r.was) };
    const code = str(r.reason);
    return each(c, 'refused', code && /^[a-z][a-z-]{0,39}$/.test(code) ? code : 'refused');
  });
}

/** Changes split into calls: per box, at most MAX_TOOL_CHANGES each, in
 *  the order given. */
export function toolCalls(
  changes: readonly MemberChange[],
  max = 20,
): { boxId: string; changes: MemberChange[] }[] {
  const out: { boxId: string; changes: MemberChange[] }[] = [];
  for (const boxId of [...new Set(changes.map((c) => c.boxId))]) {
    const mine = changes.filter((c) => c.boxId === boxId);
    for (let i = 0; i < mine.length; i += max) out.push({ boxId, changes: mine.slice(i, i + max) });
  }
  return out;
}

/** Whether a change was never run by its box: it stays staged, to send again. */
export function boxLevel(a: MemberAnswer): boolean {
  return a.outcome === 'not-run';
}

const UNKNOWN = ' Not confirmed: the box may still make this change.';

/** Plain words for one change's answer. */
export function memberAnswerText(a: MemberAnswer): { tone: 'ok' | 'warn' | 'bad'; text: string } {
  if (a.outcome === 'ok') {
    if (a.was === a.role) return { tone: 'ok', text: 'No change: it was so already.' };
    if (a.role === 'none') return { tone: 'ok', text: 'Removed.' };
    const role = a.role === 'moderator' ? 'a Moderator' : 'a user';
    if (a.was === 'none' || !a.was) return { tone: 'ok', text: `Added as ${role}.` };
    return { tone: 'ok', text: `Now ${role}.` };
  }
  if (a.outcome === 'unknown') {
    return { tone: 'warn', text: `${toolReasonText(a.reason)}${UNKNOWN}` };
  }
  const nothing = ' Nothing was set.';
  const bad = (text: string) => ({ tone: 'bad' as const, text });
  if (a.outcome === 'not-run') {
    return bad(`${toolReasonText(a.reason, 'workspace_user_set')}${nothing}`);
  }
  switch (a.reason) {
    case 'login':
      return bad(`This login is no longer on this box.${nothing}`);
    case 'owner':
      return bad(`This is the owner of the box. The Control Center never changes it.${nothing}`);
    case 'disabled':
      return bad(`This login is disabled on that box. Lift the ban or enable it first.${nothing}`);
    case 'workspace':
      return bad(`This box has no shared workspace with this id.${nothing}`);
    case 'admin':
      return bad(
        `This is the Admin workspace. Who is an Admin is changed on the box itself.${nothing}`,
      );
    case 'last-moderator':
      return bad(
        `This is the last Moderator of the workspace. Make another user a Moderator first.${nothing}`,
      );
    default:
      return bad(`The box refused it.${nothing}`);
  }
}

// --- what a change says, and where it stands --------------------------------------------

/** The change named in full: who, which workspace, what role, which box. */
export function describeChange(
  c: Pick<MemberChange, 'boxId' | 'loginId' | 'workspaceId' | 'role'>,
  boxes: readonly FleetPeopleBox[],
): string {
  const box = boxes.find((b) => b.id === c.boxId);
  const login = box?.people?.logins.find((l) => l.id === c.loginId);
  const ws = box?.people?.workspaces.find((w) => w.id === c.workspaceId);
  const twins = (box?.people?.logins ?? []).filter((l) => l.email === login?.email);
  const who = !login
    ? 'a login'
    : twins.length > 1
      ? `${login.email} (login ${shortId(
          login.id,
          twins.map((l) => l.id),
        )})`
      : login.email;
  const where = ws ? wsLabel(box?.people, ws) : 'a workspace';
  const on = box ? boxName(box) : 'a box';
  if (c.role === 'none') return `Remove ${who} from ${where} on ${on}`;
  return `${who} in ${where} as ${stateWord(c.role)} on ${on}`;
}

export type CellStatus = { tone: Tone; text: string; role: MemberState; waiting: boolean };

const sameCell = (c: MemberChange, boxId: string, loginId: string, workspaceId: string) =>
  c.boxId === boxId && c.loginId === loginId && c.workspaceId === workspaceId;

/** Where one cell's latest change stands: sending, or its answer. */
export function cellStatus(
  answers: readonly MemberAnswer[],
  sending: readonly MemberChange[],
  boxId: string,
  loginId: string,
  workspaceId: string,
): CellStatus | null {
  const now = sending.filter((c) => sameCell(c, boxId, loginId, workspaceId)).at(-1);
  if (now) return { tone: 'wait', text: 'Sending…', role: now.role, waiting: true };
  const done = answers.filter((a) => sameCell(a, boxId, loginId, workspaceId)).at(-1);
  if (!done) return null;
  const said = memberAnswerText(done);
  return { tone: said.tone, text: said.text, role: done.role, waiting: false };
}

/** This session's workspace changes for these logins, newest first. */
export function memberHistory(
  answers: readonly MemberAnswer[],
  logins: readonly { boxId: string; loginId: string }[],
  boxes: readonly FleetPeopleBox[],
): { key: string; tone: Tone; label: string; text: string; at: string }[] {
  const mine = new Set(logins.map((l) => `${l.boxId}:${l.loginId}`));
  return answers
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => mine.has(`${a.boxId}:${a.loginId}`))
    .map(({ a, i }) => {
      const said = memberAnswerText(a);
      return {
        key: `${i}`,
        tone: said.tone,
        label: describeChange(a, boxes),
        text: said.text,
        at: a.done,
      };
    })
    .sort((x, y) => y.at.localeCompare(x.at) || Number(y.key) - Number(x.key));
}

/** Why a box shows no people list, or an old one; null when it is current. */
export function peopleReasonText(box: FleetPeopleBox, now: number = Date.now()): string | null {
  if (box.people) {
    if (!box.peopleReason) return null;
    const words = toolReasonText(box.peopleReason).replace(/\.$/, '');
    return `The last read failed (${words}). This list is from ${agoText(box.people.at, now)}.`;
  }
  if (box.peopleReason) return toolReasonText(box.peopleReason);
  return 'No people list yet.';
}

/** The toast after a send: how many changes the boxes made, refused, or
 *  never ran. */
export function sentSummary(answers: readonly MemberAnswer[]): {
  tone: 'ok' | 'bad';
  text: string;
} {
  const n = (k: number) => (k === 1 ? '1 change' : `${k} changes`);
  const ok = answers.filter((a) => a.outcome === 'ok').length;
  const left = answers.filter(boxLevel).length;
  const refused = answers.filter((a) => a.outcome === 'refused').length;
  const unknown = answers.filter((a) => a.outcome === 'unknown').length;
  const parts = [`${n(ok)} made.`];
  if (refused > 0) parts.push(`${n(refused)} refused by the box.`);
  if (left > 0) parts.push(`${n(left)} not run: kept, to send again.`);
  if (unknown > 0) parts.push(`${n(unknown)} not confirmed: the box may still make them.`);
  return { tone: refused + left + unknown > 0 ? 'bad' : 'ok', text: parts.join(' ') };
}

/** For a confirm: each box whose list is old (its last read failed), so
 *  the admin knows the changes were planned from it. */
export function staleNotes(
  changes: readonly Pick<MemberChange, 'boxId'>[],
  boxes: readonly FleetPeopleBox[],
  now: number = Date.now(),
): string[] {
  const ids = new Set(changes.map((c) => c.boxId));
  return boxes
    .filter((b) => ids.has(b.id) && b.people && b.peopleReason)
    .map((b) => `${boxName(b)}: ${peopleReasonText(b, now)}`);
}

const changeKey = (c: MemberChange) => `${c.boxId}:${c.loginId}:${c.workspaceId}`;

/** The changes in flight with `more` added (a send that starts). */
export function withSending(list: readonly MemberChange[], more: readonly MemberChange[]) {
  const keys = new Set(list.map(changeKey));
  return [...list, ...more.filter((c) => !keys.has(changeKey(c)))];
}

/** The changes in flight with `done` taken out (a send that ended); the
 *  others stay. */
export function withoutSent(list: readonly MemberChange[], done: readonly MemberChange[]) {
  const keys = new Set(done.map(changeKey));
  return list.filter((c) => !keys.has(changeKey(c)));
}
