'use client';

/**
 * The call dock (calls plan section 10): one card in the dock stack beside
 * the uploads, mounted once by the shell so a call survives every route
 * change. While this tab is in a call: the chat, the running time, who is
 * in the room (speaking, muted), Mute and Leave; a group's admin (either
 * person of a direct chat) can end the call for everyone and drop a person
 * from it. Collapses to one row. Voice only in P1: no video, no device
 * menu yet.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ChevronDown, Mic, MicOff, Phone, PhoneOff, UserX, Volume2 } from 'lucide-react';
import { cn } from '@mantle/web-ui/lib/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@mantle/web-ui/ui/alert-dialog';
import { Button } from '@mantle/web-ui/ui/button';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { useToast } from '@mantle/web-ui/ui/toast';
import { ChatAvatar } from '@/components/messenger/chat-avatar';
import { useChatFaces } from '@/components/messenger/chat-faces';
import { useNow } from '@/components/use-now';
import { useShellWorkspaces } from '@/components/workspaces/use-shell-workspaces';
import { messengerApi, messengerKeys } from '@/lib/messenger/api';
import { durationLabel } from '@/lib/calls/ring';
import type { RoomPerson } from '@/lib/calls/room';
import { callSession, useCallState } from './call-store';

export function CallDock() {
  const call = useCallState();
  const router = useRouter();
  const toast = useToast();
  const [collapsed, setCollapsed] = useState(false);
  const [ending, setEnding] = useState(false);
  const me = useShellWorkspaces()?.loginId ?? null;
  const faceOf = useChatFaces();
  const inCall = call.phase === 'joining' || call.phase === 'live' || call.phase === 'ending';
  const id = call.conversationId;

  // The chat's people, for names and faces, and my rights in it (a
  // group's admin ends the call and drops people; a direct chat's two
  // people may both end it).
  const conversation = useQuery({
    queryKey: messengerKeys.conversation(id ?? ''),
    queryFn: () => messengerApi.conversation(id!),
    enabled: inCall && !!id,
  }).data;
  useEffect(() => {
    if (!conversation || conversation.id !== id) return;
    const group = conversation.kind === 'group';
    callSession().setRights({ admin: group ? conversation.me.admin : true, group });
  }, [conversation, id]);

  // What ended the last call, said once (a removed person, a cut line).
  useEffect(() => {
    if (call.phase !== 'idle' || !call.notice) return;
    toast.info(call.notice);
    callSession().clearNotice();
  }, [call.phase, call.notice, toast]);
  // Something to say at once, whatever the phase (a brain not reached).
  useEffect(() => {
    if (!call.trouble) return;
    toast.error(call.trouble);
    callSession().clearTrouble();
  }, [call.trouble, toast]);

  if (!inCall || !id) return null;

  const nameOf = (p: RoomPerson) =>
    p.me
      ? 'You'
      : (conversation?.participants.find((x) => x.id === (p.loginId ?? p.agentId))?.name ??
        'Someone');
  const people = [...call.people].sort((a, b) => Number(b.me) - Number(a.me));
  const live = call.phase === 'live';
  const heading =
    call.phase === 'joining'
      ? `Joining ${call.title}`
      : call.phase === 'ending'
        ? 'Leaving the call'
        : call.title;
  const href = `/chats/${encodeURIComponent(id)}`;
  // End for all: a group's admin, either person of a direct chat. Remove:
  // a group's admin only (a direct chat has nobody to drop).
  const canEnd = call.admin && live;
  const canRemove = call.admin && call.group;
  const endForAll = () =>
    void callSession()
      .end()
      .catch(() => toast.error('The call could not be ended'));

  return (
    <div
      className="pointer-events-auto w-full overflow-hidden rounded-lg border border-border bg-card shadow-lg"
      role="region"
      aria-label="Call"
      data-testid="call-dock"
    >
      <RowButton
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-label={`${collapsed ? 'Expand' : 'Collapse'} the call: ${heading}`}
        aria-expanded={!collapsed}
      >
        <Phone
          className={cn('size-4 shrink-0', live ? 'text-success-ink' : 'text-muted-foreground')}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{heading}</span>
        {live ? <Elapsed since={call.liveSince} /> : null}
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            collapsed && '-rotate-90',
          )}
          aria-hidden
        />
      </RowButton>

      {!collapsed ? (
        <>
          {call.audioBlocked ? (
            <div className="border-t border-border px-3 py-2">
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => void callSession().resumeAudio()}
              >
                <Volume2 aria-hidden /> Tap to hear the call
              </Button>
            </div>
          ) : null}
          {call.micBlocked ? (
            <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
              No microphone: you can listen, the others cannot hear you.
            </p>
          ) : null}
          <ul
            className="max-h-56 divide-y divide-border overflow-y-auto scrollbar-thin border-t border-border"
            aria-label="In the call"
          >
            {people.map((p) => {
              const name = nameOf(p);
              const participant = conversation?.participants.find(
                (x) => x.id === (p.loginId ?? p.agentId),
              );
              const removable = canRemove && !p.me && !!p.loginId && p.loginId !== me;
              return (
                <li key={p.identity} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <ChatAvatar
                    name={participant?.name ?? name}
                    kind={p.agentId ? 'agent' : 'person'}
                    face={faceOf({
                      kind: p.agentId ? 'agent' : 'login',
                      id: p.loginId ?? p.agentId,
                      avatar: participant?.avatar,
                      photoVersion: participant?.photoVersion,
                    })}
                    size="xs"
                  />
                  <span
                    className={cn('min-w-0 flex-1 truncate', p.speaking && 'text-success-ink')}
                    data-speaking={p.speaking ? 'true' : undefined}
                  >
                    {name}
                    {p.speaking ? <span className="sr-only"> (speaking)</span> : null}
                  </span>
                  {p.muted ? (
                    <MicOff
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-label="Muted"
                    />
                  ) : null}
                  {removable ? (
                    <Button
                      size="icon-2xs"
                      variant="ghost"
                      aria-label={`Remove ${name} from the call`}
                      title="Remove from the call"
                      onClick={() =>
                        void callSession()
                          .removeParticipant(p.loginId!)
                          .catch(() => toast.error('That did not work'))
                      }
                    >
                      <UserX aria-hidden />
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className="flex items-center gap-2 border-t border-border px-3 py-2">
            <Button
              size="sm"
              variant={call.muted ? 'secondary' : 'outline'}
              aria-pressed={call.muted}
              disabled={!live || call.micBlocked}
              onClick={() => void callSession().setMuted(!call.muted)}
            >
              {call.muted ? <MicOff aria-hidden /> : <Mic aria-hidden />}
              {call.muted ? 'Unmute' : 'Mute'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => router.push(href)}>
              Open chat
            </Button>
            <span className="flex-1" />
            {canEnd ? (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setEnding(true)}
                title="End the call for everyone"
              >
                End for all
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              disabled={call.phase === 'ending'}
              onClick={() => void callSession().leave(null)}
            >
              <PhoneOff aria-hidden /> Leave
            </Button>
          </div>
        </>
      ) : null}
      <AlertDialog open={ending} onOpenChange={(o) => !o && setEnding(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End the call for everyone?</AlertDialogTitle>
            <AlertDialogDescription>
              Everyone in the call is disconnected. Leave instead to go while the others stay.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setEnding(false);
                endForAll();
              }}
            >
              End for all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** The running time, ticking once a second. */
function Elapsed({ since }: { since: number | null }) {
  const now = useNow(1000);
  if (!since || !now) return null;
  return (
    <span className="shrink-0 tabular-nums text-xs text-muted-foreground" role="timer">
      <span className="sr-only">Call time </span>
      {durationLabel(Math.floor((now - since) / 1000))}
    </span>
  );
}
