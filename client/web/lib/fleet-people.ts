/**
 * Fleet users (Control Center task 4; docs/control-center.md in the mantle
 * repo, "Fleet users"): every login on every linked box, one person per
 * email across boxes, the workspaces each login is in, and the workspace
 * changes the Control Center sends (POST /api/fleet/members, the write
 * `workspaceMember`). The types mirror GET /api/fleet/people. Pure, so it is
 * unit-tested.
 *
 * A ban is fleet-wide: it disables the person on every linked box (the Bans
 * write). The brain has no per-box ban.
 */
import { boxName, FLEET_KEY, FLEET_PATH, reasonText, type FleetBan, type FleetBox } from './fleet';
import { answerText, type FleetWriteAnswer, type FleetWriteChange } from './fleet-writes';
import type { Tone } from './fleet-view';

export const FLEET_PEOPLE_PATH = `${FLEET_PATH}/people`;
/** Under FLEET_KEY: the Fleet's refresh reads the people again too. */
export const FLEET_PEOPLE_KEY = [...FLEET_KEY, 'people'];
export const FLEET_MEMBERS_PATH = `${FLEET_PATH}/members`;

/** The most workspace changes one request sends (the brain's cap). */
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

export type FleetPeopleAnswer = { boxes: FleetPeopleBox[] };

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

// --- the membership grid --------------------------------------------------------

/** Why a cell cannot be changed here. */
export type CellLock = 'admin' | 'owner';

export type GridCell =
  | { kind: 'missing' }
  | {
      kind: 'cell';
      boxId: string;
      loginId: string;
      workspaceId: string;
      state: MemberState;
      lock: CellLock | null;
    };

export type GridRow = {
  key: string;
  name: string;
  admin: boolean;
  cells: Record<string, GridCell>;
};

export type GridColumn = {
  boxId: string;
  box: string;
  loginId: string;
  /** The box sent its people list: its cells can be changed. */
  full: boolean;
  owner: boolean;
};

/** A box's workspaces keyed by name (lowercase), a second one with the same
 *  name as `name#2`, and so on. */
function keyedWorkspaces(ws: readonly FleetPeopleWorkspace[]): Map<string, FleetPeopleWorkspace> {
  const out = new Map<string, FleetPeopleWorkspace>();
  const seen = new Map<string, number>();
  for (const w of [...ws].sort((a, b) => a.id.localeCompare(b.id))) {
    const base = lower(w.name);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.set(n === 1 ? base : `${base}#${n}`, w);
  }
  return out;
}

/**
 * The person's workspaces box by box: one row per workspace name on any of
 * the person's boxes (matched without case), one column per box the person
 * is on. A cell is missing when that box has no workspace by that name, and
 * locked on the Admin workspace (who is an Admin is a role, changed on the
 * box) and for the box owner. Rows: Admin first, then the workspaces the
 * person is in, then the rest, each by name.
 */
export function membershipGrid(
  person: Person,
  boxes: readonly FleetPeopleBox[],
): { columns: GridColumn[]; rows: GridRow[] } {
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const columns: GridColumn[] = person.logins.map((l) => ({
    boxId: l.boxId,
    box: l.box,
    loginId: l.loginId,
    full: l.full,
    owner: l.owner,
  }));
  const rows = new Map<string, GridRow & { member: boolean }>();
  for (const l of person.logins) {
    const people = byId.get(l.boxId)?.people;
    if (!l.full || !people) continue;
    const login = people.logins.find((x) => x.id === l.loginId);
    const mine = new Map((login?.workspaces ?? []).map((m) => [m.id, m.moderator]));
    for (const [key, w] of keyedWorkspaces(people.workspaces)) {
      const row = rows.get(key) ?? {
        key,
        name: w.name,
        admin: w.admin,
        member: false,
        cells: {},
      };
      const has = mine.has(w.id);
      row.member ||= has;
      row.admin ||= w.admin;
      row.cells[l.boxId] = {
        kind: 'cell',
        boxId: l.boxId,
        loginId: l.loginId,
        workspaceId: w.id,
        state: has ? (mine.get(w.id) ? 'moderator' : 'user') : 'none',
        lock: w.admin ? 'admin' : l.owner ? 'owner' : null,
      };
      rows.set(key, row);
    }
  }
  for (const row of rows.values()) {
    for (const c of columns) if (!row.cells[c.boxId]) row.cells[c.boxId] = { kind: 'missing' };
  }
  const sorted = [...rows.values()].sort(
    (a, b) =>
      Number(b.admin) - Number(a.admin) ||
      Number(b.member) - Number(a.member) ||
      a.name.localeCompare(b.name),
  );
  return { columns, rows: sorted.map(({ member, ...r }) => (void member, r)) };
}

