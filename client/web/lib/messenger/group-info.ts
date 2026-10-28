/**
 * A group's info (plan section 24): free text that says what the group is
 * for and its rules. Admins write it on the create and edit form; everyone
 * in the group reads it at the top of the group's details; agents read it
 * from messenger_open. The pure half, pinned by group-info.test.ts.
 */
import type { MessengerConversation } from './dto';

/** The brain's limit (migration 0343: char_length(info) <= 2000). */
export const INFO_MAX = 2000;

/** What the form sends: the text trimmed, null when nothing is left (a
 *  patch with null clears it). */
export function infoToSend(text: string): string | null {
  const t = text.trim();
  return t ? t : null;
}

/** The counter under the field: "123 / 2000", and whether it is past the
 *  limit (the field caps typing, but a paste can land past it). */
export function infoCounter(text: string): { text: string; over: boolean } {
  return { text: `${text.length} / ${INFO_MAX}`, over: text.length > INFO_MAX };
}

/** Who edits the info: an admin of a group, still in it. Everyone else
 *  reads it. */
export function canEditInfo(c: Pick<MessengerConversation, 'kind' | 'me'>): boolean {
  return c.kind === 'group' && c.me.admin && c.me.leftSeq === null;
}

/** What the details show: the group's info as the brain holds it, line
 *  breaks kept, or null when there is none (a direct chat, a brain before
 *  0343, an empty value). */
export function infoShown(c: Pick<MessengerConversation, 'kind' | 'info'>): string | null {
  if (c.kind !== 'group') return null;
  const t = c.info;
  return typeof t === 'string' && t.trim() ? t : null;
}

/** Whether the brain keeps a group's info: the key is on the chat it
 *  answers (null when unset); a brain before 0343 answers without it. */
export function keepsGroupInfo(c: object | null | undefined): boolean {
  return !!c && 'info' in c;
}

/** Whether a save changes anything: the trimmed text against what the
 *  brain holds. */
export function infoChanged(current: string | null | undefined, text: string): boolean {
  return infoToSend(text) !== (current ?? null);
}
