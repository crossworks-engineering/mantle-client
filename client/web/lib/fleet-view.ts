/**
 * What the Control Center screens show, worked out from the two reads they
 * share (GET /api/fleet and GET /api/fleet/matrix): a box's link state, the
 * things that need an admin, a box's last answer to one kind of change, and
 * every change as one row. Pure, so it is unit-tested.
 */
import {
  banState,
  boxName,
  FLEET_HREF,
  keyBoxText,
  reasonText,
  tickIsStale,
  type FleetBox,
  type FleetOverview,
} from './fleet';
import {
  backupTone,
  factsAge,
  factsReasonText,
  healthLevel,
  type FleetMatrixRow,
} from './fleet-matrix';
import {
  answerText,
  changeLabel,
  type FleetWriteAnswer,
  type FleetWriteChange,
  type FleetWriteStamp,
} from './fleet-writes';

/** One Control Center screen's address. */
export const ccHref = (screen: string, boxId?: string): string =>
  `${FLEET_HREF}/${screen}${boxId ? `?box=${encodeURIComponent(boxId)}` : ''}`;

export type Tone = 'ok' | 'wait' | 'warn' | 'bad';

/** A box's link to this Control Center, in one word. */
export function linkState(box: Pick<FleetBox, 'lastReason' | 'lastOkAt'>): {
  tone: Tone;
  label: string;
} {
  if (box.lastReason) return { tone: 'bad', label: 'Not linked' };
  if (box.lastOkAt) return { tone: 'ok', label: 'Linked' };
  return { tone: 'wait', label: 'Waiting' };
}

export type FleetIssue = {
  id: string;
  /** `bad` first on the screen, then `warn`. */
  tone: 'bad' | 'warn';
  title: string;
  text: string;
  /** The screen that fixes it. */
  href: string;
  action: string;
};

/**
 * Everything that needs an admin now, worst first: the control service
 * stopped, a box that does not answer, a box that is down or has a warning,
 * a failed backup, old facts, an owner a ban matched, a key or a change a
 * box refused.
 */
export function fleetIssues(
  data: FleetOverview,
  rows: readonly FleetMatrixRow[],
  now: number = Date.now(),
): FleetIssue[] {
  const out: FleetIssue[] = [];
  if (!data.service) {
    out.push({
      id: 'service-key',
      tone: 'bad',
      title: 'The control service has no key',
      text: 'Add control to COMPOSE_PROFILES in the .env of this box, then run docker compose up -d.',
      href: FLEET_HREF,
      action: 'Open Overview',
    });
  } else if (tickIsStale(data.service.lastTickAt, now)) {
    out.push({
      id: 'service-stopped',
      tone: 'bad',
      title: 'The control service is not running',
      text: 'No box gets a ban, a lift, a key or a change until it runs again.',
      href: FLEET_HREF,
      action: 'Open Overview',
    });
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const box of data.boxes) {
    const name = boxName(box);
    const reason = reasonText(box.lastReason);
    if (reason) {
      out.push({
        id: `link-${box.id}`,
        tone: 'bad',
        title: `${name} does not answer`,
        text: reason,
        href: ccHref('boxes', box.id),
        action: 'Open the box',
      });
    }
    const row = byId.get(box.id);
    if (row?.facts) {
      const level = healthLevel(row.facts.status);
      if (level === 'crit' || level === 'warn') {
        out.push({
          id: `health-${box.id}`,
          tone: level === 'crit' ? 'bad' : 'warn',
          title: level === 'crit' ? `${name} is down` : `${name} has a warning`,
          text:
            level === 'crit'
              ? 'Its database did not answer at the last read.'
              : 'A service is down, or memory or disk is at 75% or more.',
          href: ccHref('matrix', box.id),
          action: 'Open in the matrix',
        });
      }
      if (backupTone(row.facts.backup) === 'bad') {
        out.push({
          id: `backup-${box.id}`,
          tone: 'bad',
          title: `The last backup of ${name} failed`,
          text: row.facts.backup?.lastSuccessAt
            ? 'An older good backup is there.'
            : 'This box has no good backup yet.',
          href: ccHref('matrix', box.id),
          action: 'Open in the matrix',
        });
      }
      // A box that does not answer already has its line above.
      if (!reason && factsAge(row, now) === 'stale') {
        out.push({
          id: `facts-${box.id}`,
          tone: 'warn',
          title: `The facts of ${name} are old`,
          text: factsReasonText(row.factsReason) ?? 'No newer read.',
          href: ccHref('matrix', box.id),
          action: 'Open in the matrix',
        });
      }
    }
    const key = keyBoxText(box);
    if (key?.tone === 'bad') {
      out.push({
        id: `key-${box.id}`,
        tone: 'warn',
        title: `${name} did not take the last key`,
        text: key.text,
        href: ccHref('keys'),
        action: 'Open Provider keys',
      });
    }
    const refused = (box.writeResult?.results ?? []).filter((r) => !r.ok).length;
    if (refused > 0) {
      out.push({
        id: `writes-${box.id}`,
        tone: 'warn',
        title: `${name} refused ${refused === 1 ? '1 change' : `${refused} changes`}`,
        text: 'See each answer under Fleet changes.',
        href: ccHref('changes', box.id),
        action: 'Open Fleet changes',
      });
    }
  }
  for (const ban of data.bans) {
    if (banState(ban) !== 'active') continue;
    const owner = data.results.some((r) => r.banId === ban.id && r.ownerIds.length > 0);
    if (owner) {
      out.push({
        id: `owner-${ban.id}`,
        tone: 'warn',
        title: 'A ban matched the owner of a box',
        text: 'The owner is never disabled and stays live.',
        href: `${ccHref('bans')}?ban=${encodeURIComponent(ban.id)}`,
        action: 'Open the ban',
      });
    }
  }
  return out.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'bad' ? -1 : 1));
}

