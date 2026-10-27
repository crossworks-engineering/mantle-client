'use client';

import { useEffect, useState } from 'react';
import { AtSign, BellOff, Check, CheckCheck, Pin } from 'lucide-react';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { cn } from '@mantle/web-ui/lib/utils';
import { ChatAvatar } from '@/components/messenger/chat-avatar';
import { useReadByAll } from '@/components/messenger/messenger-live';
import type { MessengerListRow } from '@/lib/messenger/dto';
import { groupLook, type ChatFace, type FaceOf } from '@/lib/messenger/faces';
import { directPeer, listTime, otherPeople, previewLine, rowBadge } from '@/lib/messenger/format';

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
 * when open, no rule between rows), no taller than its avatar: the avatar (a
 * green dot while the other person is online), the name and up to two
 * lines of the last message (a tick before it when it is mine: one sent, two
 * read), and at the right the time with the marks and the unread pill (green,
 * grey when muted; `rowBadge`) under it. Agent rows count the same way.
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
  const badge = rowBadge(row);
  return (
    <RowButton
      onClick={onOpen}
      aria-current={selected ? 'true' : undefined}
      data-testid="chat-row"
      className={cn(
        'flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors',
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
        size="lg"
      />
      {/* The name, then up to two lines of the last message, tight: the
          text is the avatar's height (16 + 2 x 14 = 44 px). */}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium leading-4">{row.title}</span>
        <span className="line-clamp-2 text-[13px] leading-[14px] text-muted-foreground">
          {line?.mine ? (
            <Tick
              className={cn(
                'mr-1 inline size-3.5 align-[-3px]',
                read ? 'text-success-ink' : 'text-muted-foreground',
              )}
              role="img"
              aria-label={read ? 'Read' : 'Sent'}
            />
          ) : null}
          {line?.text ?? 'No messages yet'}
        </span>
      </span>
      {/* The time, and under it the marks and the unread pill. */}
      <span className="flex shrink-0 flex-col items-end gap-1 self-start">
        <span className="text-xs leading-4 text-muted-foreground">
          {listTime(row.lastMessageAt, now)}
        </span>
        <span className="flex h-5 items-center gap-1">
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
          {badge?.mention ? (
            <AtSign
              className="size-3.5 shrink-0 text-success-ink"
              role="img"
              aria-label="Mentions you"
            />
          ) : null}
          {badge ? (
            <span
              className={cn(
                'inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums',
                badge.muted
                  ? 'bg-muted-foreground/30 text-foreground'
                  : 'bg-success text-success-foreground',
              )}
              aria-label={badge.label}
            >
              {badge.text}
            </span>
          ) : null}
        </span>
      </span>
    </RowButton>
  );
}
