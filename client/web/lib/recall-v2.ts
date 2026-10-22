/**
 * Recall v2: the pure half of the native map editor. Everything here is
 * logic the screen would otherwise get subtly wrong inline, so it lives
 * where a test can hold it.
 *
 * The brain's rules this encodes (mantle docs/recall.md, v2 section):
 * - Every write carries the map `version` it was made against; a stale one
 *   is refused with 409 `version_stale`, never merged.
 * - A card PUT is FIELD-STICKY. `title` and `bodyMd` are required and
 *   replace. `useWhen`, `options` and `prompt` keep their current value when
 *   left out. From the owner, `prompt: true` makes the card a prompt (and
 *   confirms an agent's pending request) and `prompt: false` makes it
 *   knowledge (demoting a prompt, or dropping a pending request). So the
 *   editor sends `prompt` only when the owner moved the switch.
 * - The entry card (`start`) is always first and cannot be deleted.
 */
import { ApiError } from '@mantle/web-ui/api-fetch';
import type {
  RecallCardDetailDTO,
  RecallCardWriteDTO,
  RecallMapSummaryDTO,
  RecallNodeDTO,
  RecallOptionDTO,
  RecallRevisionDTO,
  RecallWriteErrorDTO,
} from '@mantle/web-ui/types/recall-v2';

/** The entry card's slug on every native map. */
export const RECALL_ENTRY_SLUG = 'start';

/** Query keys. Everything sits under `maps`, so invalidating it refreshes
 *  the lot. */
export const recallKeys = {
  maps: ['recall', 'maps'] as const,
  /** Every page of the catalog at once (option targets, the tree's default). */
  allMaps: ['recall', 'maps', { all: true }] as const,
  map: (mapId: string) => ['recall', 'maps', mapId] as const,
  card: (mapId: string, slug: string) => ['recall', 'maps', mapId, 'card', slug] as const,
  revisions: (mapId: string) => ['recall', 'maps', mapId, 'revisions'] as const,
};

/** `features.recallV2` from the shell: true or false once the shell has
 *  answered, undefined before. A brain older than Recall v2 sends no
 *  `features` object, which reads as false: it gets the "needs an update"
 *  state. */
export function recallV2Of(shell: unknown): boolean | undefined {
  if (shell === undefined || shell === null) return undefined;
  const features = (shell as { features?: { recallV2?: unknown } }).features;
  return features?.recallV2 === true;
}

/**
 * Which Recall screen the shell answer picks: true for v2, false for an older
 * brain, undefined while waiting. Only a shell that NEVER answered reads as an
 * older brain. A failed REFETCH keeps its data (TanStack Query 5 sets the
 * error and keeps the last answer), and reading that as "older brain" swapped
 * the screen under an open card and dropped its unsaved text, with no leave
 * guard: the brain restarting during a roll, or a laptop waking before the
 * network, was enough.
 */
export function recallScreenOf(shell: { data?: boolean; isError: boolean }): boolean | undefined {
  return shell.data ?? (shell.isError ? false : undefined);
}

/** A map this editor can open: one with its tree item. Page-built (v1)
 *  maps were retired in mantle R5, and a brain on R5 never lists one; a
 *  brain from just before it still could, with `nodeId` null, and every
 *  write to it would be refused. So they are left out, not shown as maps
 *  that refuse every save. Can go once no brain is older than R5. */
export function isNativeMap(map: { nodeId?: string | null }): boolean {
  return typeof map.nodeId === 'string' && map.nodeId !== '';
}

/** The fields the card editor owns. Everything else on the card is carried
 *  through from what the brain last sent. */
export type CardEdits = {
  title: string;
  bodyMd: string;
  useWhen: string;
  /** The Prompt switch. */
  prompt: boolean;
  options: RecallOptionDTO[];
};

export function editsOf(card: RecallCardDetailDTO): CardEdits {
  return {
    title: card.title,
    bodyMd: card.bodyMd,
    useWhen: card.useWhen,
    prompt: card.kind === 'prompt',
    options: card.options.map(cleanOption),
  };
}

/** An option as the write takes it. `targetId` is the brain's to fill (it is
 *  stripped on the way in anyway), and a same-map option has no `targetMap`. */
export function cleanOption(o: RecallOptionDTO): RecallOptionDTO {
  const out: RecallOptionDTO = { label: o.label, useWhen: o.useWhen, targetSlug: o.targetSlug };
  if (o.targetMap) out.targetMap = o.targetMap;
  return out;
}

