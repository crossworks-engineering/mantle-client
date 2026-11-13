/**
 * The Control Center screens' model (the CC tab;
 * docs/control-center.md in the mantle repo). A Control Center (CC) bans a
 * person on every box it manages at once. The types mirror what
 * GET /api/fleet answers; dates arrive as ISO strings. Pure, so it is
 * unit-tested.
 */
import type { FleetWriteJob, FleetWriteResult } from './fleet-writes';

export const FLEET_PATH = '/api/fleet';
export const FLEET_KEY = ['fleet'];
export const FLEET_HREF = '/admin/fleet';

/** The control service ticks every few seconds. No tick for this long reads
 *  as stopped. */
export const FLEET_TICK_STALE_MS = 60_000;

export type FleetService = { publicKey: string; fingerprint: string; lastTickAt: string | null };

export type FleetBox = {
  id: string;
  url: string;
  label: string | null;
  /** The IPs the Control Center resolves for the host of `url`, IPv4 first
   *  (docs/control-center.md in the mantle repo). Empty: the host is an IP,
   *  or no DNS answer. Absent: a brain before this field. */
  ips?: string[];
  addedBy: string | null;
  createdAt: string;
  lastRunAt: string | null;
  lastOkAt: string | null;
  /** Null after a good run; else a short code (see reasonText). */
  lastReason: string | null;
  /** Logins in the box's last login list; null: no list yet. */
  loginCount: number | null;
  /** Phase 2: a provider key waiting for the control service (never the
   *  key). Absent: a brain before phase 2. */
  keyPending?: { service: string; by: string; at: string } | null;
  /** Phase 2: the box's answer to the last key sent. */
  keyResult?: FleetKeyResult | null;
  /** Phase 3: the box's time of its last good facts (the matrix holds
   *  them). Absent: a brain before phase 3. */
  factsAt?: string | null;
  /** Phase 4: the fleet writes waiting for the control service, in the
   *  order asked (no secret). Null: none. Absent: a brain before them. */
  writeJob?: FleetWriteJob | null;
  /** Phase 4: the box's last 40 answers to fleet writes, newest last. */
  writeResult?: FleetWriteResult | null;
};

/** A box's answer to a provider key (docs/control-center.md in the mantle
 *  repo, "Set a provider key on the fleet"). ok, or one reason: the box's
 *  own (service, refused, untested, failed), `expired` (deleted unsent
 *  after an hour), or the call's reason code (unreachable, off, ...). */
export type FleetKeyResult = {
  service: string;
  ok: boolean;
  reason: string | null;
  by: string;
  at: string;
};

export type FleetBanKind = 'disable' | 'archive';

export type FleetBan = {
  id: string;
  kind: FleetBanKind;
  emails: string[];
  issuer: string | null;
  oid: string | null;
  reason: string | null;
  madeBy: string | null;
  madeAt: string;
  liftedBy: string | null;
  liftedAt: string | null;
  boxesMatched: number;
  loginsMatched: number;
  ownerIds: string[];
};

/** Per ban and box, what the last run matched. ownerIds: the box owner,
 *  when it matched. It is never disabled. */
export type FleetResult = {
  banId: string;
  boxId: string;
  matched: number;
  ownerIds: string[];
  updatedAt: string;
};

export type FleetOverview = {
  service: FleetService | null;
  envLines: string[] | null;
  boxes: FleetBox[];
  bans: FleetBan[];
  results: FleetResult[];
};

/** POST { service, value, boxIds? } (no boxIds: every linked box). The
 *  Control Center seals the key for each box until it is sent, and the
 *  answer names the boxes queued, never the key. */
export const FLEET_KEYS_PATH = `${FLEET_PATH}/keys`;

/** The providers the fleet key update offers: the AI providers each box knows
 *  (its fixed list), less the two that need more than a key (a base URL). */
export function fleetKeyProviders<P extends { id: string }>(providers: readonly P[]): P[] {
  return providers.filter((p) => p.id !== 'custom' && p.id !== 'local');
}

/** Plain words for a box's provider-key state, or null when it has none.
 *  Never the key, never the provider's text: the box answers neither. */
export function keyBoxText(
  box: Pick<FleetBox, 'keyPending' | 'keyResult'>,
): { tone: 'ok' | 'wait' | 'warn' | 'bad'; text: string } | null {
  if (box.keyPending) return { tone: 'wait', text: 'Waiting for the next run.' };
  const r = box.keyResult;
  if (!r) return null;
  if (r.ok) return { tone: 'ok', text: 'Set and tested.' };
  switch (r.reason) {
    case 'untested':
      return { tone: 'warn', text: 'Set. This provider has no test.' };
    case 'service':
      return { tone: 'bad', text: 'This box does not know this provider. Nothing was set.' };
    case 'refused':
      return { tone: 'bad', text: 'The box refused the key. Nothing was set.' };
    case 'failed':
      return {
        tone: 'bad',
        text: 'The provider refused the key, or the box could not reach it. The box keeps the key it had.',
      };
    case 'expired':
      return {
        tone: 'bad',
        text: 'Not sent within an hour, so it was deleted unsent. The box keeps the key it had.',
      };
    default:
      return {
        tone: 'bad',
        text: `${reasonText(r.reason) ?? 'The call failed.'} The box keeps the key it had.`,
      };
  }
}

/** Whether a brain offers the key update: its box rows carry the phase 2
 *  fields. A brain before phase 2 does not. */
export function fleetKeysOffered(boxes: readonly FleetBox[]): boolean {
  return boxes.some((b) => b.keyPending !== undefined);
}

