'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiFetch, apiSend } from '@mantle/web-ui/api-fetch';
import { useToast } from '@mantle/web-ui/ui/toast';
import { FLEET_PATH, type FleetBan, type FleetBox, type FleetPreview } from '@/lib/fleet';
import {
  FLEET_MEMBERS_PATH,
  FLEET_PEOPLE_KEY,
  FLEET_PEOPLE_PATH,
  membersSentText,
  type FleetPeopleAnswer,
  type MemberChange,
} from '@/lib/fleet-people';
import { writeUpdatePending } from '@/lib/fleet-writes';
import { refusalText } from '../fleet-section';

/** The people read. Null: a brain before Fleet users (404 or 405). */
async function readPeople(): Promise<FleetPeopleAnswer | null> {
  try {
    return await apiFetch<FleetPeopleAnswer>(FLEET_PEOPLE_PATH);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 405)) return null;
    throw err;
  }
}

/** The people of every box, read again every 3 s while a change waits, and
 *  once more when the last change is answered (the box sends its people
 *  list right after its writes). */
export function usePeople(boxes: readonly FleetBox[]) {
  const queryClient = useQueryClient();
  const waiting = writeUpdatePending(boxes);
  const query = useQuery({
    queryKey: FLEET_PEOPLE_KEY,
    queryFn: readPeople,
    staleTime: 30_000,
    retry: 1,
    refetchInterval: waiting ? 3000 : false,
  });
  const was = useRef(waiting);
  useEffect(() => {
    if (was.current && !waiting) void queryClient.invalidateQueries({ queryKey: FLEET_PEOPLE_KEY });
    was.current = waiting;
  }, [waiting, queryClient]);
  return query;
}

/** One send of workspace changes, then a toast that says what was queued. */
export function useMembersSend(onChanged: () => void) {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const send = async (changes: MemberChange[]): Promise<boolean> => {
    if (changes.length === 0) return false;
    setPending(true);
    try {
      const r = await apiSend<{ boxIds?: string[] }>(FLEET_MEMBERS_PATH, 'POST', { changes });
      const queued = r?.boxIds ?? [...new Set(changes.map((c) => c.boxId))];
      toast.success(membersSentText(changes, queued));
      onChanged();
      return true;
    } catch (err) {
      toast.error(refusalText(err, 'Could not send the workspace changes.'));
      return false;
    } finally {
      setPending(false);
    }
  };
  return { pending, send };
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