/** An option with its text fields trimmed, as the write sends it. */
function trimOption(o: RecallOptionDTO): RecallOptionDTO {
  const out = cleanOption(o);
  out.label = out.label.trim();
  out.useWhen = out.useWhen.trim();
  return out;
}

/** The form as a save sends it: trimmed where the brain trims. After a save
 *  the form is set to this, so trailing spaces do not leave it dirty. */
export function normalisedEdits(e: CardEdits): CardEdits {
  return {
    title: e.title.trim(),
    bodyMd: e.bodyMd,
    useWhen: e.useWhen.trim(),
    prompt: e.prompt,
    options: e.options.map(trimOption),
  };
}

/**
 * The PUT body for saving the editor. `base` is the card as the edit started
 * from it. The brain's PUT is field-sticky, so only what the owner changed
 * in this edit is sent beyond the required title and body:
 * - `prompt` only when the switch moved: left out, the brain keeps the
 *   card's prompt state, which keeps an agent's pending request alive
 *   through an unrelated save.
 * - `useWhen` and `options` only when they differ from the base. A PUT that
 *   sends options re-checks every one of them, so sending an untouched list
 *   would block every save on a card with a stored option to a map that has
 *   since been unpublished (only a warning while it is stored).
 */
export function cardWriteBody(
  edits: CardEdits,
  base: Pick<CardEdits, 'prompt' | 'useWhen' | 'options'>,
  version: number,
): RecallCardWriteDTO {
  const e = normalisedEdits(edits);
  const body: RecallCardWriteDTO = { title: e.title, bodyMd: e.bodyMd, version };
  if (e.useWhen !== base.useWhen.trim()) body.useWhen = e.useWhen;
  if (JSON.stringify(e.options) !== JSON.stringify(base.options.map(trimOption))) {
    body.options = e.options;
  }
  if (e.prompt !== base.prompt) body.prompt = e.prompt;
  return body;
}

/** The PUT that adds one option to a card ("add a card from here"): the
 *  title and body it must send, and the options. Nothing else, so the
 *  card's use-when, its prompt state and any pending request stay as the
 *  brain has them. */
export function linkFromBody(
  card: Pick<RecallCardDetailDTO, 'title' | 'bodyMd' | 'options'>,
  option: RecallOptionDTO,
  version: number,
): RecallCardWriteDTO {
  return {
    title: card.title,
    bodyMd: card.bodyMd,
    options: [...card.options.map(cleanOption), cleanOption(option)],
    version,
  };
}

export function sameEdits(a: CardEdits, b: CardEdits): boolean {
  return JSON.stringify(normalisedEdits(a)) === JSON.stringify(normalisedEdits(b));
}

/**
 * Where the map's version stands against the one an edit started from.
 * `chain` maps each version the owner's own writes were sent at to the one
 * they got back, so a run of the owner's own writes (publish, reorder, a new
 * card) is told apart from someone else's.
 * - `same`: nothing was written since.
 * - `own`: only the owner's own writes, from this tab.
 * - `foreign`: something else wrote the map (an agent, another tab).
 * - `behind`: the cached map is older than the edit (a late refetch); wait.
 */
export function versionState(
  from: number,
  current: number,
  chain: Readonly<Record<number, number>>,
): 'same' | 'own' | 'foreign' | 'behind' {
  if (current === from) return 'same';
  if (current < from) return 'behind';
  let v = from;
  for (let i = 0; i < 1000; i++) {
    const next = chain[v];
    if (next === undefined || next <= v) break;
    v = next;
    if (v === current) return 'own';
  }
  return 'foreign';
}

/**
 * Do the map's list row for a card and the card's own copy agree?
 *
 * The two are separate queries with their own cache age, and the editor
 * pairs the card's text with the MAP's version when it saves. A card cached
 * a few seconds ago can sit next to a map refetched after an agent edited
 * that card: saving would then send a version that is current for text the
 * owner never saw, and nothing would refuse it.
 *
 * `sourceVersion` is the map version a card was last written at, and every
 * text edit moves it. Some writes change a card without moving it (a map
 * rename retitles the entry card; a prompt confirm; options dropped when
 * the card they led to is deleted), so the list row's own fields are
 * compared too. When they differ at the same stamp, the copy fetched longer
 * ago is the one to distrust.
 * - `match`: they agree.
 * - `card-behind`: the card copy is older. Do not edit or confirm on it;
 *   refetch it.
 * - `map-behind`: the card copy is newer than the map's list; the map will
 *   catch up on its own refetch.
 */