// --- copy one box's workspaces to another ------------------------------------------

export type CopySkip = { name: string; why: 'missing' | 'admin' | 'owner' };
export type CopyPlan = { changes: MemberChange[]; same: string[]; skipped: CopySkip[] };

/**
 * "Set one box up, then copy": the workspaces the person is in on box
 * `from`, given the same role on box `to` (matched by name, without case).
 * It adds and sets roles only: a workspace the person is in on `to` and not
 * on `from` stays. Skipped: no workspace by that name on `to`, the Admin
 * workspace (a role), and the owner of `to`.
 */
export function copyPlan(
  person: Person,
  from: string,
  to: string,
  boxes: readonly FleetPeopleBox[],
): CopyPlan {
  const grid = membershipGrid(person, boxes);
  const out: CopyPlan = { changes: [], same: [], skipped: [] };
  for (const row of grid.rows) {
    const a = row.cells[from];
    if (!a || a.kind !== 'cell' || a.state === 'none') continue;
    const b = row.cells[to];
    if (row.admin || a.lock === 'admin') {
      out.skipped.push({ name: row.name, why: 'admin' });
    } else if (!b || b.kind !== 'cell') {
      out.skipped.push({ name: row.name, why: 'missing' });
    } else if (b.lock) {
      out.skipped.push({ name: row.name, why: b.lock === 'admin' ? 'admin' : 'owner' });
    } else if (b.state === a.state) {
      out.same.push(row.name);
    } else {
      out.changes.push({
        boxId: to,
        loginId: b.loginId,
        workspaceId: b.workspaceId,
        role: a.state,
      });
    }
  }
  return out;
}

export function skipText(s: CopySkip): string {
  switch (s.why) {
    case 'missing':
      return `${s.name}: that box has no workspace by this name.`;
    case 'admin':
      return `${s.name}: the Admin workspace. Who is an Admin is changed on the box itself.`;
    case 'owner':
      return `${s.name}: the owner of that box is never changed here.`;
  }
}

// --- bulk ----------------------------------------------------------------------------

export type BulkSkip = { email: string; why: 'not-on-box' | 'owner' | 'same' | 'old' };

/** Many people into (or out of) one workspace of one box, with one role.
 *  Skipped: a person with no login on that box, the owner, a box a release
 *  behind, and one already so. */
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
    const l = p.logins.find((x) => x.boxId === boxId);
    if (!l) {
      out.skipped.push({ email: p.email, why: 'not-on-box' });
      continue;
    }
    if (!l.full || !box?.people) {
      out.skipped.push({ email: p.email, why: 'old' });
      continue;
    }
    if (l.owner) {
      out.skipped.push({ email: p.email, why: 'owner' });
      continue;
    }
    const m = l.workspaces.find((w) => w.id === workspaceId);
    const now: MemberState = m ? (m.moderator ? 'moderator' : 'user') : 'none';
    if (now === role) {
      out.skipped.push({ email: p.email, why: 'same' });
      continue;
    }
    out.changes.push({ boxId, loginId: l.loginId, workspaceId, role });
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
  }
}

