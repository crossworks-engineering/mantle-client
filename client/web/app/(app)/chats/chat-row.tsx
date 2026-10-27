'use client';

import { useEffect, useState } from 'react';
import { AtSign, BellOff, Check, CheckCheck, Pin } from 'lucide-react';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { cn } from '@mantle/web-ui/lib/utils';
import { ChatAvatar } from '@/components/messenger/chat-avatar';
import { useReadByAll } from '@/components/messenger/messenger-live';
import type { MessengerListRow } from '@/lib/messenger/dto';
import { groupLook, type ChatFace, type FaceOf } from '@/lib/messenger/faces';
import { badgeCount, directPeer, listTime, otherPeople, previewLine } from '@/lib/messenger/format';

/** Re-render the relative times once a minute. */
function useMinute(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/**
 * One row of the chat list, on the item tree's row (rounded, the accent fill
 * when open, no rule between rows): the avatar (a green dot while the other
 * person is online), the name and the relative time, then the last line (a tick before
 * it when it is mine: one sent, two read) and the green unread badge.
 */
export function ChatRow({
  row,
  me,
  online,
  selected,
  faceOf,
  onOpen,
}: {
  row: MessengerListRow;
  me: string | null;
  online: ReadonlySet<string>;
  selected: boolean;
  faceOf: (who: FaceOf) => ChatFace;
  onOpen: () => void;
}) {
  const now = useMinute();
  const peer = directPeer(row, me);
  const line = previewLine(row, me);
  const others = otherPeople(row.participants, me).map((p) => p.id);
  const readByAll = useReadByAll(row.id, others);
  const read = line?.mine && row.lastSeq !== null && readByAll >= row.lastSeq;
  const Tick = read ? CheckCheck : Check;
  return (
    <RowButton
      onClick={onOpen}
      aria-current={selected ? 'true' : undefined}
      data-testid="chat-row"
      className={cn(
        'flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left transition-colors',
        selected ? 'bg-accent text-accent-foreground' : 'hover:bg-foreground/[0.06]',
      )}
    >
      <ChatAvatar
        name={row.title}
        kind={row.kind === 'group' ? 'group' : row.kind === 'agent' ? 'agent' : 'person'}
        face={
          row.kind === 'agent'
            ? faceOf({ kind: 'agent', id: row.id, slug: row.agentSlug })
            : peer
              ? faceOf({
                  kind: 'login',
                  id: peer.id,
                  avatar: peer.avatar,
                  photoVersion: peer.photoVersion,
                })
              : null
        }
        look={row.kind === 'group' ? groupLook(row) : null}
        online={!!peer && online.has(peer.id)}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.title}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {listTime(row.lastMessageAt, now)}
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-1.5">
          {line?.mine ? (
            <Tick
              className={cn(
                'size-3.5 shrink-0',
                read ? 'text-success-ink' : 'text-muted-foreground',
              )}
              role="img"
              aria-label={read ? 'Read' : 'Sent'}
            />
          ) : null}
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            {line?.text ?? 'No messages yet'}
          </span>
          {row.favourite ? (
            <Pin
              className="size-3.5 shrink-0 text-muted-foreground"
              role="img"
              aria-label="Pinned"
            />
          ) : null}
          {row.muted ? (
            <BellOff
              className="size-3.5 shrink-0 text-muted-foreground"
              role="img"
              aria-label="Muted"
            />
          ) : null}
          {row.mention && row.unread > 0 ? (
            <AtSign
              className="size-3.5 shrink-0 text-success-ink"
              role="img"
              aria-label="Mentions you"
            />
          ) : null}
          {row.unread > 0 ? (
            <span
              className={cn(
                'inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums',
                row.muted
                  ? 'bg-muted-foreground/30 text-foreground'
                  : 'bg-success text-success-foreground',
              )}
              aria-label={`${row.unread} unread`}
            >
              {badgeCount(row.unread)}
            </span>
          ) : null}
        </span>
      </span>
    </RowButton>
  );
}