export type CardSync = 'match' | 'card-behind' | 'map-behind';

type NodeShape = Pick<
  RecallNodeDTO,
  'title' | 'useWhen' | 'kind' | 'promptPending' | 'options' | 'sourceVersion' | 'updatedAt'
>;

function sameShape(a: NodeShape, b: NodeShape): boolean {
  return (
    a.title === b.title &&
    a.useWhen === b.useWhen &&
    a.kind === b.kind &&
    a.promptPending === b.promptPending &&
    JSON.stringify(a.options.map(cleanOption)) === JSON.stringify(b.options.map(cleanOption))
  );
}

export function cardSync(
  node: NodeShape,
  card: NodeShape,
  /** When each copy was last written into the cache (dataUpdatedAt). */
  fetched: { card: number; map: number },
): CardSync {
  if (card.sourceVersion < node.sourceVersion) return 'card-behind';
  if (card.sourceVersion > node.sourceVersion) return 'map-behind';
  if (sameShape(node, card)) return 'match';
  const n = Date.parse(node.updatedAt);
  const c = Date.parse(card.updatedAt);
  if (n > c) return 'card-behind';
  if (c > n) return 'map-behind';
  return fetched.card < fetched.map ? 'card-behind' : 'map-behind';
}

/** What the card pane shows for the state of its card query. */
export type CardPane = {
  show: 'loading' | 'error' | 'editor';
  /** Ask the brain for the card again: the cached copy is behind the map. */
  refetch: boolean;
  /** The last refetch failed; the pane still shows the copy it has. */
  refreshFailed: boolean;
};

/**
 * The card pane's gate. Before the form mounts, a copy that is behind the
 * map's row is never shown: the form would take the map's version as its
 * base and pair it with text the owner never saw. Once mounted, the form
 * stays: a failed background refetch (TanStack keeps the data and sets the
 * error) or a stale copy is a state the form shows, never a reason to drop
 * unsaved edits.
 */
export function cardPane(args: {
  hasData: boolean;
  sync: CardSync | null;
  isFetching: boolean;
  isError: boolean;
  mounted: boolean;
}): CardPane {
  const { hasData, sync, isFetching, isError, mounted } = args;
  const behind = sync === 'card-behind';
  const refetch = behind && !isFetching && !isError;
  if (mounted && hasData) return { show: 'editor', refetch, refreshFailed: isError };
  if (!hasData || behind) {
    return { show: isError && !isFetching ? 'error' : 'loading', refetch, refreshFailed: false };
  }
  return { show: 'editor', refetch: false, refreshFailed: isError };
}

/** A detail query's pane: the error screen only when there is nothing to
 *  show. A failed REFETCH keeps its data (TanStack Query 5 sets the error
 *  and keeps the last copy), and that copy stays on screen with a note. */
export function detailPane(q: { data: unknown; isError: boolean }): {
  show: 'loading' | 'error' | 'ready';
  refreshFailed: boolean;
} {
  if (q.data === undefined) return { show: q.isError ? 'error' : 'loading', refreshFailed: false };
  return { show: 'ready', refreshFailed: q.isError };
}

/**
 * How the open form moves with the brain on a render. Pure so the rules can
 * be held by a test; the editor applies the answer.
 *
 * - `follow`: a clean form shows the brain's copy as it is now, at the
 *   map's version.
 * - `version`: a dirty form's base moves up to the map's version. Only for
 *   the owner's own writes since (publish, reorder, settings), and only once
 *   the map has been refetched after them and it shows this card unchanged:
 *   a map rename is the owner's own write too, and it retitles the entry
 *   card, so moving the version before the card is seen again would let a
 *   save write the old title back.
 * - `conflict`: why a dirty form would be refused if saved now.
 *
 * `settled`: no refetch of the map or the card is in flight, and the map is
 * not waiting on one (a write marks it invalid until a refetch lands).
 * `sameStamp`: the card's `sourceVersion` is the base's.
 */