/** The workspaces of a box a change may name: shared, never Admin. */
export function assignableWorkspaces(box: FleetPeopleBox | undefined): FleetPeopleWorkspace[] {
  return (box?.people?.workspaces ?? [])
    .filter((w) => !w.admin)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// --- what a change says, and where it stands --------------------------------------------

type MemberWrite = Extract<FleetWriteChange, { kind: 'workspaceMember' }>;
const isMember = (c: FleetWriteChange): c is MemberWrite => c.kind === 'workspaceMember';

/** The change named in full: who, which workspace, what role, which box. */
export function describeChange(
  c: Pick<MemberChange, 'boxId' | 'loginId' | 'workspaceId' | 'role'>,
  boxes: readonly FleetPeopleBox[],
): string {
  const box = boxes.find((b) => b.id === c.boxId);
  const login = box?.people?.logins.find((l) => l.id === c.loginId);
  const ws = box?.people?.workspaces.find((w) => w.id === c.workspaceId);
  const who = login?.email ?? 'a login';
  const where = ws?.name ?? 'a workspace';
  const on = box ? boxName(box) : 'a box';
  if (c.role === 'none') return `Remove ${who} from ${where} on ${on}`;
  return `${who} in ${where} as ${stateWord(c.role)} on ${on}`;
}

export type CellStatus = { tone: Tone; text: string; role: MemberState; waiting: boolean };

/** Where the latest change of one cell stands: waiting, or the box's answer
 *  (only one newer than `since`, the people list's time, so an answer the
 *  list already shows is not repeated). Null: nothing to say. */
export function cellStatus(
  box: Pick<FleetBox, 'writeJob' | 'writeResult'> | undefined,
  loginId: string,
  workspaceId: string,
  since: string | null = null,
): CellStatus | null {
  if (!box) return null;
  const same = (c: FleetWriteChange) =>
    isMember(c) && c.loginId === loginId && c.workspaceId === workspaceId;
  const waiting = (box.writeJob?.changes ?? []).filter(same).at(-1) as
    (MemberWrite & { at: string }) | undefined;
  if (waiting) {
    return { tone: 'wait', text: 'Waiting for the next run.', role: waiting.role, waiting: true };
  }
  const done = (box.writeResult?.results ?? []).filter(same).at(-1) as
    (FleetWriteAnswer & MemberWrite) | undefined;
  if (!done) return null;
  if (since && done.done <= since && done.ok) return null;
  const said = answerText(done);
  return { tone: said.tone, text: said.text, role: done.role, waiting: false };
}

/** Every workspace change for these logins, newest first: waiting ones,
 *  then the box's answers. */
export function memberHistory(
  fleetBoxes: readonly FleetBox[],
  logins: readonly { boxId: string; loginId: string }[],
  boxes: readonly FleetPeopleBox[],
): { key: string; tone: Tone; label: string; text: string; at: string; by: string }[] {
  const out: { key: string; tone: Tone; label: string; text: string; at: string; by: string }[] =
    [];
  for (const fb of fleetBoxes) {
    const mine = new Set(logins.filter((l) => l.boxId === fb.id).map((l) => l.loginId));
    if (mine.size === 0) continue;
    (fb.writeJob?.changes ?? []).forEach((c, i) => {
      if (!isMember(c) || !mine.has(c.loginId)) return;
      out.push({
        key: `${fb.id}-w-${i}`,
        tone: 'wait',
        label: describeChange({ ...c, boxId: fb.id }, boxes),
        text: 'Waiting for the next run.',
        at: c.at,
        by: c.by,
      });
    });
    (fb.writeResult?.results ?? []).forEach((r, i) => {
      if (!isMember(r) || !mine.has(r.loginId)) return;
      const said = answerText(r);
      out.push({
        key: `${fb.id}-r-${i}`,
        tone: said.tone,
        label: describeChange({ ...r, boxId: fb.id }, boxes),
        text: said.text,
        at: r.done,
        by: r.by,
      });
    });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/** Why a box shows no people list, or null when it has one. */
export function peopleReasonText(box: FleetPeopleBox): string | null {
  if (box.people) return null;
  if (box.peopleReason === 'bad-call') {
    return 'This box runs a release before Fleet users: it shows its logins only, without workspaces.';
  }
  if (box.peopleReason) return reasonText(box.peopleReason) ?? 'The last read failed.';
  return 'No people list yet. It comes with the next good run.';
}

/** The toast after a send: how many changes went, and the boxes not queued. */
export function membersSentText(
  changes: readonly MemberChange[],
  queued: readonly string[],
): string {
  const q = new Set(queued);
  const sent = changes.filter((c) => q.has(c.boxId)).length;
  const left = changes.length - sent;
  const n = (k: number) => (k === 1 ? '1 change' : `${k} changes`);
  const head =
    sent > 0 ? `Sent ${n(sent)}. Each box makes it at its next run.` : 'Nothing was queued.';
  return left > 0 ? `${head} ${n(left)} not queued: 40 changes wait on that box already.` : head;
}
