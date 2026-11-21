/**
 * Fleet chat phase 1 in the chat screen (brain plan page f2f19c7b,
 * milestone 4), the pure half: the @ list's handles and IT desks, the
 * chips on a line, the cards of copy lines and lines back, the thread to an
 * address, the lines the app adds to a report, and the file caps. Pinned by
 * fleet.test.ts.
 *
 * Two owner choices are open and not built: push for copy lines, and
 * whether every Reply on a copy line goes back or only a "Reply to sender".
 * `replyGoesBack` is the one place the second answer goes.
 */
import type {
  MessengerDeskKind,
  MessengerDeskStatus,
  MessengerDirectoryEntry,
  MessengerMention,
  MessengerMessage,
} from './dto';
import {
  IT_DESKS,
  MESSENGER_HANDLES_PER_MESSAGE,
  MESSENGER_HANDLE_RESERVED,
  MESSENGER_INTAKE_FORMS,
  isMessengerIntakeKind,
  normalizeHandle,
  type MessengerIntakeKind,
} from './intake';

/** The Send to IT caps the brain keeps for a chat file: 10 MB a file, 5 a
 *  line. A file over the cap is not uploaded; the line names it. */
export const FILE_MAX_BYTES = 10 * 1024 * 1024;
export const FILES_PER_LINE = 5;
/** The site a desk shows when the directory gives none. */
export const DEFAULT_SITE = 'IT';

/** A file's size, as a person reads it. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** A desk's handle (`bugs`) from its kind. */
export function deskHandle(kind: MessengerDeskKind): string {
  return IT_DESKS.find((d) => d.kind === kind)?.handle ?? kind;
}

/** A desk as written after its "@": `bugs (IT)`. */
export function deskName(kind: MessengerDeskKind, site = DEFAULT_SITE): string {
  return `${deskHandle(kind)} (${site})`;
}

/** An address the @ list offers beside the chat's people: a handle (`name`
 *  is the handle, `title` the group's) or an IT desk (`name` is `bugs
 *  (IT)`). */
export type AddressPick = {
  kind: 'handle' | 'desk';
  id: string;
  name: string;
  title: string;
  intake: MessengerIntakeKind | null;
  /** What `POST /api/messenger/to` takes: the handle (`qa`, `bugs`) and,
   *  for a desk, its site. */
  to: { handle: string; site?: string };
};

/** The handles and desks of the directory, for the @ list of chat
 *  `here` (its own handle is left out: a line there is in the group). */
export function addressPicks(
  directory: readonly MessengerDirectoryEntry[],
  here?: string | null,
): AddressPick[] {
  const out: AddressPick[] = [];
  for (const e of directory) {
    if (e.kind === 'handle' && e.handle && e.id !== here) {
      out.push({
        kind: 'handle',
        id: e.id,
        name: e.handle,
        title: e.name,
        intake: isMessengerIntakeKind(e.intake) ? e.intake : null,
        to: { handle: e.handle },
      });
    } else if (e.kind === 'desk' && isMessengerIntakeKind(e.id)) {
      out.push({
        kind: 'desk',
        id: e.id,
        name: deskName(e.id, e.site || DEFAULT_SITE),
        title: `IT desk at ${e.site || DEFAULT_SITE}`,
        intake: e.id,
        to: { handle: e.handle || deskHandle(e.id), ...(e.site ? { site: e.site } : {}) },
      });
    }
  }
  return out;
}

/** The site the directory names for the desks (they share one). */
export function deskSite(directory: readonly MessengerDirectoryEntry[]): string {
  return directory.find((e) => e.kind === 'desk' && e.site)?.site ?? DEFAULT_SITE;
}

/** How far a report to a desk is, as the chip says it. */
export function deskStatusText(status: MessengerDeskStatus | undefined, site: string): string {
  if (status === 'answered') return 'Answered';
  if (status === 'received') return `Received by ${site}`;
  return 'Sent';
}

export type LineChip = { key: string; text: string; status?: MessengerDeskStatus };

/** The chips under a line that named a handle ("Sent to @qa") or a desk
 *  ("@bugs (IT): Received by IT"). A handle chip shows once the brain
 *  wrote the copy (it filled `seq`). */