export function editorSync(s: {
  dirty: boolean;
  saving: boolean;
  gone: boolean;
  sync: CardSync;
  settled: boolean;
  cardChanged: boolean;
  sameStamp: boolean;
  mapState: ReturnType<typeof versionState>;
}): { move: 'follow' | 'version' | null; conflict: 'card' | 'map' | null } {
  if (s.saving || s.gone) return { move: null, conflict: null };
  const confirmed = s.sync === 'match' && s.settled;
  if (!s.dirty) {
    const moved = s.cardChanged || !s.sameStamp || s.mapState === 'own' || s.mapState === 'foreign';
    return { move: confirmed && moved ? 'follow' : null, conflict: null };
  }
  if (s.cardChanged || !s.sameStamp || s.sync === 'card-behind') {
    return { move: null, conflict: 'card' };
  }
  if (s.mapState === 'foreign') return { move: null, conflict: 'map' };
  if (s.mapState === 'own' && confirmed && s.sameStamp) return { move: 'version', conflict: null };
  return { move: null, conflict: null };
}

/**
 * After a refused save: the owner's edits laid over the brain's new copy.
 * A field the owner did not touch (still equal to the old base) takes the
 * new copy's value, so saving again does not write back a stale title a map
 * rename changed, or undo an agent's options on a card whose body the owner
 * was editing. A field the owner did change keeps their text.
 */
export function rebaseEdits(edits: CardEdits, oldBase: CardEdits, fresh: CardEdits): CardEdits {
  const same = <K extends keyof CardEdits>(k: K) =>
    JSON.stringify(normalisedEdits(edits)[k]) === JSON.stringify(normalisedEdits(oldBase)[k]);
  return {
    title: same('title') ? fresh.title : edits.title,
    bodyMd: same('bodyMd') ? fresh.bodyMd : edits.bodyMd,
    useWhen: same('useWhen') ? fresh.useWhen : edits.useWhen,
    prompt: same('prompt') ? fresh.prompt : edits.prompt,
    options: same('options') ? fresh.options : edits.options,
  };
}

/**
 * The card the workbench opens. The URL's card, else the entry card, else
 * the first. `held` is the card the editor has open while it holds unsaved
 * text (or a refused save): if its row has left the map (deleted from
 * another tab, or by an agent), it stays open and is reported `gone`, so
 * the owner can copy the text out, instead of the pane falling back to the
 * entry card and throwing the text away.
 */
export function openCardOf<N extends Pick<RecallNodeDTO, 'slug'>>(
  nodes: N[],
  cardSlug: string | null,
  held: N | null,
): { node: N | null; gone: boolean } {
  const want = cardSlug ?? RECALL_ENTRY_SLUG;
  const found = nodes.find((n) => n.slug === want);
  if (found) return { node: found, gone: false };
  if (held && held.slug === want) return { node: held, gone: true };
  return {
    node: nodes.find((n) => n.slug === RECALL_ENTRY_SLUG) ?? nodes[0] ?? null,
    gone: false,
  };
}

/**
 * The map to write into the URL as `selected` when none is there. Without
 * it the open map is "the first one listed", and a catalog refetch that
 * lists a new map first would swap the workbench to it, unsaved card and
 * all. `ready`: the screen knows which list it shows (tree or catalog) and
 * has the maps it picks from.
 */
export function mapToPin(
  selected: string | null,
  resolved: string | null,
  ready: boolean,
): string | null {
  return !selected && ready && resolved ? resolved : null;
}

/**
 * The brain's size caps on everything but the body (mantle recall-native.ts,
 * brain v0.232.358 and later). Not in the published contract, so mirrored
 * here; an older brain has no caps and these only hold the editor back.
 */
export const RECALL_TITLE_MAX = 200;
export const RECALL_LINE_MAX = 500;
export const RECALL_LABEL_MAX = 200;
export const RECALL_OPTIONS_MAX = 30;

/** What the editor can tell before it sends: the brain would refuse these,
 *  and saying so next to the field beats a round trip. Keyed by field. */