/** Whether any box still waits on a key: the screen reads again soon. */
export function keyUpdatePending(boxes: readonly FleetBox[] | undefined): boolean {
  return (boxes ?? []).some((b) => !!b.keyPending);
}

export type FleetPreviewBox = {
  boxId: string;
  url: string;
  label: string | null;
  /** Null: the box has no login list yet. */
  matched: number | null;
  owners: number;
};

export type FleetPreview = { boxes: FleetPreviewBox[]; unknown: number };

export type FleetBanBody = {
  kind: FleetBanKind;
  emails: string[];
  issuer: string | null;
  oid: string | null;
  reason: string | null;
};

/** The box's name on the screen: its label, else its host. */
export function boxName(box: { url: string; label: string | null }): string {
  if (box.label) return box.label;
  try {
    return new URL(box.url).host;
  } catch {
    return box.url;
  }
}

/** The IP line under a box address: the first IP, and "+N" for the rest;
 *  `title` lists them all. Null: no IP to show. */
export function ipLine(ips: string[] | undefined): { text: string; title: string } | null {
  const first = ips?.[0];
  if (!ips || !first) return null;
  return {
    text: ips.length > 1 ? `${first} +${ips.length - 1}` : first,
    title: ips.join(', '),
  };
}

/** Plain words for a box's reason code. Null: the last run was good. */
export function reasonText(code: string | null): string | null {
  if (code === null) return null;
  if (code === 'off') return 'The box has no control lines in its .env.';
  if (code === 'time') return 'The clocks of the box and this box differ by more than 60 seconds.';
  if (code === 'sig') return 'The box holds another key. Copy the key line again.';
  if (code === 'unreachable') return 'This box cannot reach the box over HTTPS.';
  if (code === 'bad-reply') return 'The box gave a reply this box cannot read.';
  if (code === 'reply-too-large') return 'The reply of the box is larger than 4 MB.';
  const http = /^http-(\d{3})$/.exec(code);
  if (http) return `The box answered HTTP ${http[1]}.`;
  return 'The last run failed.';
}

/** Whether the control service looks stopped: no tick, or none in the last
 *  minute. */
export function tickIsStale(lastTickAt: string | null, now: number = Date.now()): boolean {
  if (!lastTickAt) return true;
  const at = new Date(lastTickAt).getTime();
  return Number.isNaN(at) || now - at > FLEET_TICK_STALE_MS;
}

/** The emails typed in one box: split on commas, spaces and new lines,
 *  lowercase, each once. The brain checks each one. */
export function parseEmails(text: string): string[] {
  const out = text
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
  return [...new Set(out)];
}

/** The body of a new ban, from the form. Issuer and object id: both or
 *  neither (the brain refuses one alone, with its own words). */
export function banBody(form: {
  kind: FleetBanKind;
  emails: string;
  issuer: string;
  oid: string;
  reason: string;
}): FleetBanBody {
  return {
    kind: form.kind,
    emails: parseEmails(form.emails),
    issuer: form.issuer.trim() || null,
    oid: form.oid.trim() || null,
    reason: form.reason.trim() || null,
  };
}

/** One line per box of a ban's preview. */
export function previewLine(box: FleetPreviewBox): string {
  const name = boxName(box);
  if (box.matched === null) return `${name}: no login list yet`;
  const logins = box.matched === 1 ? '1 login' : `${box.matched} logins`;
  return box.owners > 0 ? `${name}: ${logins}, the owner among them` : `${name}: ${logins}`;
}

/** The text that says an owner matched. The owner is never disabled. */
export const OWNER_MATCH_TEXT = 'The owner of this box matched a ban and stays live.';

/** A ban's state: active, lifted (a disable ban), or retired (an archive
 *  ban: lifting it only stops its runs). */
export function banState(
  ban: Pick<FleetBan, 'kind' | 'liftedAt'>,
): 'active' | 'lifted' | 'retired' {
  if (!ban.liftedAt) return 'active';
  return ban.kind === 'archive' ? 'retired' : 'lifted';
}

/** The lift button's word: an archive ban is retired, never lifted. */
export function liftLabel(kind: FleetBanKind): 'Lift' | 'Retire' {
  return kind === 'archive' ? 'Retire' : 'Lift';
}

/** What the lift confirm says. */
export function liftText(kind: FleetBanKind): string {
  return kind === 'archive'
    ? 'Its runs stop. It never enables a login: an archived login stays archived until a box Admin enables it on that box.'
    : 'The next run enables, on each box, the logins this ban disabled that no other active ban matches. A login a box Admin disabled by hand stays disabled.';
}

/** The keys a ban matches on, in one line. */
export function banKeysText(ban: Pick<FleetBan, 'emails' | 'issuer' | 'oid'>): string {
  const keys = [...ban.emails];
  if (ban.issuer && ban.oid) keys.push(`sign-in id ${ban.oid}`);
  return keys.join(', ');
}

/** The Control Center screens stay in the nav only while the brain answers
 *  GET /api/fleet: its Overview and every screen under it. The sidebar and
 *  the search palette both ask this. */
export function fleetOffered(href: string, show: boolean): boolean {
  return show || !(href === FLEET_HREF || href.startsWith(`${FLEET_HREF}/`));
}

export function withFleet<G extends { items: { href: string }[] }>(
  groups: readonly G[],
  show: boolean,
): G[] {
  if (show) return [...groups];
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => fleetOffered(i.href, show)) }))
    .filter((g) => g.items.length > 0);
}