export function lineChips(message: MessengerMessage, site = DEFAULT_SITE): LineChip[] {
  const out: LineChip[] = [];
  for (const m of message.mentions ?? []) {
    if (m.kind === 'handle' && m.handle && m.seq != null) {
      out.push({ key: `h:${m.id}`, text: `Sent to @${m.handle}` });
    } else if (m.kind === 'desk' && isMessengerIntakeKind(m.id)) {
      out.push({
        key: `d:${m.id}`,
        text: `@${deskName(m.id, site)}: ${deskStatusText(m.status, site)}`,
        status: m.status ?? 'sent',
      });
    }
  }
  return out;
}

/** A system line drawn as a card (a person's text from another chat or
 *  box): its label, and whether a Reply on it goes back. null: a plain
 *  centred system line. */
export type FleetCard = { label: string; goesBack: boolean };

export function fleetCard(message: MessengerMessage, handle?: string | null): FleetCard | null {
  const e = message.event;
  if (message.authorKind !== 'system' || !e) return null;
  const who = message.authorName ?? 'Someone';
  switch (e.type) {
    case 'intake':
      return { label: `${who}, to ${handle ? `@${handle}` : 'this group'}`, goesBack: true };
    case 'desk_copy':
      return { label: `${who}, report from ${e.box.name}`, goesBack: true };
    case 'intake_answer':
      return { label: `Answer from @${e.group.handle}`, goesBack: false };
    case 'desk_answer':
      return { label: 'Answer from the IT desk', goesBack: false };
    case 'announcement':
      return { label: `Announcement from ${who}`, goesBack: false };
    default:
      return null;
  }
}

/** Whether a Reply on this line also goes back to where it came from: a
 *  copy line in a handle's group, a report on the Control Center. (The open
 *  owner choice "Reply to sender" changes only this.) */
export function replyGoesBack(message: MessengerMessage): boolean {
  const t = message.event?.type;
  return message.authorKind === 'system' && (t === 'intake' || t === 'desk_copy');
}

/** What the Reply bar says about where a reply goes. */
export function replyNote(message: MessengerMessage): string | null {
  if (!replyGoesBack(message)) return null;
  return message.event?.type === 'desk_copy'
    ? 'Your reply answers the report. It goes back to its box.'
    : 'Your reply also goes back to the chat it came from.';
}

/** The address of my own "To @qa" thread, from its first line: the mention
 *  each send there carries. null: not such a thread. */
export function threadTarget(first: MessengerMessage | undefined): MessengerMention | null {
  const e = first?.seq === 1 ? first.event : null;
  if (!e || e.type !== 'to_thread') return null;
  if ('desk' in e.to)
    return isMessengerIntakeKind(e.to.desk) ? { kind: 'desk', id: e.to.desk } : null;
  return { kind: 'handle', id: e.to.conversationId };
}

/** The handles and desks a send names (they count against the brain's cap
 *  of 3 together). */
export function addressesOf(mentions: readonly MessengerMention[]): MessengerMention[] {
  return mentions.filter((m) => m.kind === 'handle' || m.kind === 'desk');
}

/** The intake form of a send: the form of its one handle or desk. Two
 *  addresses, or one without a form: none. */
export function intakeOf(
  mentions: readonly MessengerMention[],
  picks: readonly AddressPick[],
): MessengerIntakeKind | null {
  const named = addressesOf(mentions);
  if (named.length !== 1) return null;
  const m = named[0]!;
  if (m.kind === 'desk') return isMessengerIntakeKind(m.id) ? m.id : null;
  return picks.find((p) => p.kind === 'handle' && p.id === m.id)?.intake ?? null;
}

/** The address a send goes to, as a person reads it (`@qa`, `@bugs (IT)`). */
export function addressLabel(
  m: MessengerMention,
  picks: readonly AddressPick[],
  site = DEFAULT_SITE,
): string {
  if (m.kind === 'desk') return `@${deskName(m.id as MessengerDeskKind, site)}`;
  const p = picks.find((x) => x.kind === 'handle' && x.id === m.id);
  return p ? `@${p.name}` : 'the group';
}

/** One line the app adds to a report, shown before send, each removable. */
export type AddedLine = { key: string; label: string; value: string };

/** The lines the app adds (plan section 4): its version, the shell, the
 *  page (the route, never the query), the screen's title, and the last
 *  client errors. The box adds its own version itself. */
