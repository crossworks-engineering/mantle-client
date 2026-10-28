'use client';

/**
 * The incoming call (calls plan section 5), in the dock stack beside the
 * uploads: who is calling (the caller's face, the group), Answer and
 * Decline. It rings for 45 seconds (the session's timer), then goes by
 * itself. Decline sends nothing: the ring just stops.
 */
import { useQuery } from '@tanstack/react-query';
import { Phone, PhoneOff } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import { ChatAvatar } from '@/components/messenger/chat-avatar';
import { useChatFaces } from '@/components/messenger/chat-faces';
import { messengerApi, messengerKeys } from '@/lib/messenger/api';
import { groupLook } from '@/lib/messenger/faces';
import { ringText } from '@/lib/calls/ring';
import { callSession, useCallState } from './call-store';

export function RingCard() {
  const { phase, ring } = useCallState();
  const faceOf = useChatFaces();
  const rows = useQuery({
    queryKey: messengerKeys.list,
    queryFn: messengerApi.list,
    enabled: phase === 'ringing',
  }).data;
  if (phase !== 'ringing' || !ring) return null;
  const row = rows?.find((r) => r.id === ring.conversationId) ?? null;
  const caller = row?.participants.find((p) => p.kind === 'login' && p.name === ring.callerName);
  const text = ringText(ring.callerName, ring.groupTitle);
  const answer = () => void callSession().answer(row?.title ?? ring.callerName, false);
  return (
    <div
      className="pointer-events-auto w-full overflow-hidden rounded-lg border border-border bg-card shadow-lg"
      role="alertdialog"
      aria-live="assertive"
      aria-label={text.title}
      data-testid="call-ring"
    >
      <div className="flex items-center gap-3 px-3 py-3">
        {ring.groupTitle ? (
          <ChatAvatar name={ring.groupTitle} kind="group" look={groupLook(row)} size="md" />
        ) : (
          <ChatAvatar
            name={ring.callerName}
            kind="person"
            face={faceOf({
              kind: 'login',
              id: caller?.id ?? null,
              avatar: caller?.avatar,
              photoVersion: caller?.photoVersion,
            })}
            size="md"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{text.title}</p>
          <p className="text-xs text-muted-foreground">Voice call</p>
        </div>
      </div>
      <div className="flex gap-2 border-t border-border px-3 py-2">
        <Button size="sm" className="flex-1" onClick={answer} autoFocus>
          <Phone aria-hidden /> Answer
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          onClick={() => callSession().decline()}
        >
          <PhoneOff aria-hidden /> Decline
        </Button>
      </div>
    </div>
  );
}