export type KindAnswer = { tone: Tone; text: string; label: string; by: string; at: string };

/**
 * A box's newest word on one kind of change: what still waits, else its last
 * answer. Null when the box was never sent one.
 */
export function lastOfKind(
  box: Pick<FleetBox, 'writeJob' | 'writeResult'>,
  kind: FleetWriteChange['kind'],
): KindAnswer | null {
  const waiting = (box.writeJob?.changes ?? []).filter((c) => c.kind === kind).at(-1);
  if (waiting) {
    return {
      tone: 'wait',
      text: 'Waiting for the next run.',
      label: changeLabel(waiting),
      by: waiting.by,
      at: waiting.at,
    };
  }
  const done = (box.writeResult?.results ?? []).filter((r) => r.kind === kind).at(-1);
  if (!done) return null;
  const said = answerText(done);
  return { tone: said.tone, text: said.text, label: changeLabel(done), by: done.by, at: done.done };
}

export type ChangeRow = {
  key: string;
  boxId: string;
  box: string;
  label: string;
  tone: Tone;
  text: string;
  by: string;
  /** When it was answered, or asked while it waits. */
  at: string;
  waiting: boolean;
};

/** Every change of the boxes given as one list: what waits first (in the
 *  order asked), then the answers, newest first. */
export function changeRows(boxes: readonly FleetBox[]): ChangeRow[] {
  const waiting: ChangeRow[] = [];
  const done: ChangeRow[] = [];
  for (const b of boxes) {
    const name = boxName(b);
    (b.writeJob?.changes ?? []).forEach((c: FleetWriteChange & FleetWriteStamp, i) =>
      waiting.push({
        key: `${b.id}-wait-${i}`,
        boxId: b.id,
        box: name,
        label: changeLabel(c),
        tone: 'wait',
        text: 'Waiting for the next run.',
        by: c.by,
        at: c.at,
        waiting: true,
      }),
    );
    (b.writeResult?.results ?? []).forEach((r: FleetWriteAnswer, i) => {
      const said = answerText(r);
      done.push({
        key: `${b.id}-done-${i}`,
        boxId: b.id,
        box: name,
        label: changeLabel(r),
        tone: said.tone,
        text: said.text,
        by: r.by,
        at: r.done,
        waiting: false,
      });
    });
  }
  waiting.sort((a, b) => a.at.localeCompare(b.at));
  done.sort((a, b) => b.at.localeCompare(a.at));
  return [...waiting, ...done];
}

/** How many changes of a box wait, and how many it refused. */
export function changeCounts(box: Pick<FleetBox, 'writeJob' | 'writeResult'>): {
  waiting: number;
  refused: number;
  done: number;
} {
  const results = box.writeResult?.results ?? [];
  return {
    waiting: box.writeJob?.changes.length ?? 0,
    refused: results.filter((r) => !r.ok).length,
    done: results.length,
  };
}

/** "1 box", "3 boxes". */
export const boxesText = (n: number): string => (n === 1 ? '1 box' : `${n} boxes`);