export function addedLines(input: {
  appVersion: string;
  shell: 'web' | 'desktop';
  route: string;
  screen: string;
  errors: readonly { message: string; source: string | null }[];
}): AddedLine[] {
  const out: AddedLine[] = [
    { key: 'app', label: 'App version', value: input.appVersion },
    { key: 'shell', label: 'Shell', value: input.shell },
    { key: 'page', label: 'Page', value: input.route.split(/[?#]/)[0] || '/' },
  ];
  if (input.screen.trim()) out.push({ key: 'screen', label: 'Screen', value: input.screen.trim() });
  input.errors.forEach((e, i) =>
    out.push({
      key: `error-${i}`,
      label: 'Client error',
      value: e.source ? `${e.message} (${e.source})` : e.message,
    }),
  );
  return out.filter((l) => l.value.trim());
}

/** The text of a send with the lines kept: the typed text, then the added
 *  lines as `Label: value`, one a line. */
export function bodyWithLines(text: string, lines: readonly AddedLine[]): string {
  const added = lines.map((l) => `${l.label}: ${l.value}`).join('\n');
  return [text.trim(), added].filter(Boolean).join('\n\n');
}

/** The answers worth sending: trimmed, the empty ones left out. */
export function answersToSend(answers: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(answers)) if (v.trim()) out[k] = v.trim();
  return out;
}

/** What is wrong with a handle as typed in a group's details, or null: a
 *  blank one clears the handle. The box also refuses its agents' slugs and
 *  a handle another group holds (it says so). */
export function handleError(raw: string): string | null {
  const typed = raw.trim().replace(/^@/, '');
  if (!typed) return null;
  const h = normalizeHandle(typed);
  if (!h) return 'Use 2 to 30 lowercase letters, digits and dashes, with no dash first or last.';
  if (MESSENGER_HANDLE_RESERVED.includes(h)) return `@${h} is kept for the box. Pick another.`;
  return null;
}

/** The brain's cap on a line's text, the whole of it (form, lines, note). */
export const LINE_MAX = 8000;

/** The note the brain adds for files left out (`leftOutNote` on the brain). */
export function leftOutNote(list: readonly { name: string; bytes: number }[]): string {
  if (list.length === 0) return '';
  const names = list.map((f) => `${f.name} (${(f.bytes / 1024 / 1024).toFixed(1)} MB)`);
  return `Not sent (over ${FILE_MAX_BYTES / 1024 / 1024} MB): ${names.join(', ')}.`;
}

/**
 * The text a line to a handle or desk becomes on the brain, as the send
 * screen shows and counts it: the filled form (each question in bold, its
 * answer under it, then "Box version: …"), then the text with the app's
 * lines, then the note for the files left out. Mirrors the brain's
 * `intakeBody` and `leftOutNote`.
 */
export function packageText(input: {
  intake: MessengerIntakeKind | null;
  answers: Readonly<Record<string, string>>;
  boxVersion: string;
  text: string;
  leftOut: readonly { name: string; bytes: number }[];
}): string {
  const note = leftOutNote(input.leftOut);
  const body = note ? (input.text.trim() ? `${input.text}\n\n${note}` : note) : input.text;
  const answers = answersToSend(input.answers);
  if (!input.intake || Object.keys(answers).length === 0) return body;
  const parts: string[] = [];
  for (const q of MESSENGER_INTAKE_FORMS[input.intake]) {
    const a = answers[q.key];
    if (a) parts.push(`**${q.label}**\n${a}`);
  }
  parts.push(`Box version: ${input.boxVersion}`);
  const form = parts.join('\n\n');
  return body.trim() ? `${form}\n\n${body}` : form;
}

/** Why a send's addresses cannot go, before it is sent: one IT desk a
 *  line, and at most 3 handles and desks together (the brain's rules). */
export function addressProblem(mentions: readonly MessengerMention[]): string | null {
  const named = addressesOf(mentions);
  if (named.filter((m) => m.kind === 'desk').length > 1) {
    return 'A line goes to one IT desk only. Send a line to each desk.';
  }
  if (named.length > MESSENGER_HANDLES_PER_MESSAGE) {
    return `A line names at most ${MESSENGER_HANDLES_PER_MESSAGE} handles and desks.`;
  }
  return null;
}

/** The lines a desk answer replies to, for answers not seen before: their
 *  status chip is read again. Marks them seen. */
export function newDeskAnswers(messages: readonly MessengerMessage[], seen: Set<number>): number[] {
  const out: number[] = [];
  for (const m of messages) {
    if (m.authorKind !== 'system' || m.event?.type !== 'desk_answer') continue;
    if (seen.has(m.seq)) continue;
    seen.add(m.seq);
    if (m.replyToSeq != null) out.push(m.replyToSeq);
  }
  return out;
}