export function cardProblems(
  edits: CardEdits,
  budget: number,
  /** An agent asked for this card to be a prompt. A save that leaves the
   *  switch alone keeps the request, and the brain refuses a pending card
   *  with no use-when line just as it refuses a prompt without one. */
  promptPending = false,
): Partial<Record<'title' | 'bodyMd' | 'useWhen' | 'options', string>> {
  const out: Partial<Record<'title' | 'bodyMd' | 'useWhen' | 'options', string>> = {};
  if (!edits.title.trim()) out.title = 'A card needs a title.';
  if (edits.bodyMd.length > budget) {
    out.bodyMd = `${edits.bodyMd.length - budget} characters over the ${budget} budget. Split it: add a second card and give this one an option to it.`;
  }
  if (edits.prompt && !edits.useWhen.trim()) {
    out.useWhen = 'A prompt needs a use-when line: it is what the prompt is matched on.';
  } else if (promptPending && !edits.useWhen.trim()) {
    out.useWhen =
      'An agent asked for this card to be a prompt, so it needs a use-when line. Add one, or drop the request.';
  }
  const blank = edits.options.findIndex(
    (o) => !o.label.trim() || !o.useWhen.trim() || !o.targetSlug.trim(),
  );
  if (blank >= 0) {
    out.options = `Option ${blank + 1} needs a label, a use-when line and a target.`;
  } else if (edits.options.length > RECALL_OPTIONS_MAX) {
    out.options = `A card can have at most ${RECALL_OPTIONS_MAX} options. Group the rest behind a card of their own.`;
  }
  return out;
}

/** Body counter state: `near` from 90% of the budget, `over` past it. */
export function budgetState(chars: number, budget: number): 'ok' | 'near' | 'over' {
  if (chars > budget) return 'over';
  if (chars >= budget * 0.9) return 'near';
  return 'ok';
}

/** The slug order after moving one card up or down. The entry card never
 *  moves and nothing moves above it. Returns null when the move is a no-op.
 *  Always the FULL list: the reorder route leaves unlisted cards at their old
 *  rank, which can collide with the new ones. */
export function moveCard(
  nodes: Pick<RecallNodeDTO, 'slug'>[],
  slug: string,
  dir: -1 | 1,
): string[] | null {
  const slugs = nodes.map((n) => n.slug);
  const i = slugs.indexOf(slug);
  const j = i + dir;
  if (i < 0 || slug === RECALL_ENTRY_SLUG) return null;
  if (j < 0 || j >= slugs.length || slugs[j] === RECALL_ENTRY_SLUG) return null;
  const out = [...slugs];
  out[i] = slugs[j]!;
  out[j] = slugs[i]!;
  return out;
}

/** The slug order after dragging `active` onto `over`'s place (dnd-kit's
 *  arrayMove semantics). Same rules as moveCard: the entry card never moves
 *  and nothing lands above it, and the result is always the FULL order.
 *  Null when the drop changes nothing or breaks a rule. */
export function dropCard(
  nodes: Pick<RecallNodeDTO, 'slug'>[],
  active: string,
  over: string,
): string[] | null {
  const slugs = nodes.map((n) => n.slug);
  const from = slugs.indexOf(active);
  let to = slugs.indexOf(over);
  if (from < 0 || to < 0 || from === to || active === RECALL_ENTRY_SLUG) return null;
  if (slugs[0] === RECALL_ENTRY_SLUG && to === 0) to = 1;
  if (from === to) return null;
  const out = [...slugs];
  const [moved] = out.splice(from, 1);
  out.splice(to, 0, moved!);
  return out;
}

/** The error body the brain sends on a refused write, when it sent one. */
export function writeErrorOf(err: unknown): RecallWriteErrorDTO | null {
  if (!(err instanceof ApiError)) return null;
  const body = err.body as Partial<RecallWriteErrorDTO> | undefined;
  if (body && typeof body.error === 'string') return { error: body.error, code: body.code };
  return { error: err.message };
}

export function isStale(err: unknown): boolean {
  return writeErrorOf(err)?.code === 'version_stale';
}

/** The one line to show for a failed write. The brain's refusals are written
 *  to be read as they are, so they pass through; a stale version gets the
 *  editor's own wording, because the editor is what re-reads. */
export function writeErrorText(err: unknown, fallback: string): string {
  if (isStale(err)) {
    return 'This map changed since you opened it (another tab or an agent). It has been reloaded; check it and save again.';
  }
  const e = writeErrorOf(err);
  if (e?.error) return e.error;
  return err instanceof Error && err.message ? err.message : fallback;
}

/** Revisions with nothing before them to put back, so the editor does not
 *  offer a restore. Keyed by the revision's summary, the only thing that
 *  says what kind of write it was. An old "cards reordered" row (logged
 *  before the brain kept the old order) is refused by the brain with a
 *  sentence of its own, which the editor shows as it comes. */
const UNRESTORABLE: Record<string, string> = {
  'map created': 'There is nothing before a map was created. To remove the map, delete it.',
};

