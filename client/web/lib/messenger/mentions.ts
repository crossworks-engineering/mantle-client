/**
 * Mentions in the composer (Messenger V1 Phase 2), the pure half. Pinned by
 * mentions.test.ts.
 *
 * Typing "@" starts a mention: the picker lists the chat's people whose name
 * starts with what follows, and picking one writes "@Name " into the text and
 * remembers who it was. On send, a remembered mention counts only while its
 * "@Name" is still in the body (the writer may have deleted it).
 */
import type { MessengerMention } from './dto';

export type PickedMention = MessengerMention & { name: string };

/** The mention being typed at the caret: where its "@" sits and what
 *  follows it, or null. An "@" counts at the start or after whitespace (not
 *  inside an email address), and a mention ends at a line break. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(before[at - 1]!)) return null;
  const query = before.slice(at + 1);
  if (/[\n@]/.test(query) || query.length > 40) return null;
  // A space typed after the name ends it ("@Ann " is written, not typed).
  if (/\s$/.test(query)) return null;
  // Two words at most ("@Ann Lee"): a third space means it is prose now.
  if ((query.match(/ /g) ?? []).length > 1) return null;
  return { start: at, query };
}

/** Write the picked name over the "@query" being typed. Returns the new
 *  text and where the caret goes. */
export function applyMention(
  text: string,
  start: number,
  caret: number,
  name: string,
): { text: string; caret: number } {
  const insert = `@${name} `;
  const next = text.slice(0, start) + insert + text.slice(caret);
  return { text: next, caret: start + insert.length };
}

/** The people to offer for a query: a name or a word of it starting with
 *  the query, case-insensitive. */
export function mentionCandidates<T extends { name: string }>(
  people: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...people];
  return people.filter((p) => {
    const n = p.name.toLowerCase();
    return n.startsWith(q) || n.split(/\s+/).some((w) => w.startsWith(q));
  });
}

/** The mentions a body still carries (one per person). */
export function mentionsInBody(body: string, picked: readonly PickedMention[]): MessengerMention[] {
  const seen = new Set<string>();
  const out: MessengerMention[] = [];
  for (const m of picked) {
    if (seen.has(m.id) || !body.includes(`@${m.name}`)) continue;
    seen.add(m.id);
    out.push({ kind: m.kind, id: m.id });
  }
  return out;
}

export type BodyPart = { text: string; mention: boolean };

/** A message body split into plain text and "@Name" runs of the names it
 *  mentions, for drawing them in the mention ink. Longest names first, so
 *  "@Ann Lee" wins over "@Ann". */
export function splitMentions(body: string, names: readonly string[]): BodyPart[] {
  const wanted = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (wanted.length === 0) return [{ text: body, mention: false }];
  const parts: BodyPart[] = [];
  let i = 0;
  let plain = '';
  while (i < body.length) {
    if (body[i] === '@') {
      const hit = wanted.find((n) => body.startsWith(`@${n}`, i));
      if (hit) {
        if (plain) parts.push({ text: plain, mention: false });
        plain = '';
        parts.push({ text: `@${hit}`, mention: true });
        i += hit.length + 1;
        continue;
      }
    }
    plain += body[i];
    i += 1;
  }
  if (plain) parts.push({ text: plain, mention: false });
  return parts;
}
