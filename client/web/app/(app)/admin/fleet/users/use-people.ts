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
  sentSummary,
  toolCalls,
  type FleetPeople,
  type MemberAnswer,
  type MemberChange,
} from '@/lib/fleet-people';
import {
  callFleetTool,
  MAX_TOOL_CHANGES,
  USERS_LIST_TOOL,
  WORKSPACE_USER_SET_TOOL,
  type ToolBoxAnswer,
} from '@/lib/fleet-tool';
import { refusalText } from '../fleet-section';

/** The users_list read: each box's answer, or `channel: false` while the
 *  Control Center has no admin channel (the route answers 404). */
type PeopleRead = { channel: false } | { channel: true; answers: ToolBoxAnswer[] };

/** The people of every linked box: one users_list call over the admin
 *  channel. A box that did not answer keeps its last good list, with its
 *  reason. `reread` asks the boxes named again (after a write). */
export function usePeople(fleet: FleetOverview) {
  const queryClient = useQueryClient();
  const ids = useMemo(() => fleet.boxes.map((b) => b.id), [fleet.boxes]);
  const key = useMemo(() => [...FLEET_PEOPLE_KEY, ids.join(',')], [ids]);
  const query = useQuery({
    queryKey: key,
    queryFn: async (): Promise<PeopleRead> => {
      const answers = await callFleetTool(ids, USERS_LIST_TOOL, {});
      return answers === null ? { channel: false } : { channel: true, answers };
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
    const out = peopleBoxes(fleet.boxes, read.answers, kept.current);
    for (const b of out) if (b.people && !b.peopleReason) kept.current.set(b.id, b.people);
    return out;
  }, [read, fleet.boxes]);

  const reread = useCallback(
    async (boxIds: string[]) => {
      if (boxIds.length === 0) return;
      const fresh = await callFleetTool(boxIds, USERS_LIST_TOOL, {}).catch(() => null);
      if (!fresh) return;
      queryClient.setQueryData<PeopleRead>(key, (old) => {
        if (!old || !old.channel) return old;
        const answers = old.answers.filter((a) => !boxIds.includes(a.boxId));
        return { channel: true, answers: [...answers, ...fresh] };
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

/** Workspace changes over the admin channel: one workspace_user_set call
 *  per box (at most 20 changes each), the answers from the calls' own
 *  replies, then the boxes read again. */
export function useMembersWrite(reread: (boxIds: string[]) => Promise<void>) {
  const toast = useToast();
  const [sending, setSending] = useState<MemberChange[]>([]);
  const [answers, setAnswers] = useState<MemberAnswer[]>([]);
  const send = async (changes: MemberChange[]): Promise<MembersSent> => {
    if (changes.length === 0) return false;
    setSending(changes);
    try {
      const calls = toolCalls(changes, MAX_TOOL_CHANGES);
      const done = await Promise.all(
        calls.map(async (call) => {
          let answer: ToolBoxAnswer | undefined;
          try {
            const r = await callFleetTool([call.boxId], WORKSPACE_USER_SET_TOOL, {
              changes: call.changes.map(({ loginId, workspaceId, role }) => ({
                loginId,
                workspaceId,
                role,
              })),
            });
            answer =
              r === null
                ? { boxId: call.boxId, ok: false, output: undefined, reason: 'no-channel' }
                : r.find((a) => a.boxId === call.boxId);
          } catch (err) {
            toast.error(refusalText(err, 'Could not send the workspace changes.'));
            answer = { boxId: call.boxId, ok: false, output: undefined, reason: 'error' };
          }
          return memberAnswers(call.changes, answer);
        }),
      );
      const all = done.flat();
      setAnswers((a) => [...a, ...all]);
      const said = sentSummary(all);
      if (said.tone === 'ok') toast.success(said.text);
      else toast.error(said.text);
      await reread([...new Set(all.filter((a) => !boxLevel(a)).map((a) => a.boxId))]);
      return {
        answers: all,
        left: all
          .filter(boxLevel)
          .map(({ boxId, loginId, workspaceId, role }) => ({ boxId, loginId, workspaceId, role })),
      };
    } finally {
      setSending([]);
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