export function restoreBlockedReason(rev: Pick<RecallRevisionDTO, 'summary'>): string | null {
  return UNRESTORABLE[rev.summary] ?? null;
}

/** What restoring this revision will do, in the confirm dialog. Keyed by
 *  the summary, like the guard above; an unknown one gets the general line. */
export function restoreCopy(rev: Pick<RecallRevisionDTO, 'summary' | 'cardSlug'>): string {
  const card = rev.cardSlug ? `the card ${rev.cardSlug}` : 'the card';
  switch (rev.summary) {
    case 'card added':
      return `Deletes ${card} again. Options on other cards that lead to it are removed with it.`;
    case 'card edited':
      return `Puts ${card} back as it was before that edit: title, body, use-when, options and prompt state. Anything written to it since is replaced.`;
    case 'card deleted':
      return `Brings ${card} back with its text, its old link name and its old place, and puts back the options other cards had to it. A card deleted before the brain kept those comes back at the end, without them.`;
    case 'prompt edited by agent, awaits confirm':
      return `Puts back the text ${card} had before the agent changed it, as a confirmed prompt again.`;
    case 'prompt confirmed':
    case 'prompt request dropped':
    case 'prompt demoted':
    case 'prompt state restored':
      return `Puts back only whether ${card} is a prompt, as it was before that write. Its text is not touched.`;
    case 'cards reordered':
      return 'Puts the cards back in the order they had before that move. Cards added since stay, after them.';
    case 'published':
      return 'Unpublishes the map again. No agent can see it until it is published.';
    case 'unpublished':
      return 'Publishes the map again, so agents can find it.';
  }
  if (!rev.cardSlug) {
    return 'Puts back the map settings that write changed (title, enter-when, slug, published), as they were before it.';
  }
  return 'Puts back what that write replaced.';
}

/** Who made a revision, as the log shows it. */
export function actorLabel(rev: Pick<RecallRevisionDTO, 'actorKind' | 'actorName'>): string {
  if (rev.actorKind === 'agent') {
    if (rev.actorName === 'mcp') return 'An MCP client';
    return rev.actorName ? `Agent ${rev.actorName}` : 'An agent';
  }
  if (rev.actorName === 'mcp') return 'Owner, via MCP';
  return rev.actorName ?? 'Owner';
}

/** The line for options a write removed along with the card they led to
 *  (a card delete, or restoring a "card added" revision). */
export function droppedText(dropped: readonly { cardSlug: string; label: string }[]): string {
  if (dropped.length === 0) return '';
  const parts = dropped.map((d) => `"${d.label}" on ${d.cardSlug}`);
  return `Removed ${dropped.length === 1 ? 'the option' : 'the options'} to it: ${parts.join(', ')}.`;
}

/** One page of the catalog, as `GET /api/recall/maps` sends it. */
export type RecallMapsPage = {
  maps: RecallMapSummaryDTO[];
  total?: number;
  page?: number;
  pageSize?: number;
};

/** Every map in the catalog, page by page. The catalog pages at 20, and
 *  option targets and the tree's default map need all of them. Stops at
 *  `maxPages` so a brain that misreports its total cannot loop forever. */
export async function fetchAllMaps(
  fetchPage: (page: number) => Promise<RecallMapsPage>,
  maxPages = 50,
): Promise<RecallMapSummaryDTO[]> {
  const first = await fetchPage(1);
  const out = [...first.maps];
  const total = first.total ?? out.length;
  const size = first.pageSize ?? Math.max(1, first.maps.length);
  const pages = Math.min(maxPages, Math.ceil(total / size));
  for (let p = 2; p <= pages; p++) {
    const next = await fetchPage(p);
    if (next.maps.length === 0) break;
    out.push(...next.maps);
  }
  return out;
}

/** Where an option can lead: every other card in this map, and the entry of
 *  every other PUBLISHED native map (the brain refuses an unpublished one). */
export type OptionTarget = { value: string; label: string; targetSlug: string; targetMap?: string };

export function optionTargets(
  map: { slug: string; nodes: Pick<RecallNodeDTO, 'slug' | 'title'>[] },
  selfSlug: string | null,
  maps: RecallMapSummaryDTO[],
): OptionTarget[] {
  const inMap = map.nodes
    .filter((n) => n.slug !== selfSlug)
    .map((n) => ({ value: `card:${n.slug}`, label: n.title, targetSlug: n.slug }));
  const other = maps
    .filter((m) => m.slug !== map.slug && m.published && isNativeMap(m))
    .map((m) => ({
      value: `map:${m.slug}`,
      label: `${m.title} (another map)`,
      targetSlug: m.slug,
      targetMap: m.slug,
    }));
  return [...inMap, ...other];
}

