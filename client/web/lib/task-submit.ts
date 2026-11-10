/**
 * Submit a task (2026-11-10): a person sends a task, with its files, to the
 * box's Admin workspace (later also to IT, on a box linked to a Control
 * Center). An Admin replies once on the copy; then both tasks are done and
 * the sender's task shows the reply.
 *
 * The types mirror the brain's `TaskSubmission` on the task row. The pinned
 * contract package predates them, so they live here until the pin bump that
 * carries them, as `TaskFile` does in ./task-files. Pure helpers below, split
 * from the screen so they can be unit-tested.
 */

export const SUBMISSION_KINDS = ['bug', 'feature', 'request'] as const;
export type SubmissionKind = (typeof SUBMISSION_KINDS)[number];

export const SUBMISSION_KIND_LABEL: Record<SubmissionKind, string> = {
  bug: 'Bug',
  feature: 'Feature',
  request: 'Request',
};

export type SubmitTo = 'admin' | 'it';

/** One entry of `GET /api/tasks/submit`: where this box can send a task. */
export type SubmitTarget = { to: SubmitTo; label: string };

export type SubmissionReply = {
  status: 'done';
  note: string;
  version: string;
  by: string;
  at: string;
};

export type TaskSubmission =
  | {
      side: 'sent';
      kind: SubmissionKind;
      to: SubmitTo;
      sentAt: string;
      copyId?: string;
      collectedAt?: string;
      reply?: SubmissionReply;
    }
  | {
      side: 'received';
      kind: SubmissionKind;
      from: {
        box: { id: string; name: string } | null;
        taskId: string;
        by: { name: string; email: string };
      };
      receivedAt: string;
      reply?: SubmissionReply;
      replySentAt?: string;
    };

/** The reply note's cap and the version's, as the brain checks them. */
export const REPLY_NOTE_MAX = 2000;
export const REPLY_VERSION_MAX = 40;

/** A send button's words: "Send to Admin", "Send to IT". */
export function sendLabel(label: string): string {
  return `Send to ${label}`;
}

/** Where a sent task went, in the words of the box's own button when the box
 *  still lists it, else the plain name. */
export function sentToLabel(to: SubmitTo, targets: readonly SubmitTarget[]): string {
  return targets.find((t) => t.to === to)?.label ?? (to === 'admin' ? 'Admin' : 'IT');
}

/** Who sent a received task: "From Ann (ann@example.com) on Plant box". */
export function fromLabel(from: Extract<TaskSubmission, { side: 'received' }>['from']): string {
  const who = `From ${from.by.name} (${from.by.email})`;
  return from.box ? `${who} on ${from.box.name}` : who;
}

/**
 * Check a reply before it goes. Returns the trimmed body to send, or the
 * reason it cannot go. An empty version is left out, so the brain uses the
 * version the box runs.
 */
export function checkReply(
  note: string,
  version: string,
): { ok: true; body: { note: string; version?: string } } | { ok: false; error: string } {
  const n = note.trim();
  const v = version.trim();
  if (!n) return { ok: false, error: 'Write a note for the reply.' };
  if (n.length > REPLY_NOTE_MAX) {
    return { ok: false, error: `The note is over ${REPLY_NOTE_MAX} characters.` };
  }
  if (v.length > REPLY_VERSION_MAX) {
    return { ok: false, error: `The version is over ${REPLY_VERSION_MAX} characters.` };
  }
  return { ok: true, body: v ? { note: n, version: v } : { note: n } };
}

/** The words for a failed send or reply: the 409 in the screen's words, any
 *  other refusal as the brain says it. */
export function submitErrorText(
  act: 'send' | 'reply',
  status: number | undefined,
  message: string | undefined,
): string {
  if (status === 409) {
    return act === 'send' ? 'This task was sent already.' : 'This task has a reply already.';
  }
  return message || (act === 'send' ? 'Could not send the task.' : 'Could not send the reply.');
}
