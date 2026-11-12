'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiSend } from '@mantle/web-ui/api-fetch';
import { useToast } from '@mantle/web-ui/ui/toast';
import { FLEET_PATH, type FleetBan, type FleetOverview, type FleetPreview } from '@/lib/fleet';
import {
  boxLevel,
  FLEET_PEOPLE_KEY,
  memberAnswers,
  peopleBoxes,
  readAllUsers,
  sentSummary,
  toolCalls,
  withoutSent,
  withSending,
  type FleetPeople,
  type MemberAnswer,
  type MemberChange,
} from '@/lib/fleet-people';
import {
  MAX_TOOL_BOXES,
  MAX_TOOL_CHANGES,
  runFleetTool,
  TOOL_FOLLOW_UPS,
  USERS_LIST_TOOL,
  WORKSPACE_USER_SET_TOOL,
  type BoxOutcome,
} from '@/lib/fleet-tool';
import { refusalText } from '../fleet-section';

/** The users_list read: each box's outcome, or `channel: false` while the
 *  Control Center has no admin channel. */
type PeopleRead = { channel: false } | { channel: true; outcomes: BoxOutcome[] };

/** users_list on many boxes, every page, at most 50 boxes per call (the
 *  route's cap). */
async function readUsers(boxIds: readonly string[], followUps: number) {
  const out: BoxOutcome[] = [];
  for (let i = 0; i < boxIds.length; i += MAX_TOOL_BOXES) {
    const part = boxIds.slice(i, i + MAX_TOOL_BOXES);
    const r = await readAllUsers(part, (ids, args) =>
      runFleetTool(ids, USERS_LIST_TOOL, args, { followUps }),
    );
    if (r === null) return null;
    out.push(...r);
  }
  return out;
}

/** The people of every linked box: users_list over the admin channel. A
 *  box that did not answer keeps its last good list, with its reason.
 *  `reread` asks the boxes named again (after a write); when that fails,
 *  their lists are marked old, never shown as current. */
export function usePeople(fleet: FleetOverview) {
  const queryClient = useQueryClient();
  const ids = useMemo(() => fleet.boxes.map((b) => b.id.toLowerCase()), [fleet.boxes]);
  const key = useMemo(() => [...FLEET_PEOPLE_KEY, ids.join(',')], [ids]);
  const query = useQuery({
    queryKey: key,
    queryFn: async (): Promise<PeopleRead> => {
      const outcomes = await readUsers(ids, 0);
      return outcomes === null ? { channel: false } : { channel: true, outcomes };
    },
    enabled: ids.length > 0,
    staleTime: 60_000,
    retry: 0,
    refetchOnWindowFocus: false,
  });
  const kept = useRef(new Map<string, FleetPeople>());
  const read = query.data;
  const boxes = useMemo(() => {
    if (!read || !read.channel) return [];
    const out = peopleBoxes(fleet.boxes, read.outcomes, kept.current);
    for (const b of out) if (b.people && !b.peopleReason) kept.current.set(b.id, b.people);
    return out;
  }, [read, fleet.boxes]);

  const reread = useCallback(
    async (asked: string[]) => {
      const boxIds = [...new Set(asked.map((id) => id.toLowerCase()))];
      if (boxIds.length === 0) return;
      let fresh: BoxOutcome[];
      try {
        fresh =
          (await readUsers(boxIds, 1)) ??
          boxIds.map((boxId) => ({
            boxId,
            outcome: 'not-run' as const,
            reason: 'no-channel',
            output: undefined,
          }));
      } catch {
        fresh = boxIds.map((boxId) => ({
          boxId,
          outcome: 'unknown' as const,
          reason: 'network',
          output: undefined,
        }));
      }
      queryClient.setQueryData<PeopleRead>(key, (old) => {
        if (!old || !old.channel) return old;
        const others = old.outcomes.filter((a) => !boxIds.includes(a.boxId));
        return { channel: true, outcomes: [...others, ...fresh] };
      });
    },
    [queryClient, key],
  );

  return {
    query,
    /** Null while loading; false: no admin channel on this Control Center. */
    channel: read ? read.channel : null,
    boxes,
    reread,
  };
}

/** What a send did: false when nothing ran; else every change's answer and
 *  the changes the boxes never ran, which the caller keeps staged. */
export type MembersSent = false | { answers: MemberAnswer[]; left: MemberChange[] };

