/**
 * Fleet chat phase 1 (brain plan page f2f19c7b, sections 2 to 4): group
 * handles, the three fixed intake forms and the IT desks.
 *
 * LOCAL COPY of the brain's `@mantle/client-types/messenger-intake` (mantle
 * branch claude/fleet-chat-3-579456, not released yet: client-types 0.709.0
 * has none of it). It goes once a client-types release ships it; then this
 * file re-exports from there. Pure, no imports.
 */

/** A handle: 2 to 30 characters, lowercase letters, digits and dashes, no
 *  dash first or last (the brain's column check, 0394). Shown as `@bugs`. */
export const MESSENGER_HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])$/;

/** Words no group may take as its handle. The box also refuses the slugs
 *  of its own agents. `bugs`, `feature` and `requests` are the IT desks. */
export const MESSENGER_HANDLE_RESERVED: readonly string[] = [
  'all',
  'here',
  'everyone',
  'admin',
  'system',
  'it',
  'bugs',
  'feature',
  'requests',
];

/** The most handles (and IT desks) one message may name. */
export const MESSENGER_HANDLES_PER_MESSAGE = 3;

/** A handle as typed (`@Bugs `), as stored (`bugs`); null when it is no
 *  handle by the format rule. */
export function normalizeHandle(raw: string): string | null {
  const h = raw.trim().replace(/^@/, '').toLowerCase();
  return MESSENGER_HANDLE_RE.test(h) ? h : null;
}

/** The forms a group may ask for: the three Send to IT kinds. */
export const MESSENGER_INTAKE_KINDS = ['bug', 'feature', 'request'] as const;
export type MessengerIntakeKind = (typeof MESSENGER_INTAKE_KINDS)[number];

export type MessengerIntakeQuestion = { key: string; label: string };

/** The three fixed forms (plan section 4). There is no form editor. */
export const MESSENGER_INTAKE_FORMS: Readonly<
  Record<MessengerIntakeKind, readonly MessengerIntakeQuestion[]>
> = {
  bug: [
    { key: 'did', label: 'What did you do?' },
    { key: 'happened', label: 'What happened?' },
    { key: 'expected', label: 'What did you expect?' },
  ],
  feature: [
    { key: 'need', label: 'What do you need?' },
    { key: 'who', label: 'Who uses it, and how often?' },
  ],
  request: [{ key: 'need', label: 'What do you need, and by when?' }],
};

export function isMessengerIntakeKind(v: unknown): v is MessengerIntakeKind {
  return typeof v === 'string' && (MESSENGER_INTAKE_KINDS as readonly string[]).includes(v);
}

/** The longest answer to one question. */
export const MESSENGER_INTAKE_ANSWER_MAX = 2000;

/** The IT desks a box linked to a Control Center shows in its @ list: one
 *  for each Send to IT kind. */
export const IT_DESKS: readonly { handle: string; kind: MessengerIntakeKind }[] = [
  { handle: 'bugs', kind: 'bug' },
  { handle: 'feature', kind: 'feature' },
  { handle: 'requests', kind: 'request' },
];

/** The names of the forms, as a picker shows them. */
export const INTAKE_NAMES: Readonly<Record<MessengerIntakeKind, string>> = {
  bug: 'Bug report',
  feature: 'Feature request',
  request: 'Request',
};