export function optionTargetValue(o: Pick<RecallOptionDTO, 'targetSlug' | 'targetMap'>): string {
  return o.targetMap ? `map:${o.targetMap}` : `card:${o.targetSlug}`;
}

// ── The trail: how a map reads, for the editor's oversight ──────────────────

type TrailNode = Pick<RecallNodeDTO, 'slug' | 'title' | 'kind' | 'options' | 'promptPending'>;

/** Breadth-first from the entry card along same-map options: each card
 *  reached, mapped to the card it was first reached from (null for the
 *  entry). A cross-map option, or one to a card no longer in the map, leads
 *  nowhere here. */
function walkFromEntry(nodes: readonly TrailNode[]): Map<string, string | null> {
  const bySlug = new Map(nodes.map((n) => [n.slug, n]));
  const prev = new Map<string, string | null>();
  if (!bySlug.has(RECALL_ENTRY_SLUG)) return prev;
  prev.set(RECALL_ENTRY_SLUG, null);
  const queue = [RECALL_ENTRY_SLUG];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i]!;
    for (const o of bySlug.get(cur)?.options ?? []) {
      if (o.targetMap || prev.has(o.targetSlug) || !bySlug.has(o.targetSlug)) continue;
      prev.set(o.targetSlug, cur);
      queue.push(o.targetSlug);
    }
  }
  return prev;
}

/** The shortest walk an agent can take from the entry card to `slug`: entry
 *  first, the card itself last. Null when no walk reaches it. */
export function cardTrail<N extends TrailNode>(nodes: readonly N[], slug: string): N[] | null {
  const prev = walkFromEntry(nodes);
  if (!prev.has(slug)) return null;
  const bySlug = new Map(nodes.map((n) => [n.slug, n]));
  const path: N[] = [];
  for (let s: string | null = slug; s !== null; s = prev.get(s) ?? null) {
    path.unshift(bySlug.get(s)!);
  }
  return path;
}

/** Every card no walk from the entry card reaches. */
export function unreachableSlugs(nodes: readonly TrailNode[]): Set<string> {
  const reached = walkFromEntry(nodes);
  return new Set(nodes.filter((n) => !reached.has(n.slug)).map((n) => n.slug));
}

/** The options on OTHER cards of this map that lead to `slug`, in card order. */
export function incomingOptions<N extends TrailNode>(
  nodes: readonly N[],
  slug: string,
): { from: N; option: RecallOptionDTO }[] {
  return nodes.flatMap((from) =>
    from.slug === slug
      ? []
      : from.options
          .filter((o) => !o.targetMap && o.targetSlug === slug)
          .map((option) => ({ from, option })),
  );
}

/** What a card is, as the editor names it: the entry card, a prompt, a
 *  prompt an agent asked for (not matched until confirmed), or knowledge. */
export type CardKind = 'entry' | 'prompt' | 'requested' | 'knowledge';

export function cardKindOf(node: Pick<RecallNodeDTO, 'slug' | 'kind' | 'promptPending'>): CardKind {
  if (node.slug === RECALL_ENTRY_SLUG) return 'entry';
  if (node.promptPending) return 'requested';
  return node.kind === 'prompt' ? 'prompt' : 'knowledge';
}

export const CARD_KIND_LABEL: Record<CardKind, string> = {
  entry: 'Entry card',
  prompt: 'Prompt',
  requested: 'Prompt requested',
  knowledge: 'Knowledge',
};

/** Why a card wants the owner's eye, or null. A prompt no walk reaches is
 *  fine: it is found by meaning. A knowledge card no walk reaches is not:
 *  no agent will ever read it. */
export function cardAttention(node: TrailNode, unreachable: ReadonlySet<string>): string | null {
  if (node.promptPending) return 'An agent asked for this card to be a prompt.';
  if (node.slug === RECALL_ENTRY_SLUG && node.options.length === 0) {
    return 'The entry card has no options, so an agent cannot go further.';
  }
  if (unreachable.has(node.slug) && node.kind !== 'prompt') {
    return 'No option leads here from the entry card, so no agent will reach it.';
  }
  return null;
}
