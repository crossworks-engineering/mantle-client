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

/** How close to the cap the counter starts to speak (aria-live). */
export const INFO_NEAR = 200;

/** The counter under the field: "123 / 2000"; `near` once within reach of
 *  the limit (the counter is spoken from there, not on every key); `over`
 *  past it (the field caps typing by UTF-16 units as the brain counts, so
 *  only a browser that caps by code points lets a text past it; Save and
 *  Create then wait). */
export function infoCounter(text: string): { text: string; near: boolean; over: boolean } {
  const n = text.length;
  return { text: `${n} / ${INFO_MAX}`, near: n >= INFO_MAX - INFO_NEAR, over: n > INFO_MAX };
}

/** What the New message form says once a brain before the look or the
 *  info dropped it on the create: "icon and colour", "info", or both. */
export function droppedOnCreate(dropped: { look: boolean; info: boolean }): string | null {
  const parts = [dropped.look ? 'icon and colour' : null, dropped.info ? 'info' : null].filter(
    (d): d is string => d !== null,
  );
  if (parts.length === 0) return null;
  return `Group created. This brain does not keep a group’s ${parts.join(' or ')} yet.`;
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