/** Workspace changes over the admin channel: per box, one workspace_user_set
 *  call after another (at most 20 changes each, so their order holds),
 *  boxes side by side; pending calls asked for again; the answers from the
 *  calls themselves; then the boxes read again. One toast per send. */
export function useMembersWrite(reread: (boxIds: string[]) => Promise<void>) {
  const toast = useToast();
  const [sending, setSending] = useState<MemberChange[]>([]);
  const [answers, setAnswers] = useState<MemberAnswer[]>([]);
  const send = async (changes: MemberChange[]): Promise<MembersSent> => {
    if (changes.length === 0) return false;
    setSending((now) => withSending(now, changes));
    let cleared = false;
    try {
      const calls = toolCalls(changes, MAX_TOOL_CHANGES);
      const perBox = [...new Set(calls.map((c) => c.boxId))].map((boxId) =>
        calls.filter((c) => c.boxId === boxId),
      );
      const done = await Promise.all(
        perBox.map(async (list) => {
          const out: MemberAnswer[] = [];
          for (const call of list) {
            let box: BoxOutcome | undefined;
            try {
              const r = await runFleetTool(
                [call.boxId],
                WORKSPACE_USER_SET_TOOL,
                {
                  changes: call.changes.map(({ loginId, workspaceId, role }) => ({
                    loginId,
                    workspaceId,
                    role,
                  })),
                },
                { followUps: TOOL_FOLLOW_UPS },
              );
              box =
                r === null
                  ? {
                      boxId: call.boxId,
                      outcome: 'not-run',
                      reason: 'no-channel',
                      output: undefined,
                    }
                  : r.find((a) => a.boxId === call.boxId.toLowerCase());
            } catch {
              box = { boxId: call.boxId, outcome: 'unknown', reason: 'network', output: undefined };
            }
            out.push(...memberAnswers(call.changes, box));
          }
          return out;
        }),
      );
      const all = done.flat();
      setAnswers((a) => [...a, ...all]);
      const said = sentSummary(all);
      if (said.tone === 'ok') toast.success(said.text);
      else toast.error(said.text);
      // The send is over: its cells leave the in-flight set before the
      // re-read, so a slow box's read never holds Send back.
      cleared = true;
      setSending((now) => withoutSent(now, changes));
      // Every box a call was sent to is read again, not-run boxes too.
      await reread([...new Set(all.map((a) => a.boxId))]);
      return {
        answers: all,
        left: all
          .filter(boxLevel)
          .map(({ boxId, loginId, workspaceId, role }) => ({ boxId, loginId, workspaceId, role })),
      };
    } finally {
      // Once only: a newer send of the same cells may already be in flight.
      if (!cleared) setSending((now) => withoutSent(now, changes));
    }
  };
  return { pending: sending.length > 0, sending, answers, send };
}

/** The ban write of the Bans screen, for one email: preview, then make; and
 *  the lift. A ban is fleet-wide. */
export function useBanWrite(onChanged: () => void) {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const body = (email: string, reason: string) => ({
    kind: 'disable' as const,
    emails: [email],
    issuer: null,
    oid: null,
    reason: reason.trim() || null,
  });
  const run = async <T>(fn: () => Promise<T>, fallback: string): Promise<T | null> => {
    setPending(true);
    try {
      return await fn();
    } catch (err) {
      toast.error(refusalText(err, fallback));
      return null;
    } finally {
      setPending(false);
    }
  };
  const preview = (email: string) =>
    run(
      async () =>
        (
          await apiSend<{ preview: FleetPreview }>(`${FLEET_PATH}/bans`, 'POST', {
            ...body(email, ''),
            preview: true,
          })
        ).preview,
      'Could not preview the ban.',
    );
  const make = async (email: string, reason: string) => {
    const done = await run(
      () => apiSend(`${FLEET_PATH}/bans`, 'POST', body(email, reason)),
      'Could not make the ban.',
    );
    if (done === null) return false;
    toast.success('Ban made. Every box runs it now.');
    onChanged();
    return true;
  };
  const lift = async (ban: FleetBan) => {
    const done = await run(
      () => apiSend(`${FLEET_PATH}/bans/${ban.id}/lift`, 'POST'),
      'Could not lift the ban.',
    );
    if (done === null) return false;
    toast.success(ban.kind === 'archive' ? 'Ban retired.' : 'Ban lifted. Every box runs it now.');
    onChanged();
    return true;
  };
  return { pending, preview, make, lift };
}
