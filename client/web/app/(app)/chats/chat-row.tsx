'use client';

import { useEffect, useState } from 'react';
import { AtSign, BellOff, Check, CheckCheck, Pin } from 'lucide-react';
import { ListCard } from '@mantle/web-ui/ui/list-card';
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
 * One row of the chat list, a `ListCard` like every other master-detail list
 * (settings/peers): the soft tint and primary ring when open, so the muted
 * preview stays readable, never the tree's full accent fill. Its text is no
 * taller than its avatar: the
 * avatar (a green dot while the other person is online), the name and up to
 * two lines of the last message (a tick before it when it is mine: one sent, two
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
    <ListCard
      onClick={onOpen}
      selected={selected}
      aria-current={selected ? 'true' : undefined}
      data-testid="chat-row"
      className="flex items-start gap-3"
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
      {/* The name, then up to two lines of the last message, tight: at most
          the avatar's height (1rem + 2 x 0.875rem, 44 px at the default
          size), top-aligned with the time whatever the preview's length. */}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium leading-4">{row.title}</span>
        <span className="line-clamp-2 text-[0.8125rem] leading-3.5 text-muted-foreground [overflow-wrap:anywhere]">
          {line?.mine ? (
            <Tick
              className={cn(
                'mr-1 inline size-3 align-[-2px]',
                read ? 'text-success-ink' : 'text-muted-foreground',
              )}
              role="img"
              aria-label={read ? 'Read' : 'Sent'}
            />
          ) : null}
          {line?.text || 'No messages yet'}
        </span>
      </span>
      {/* The time, and under it the marks and the unread pill. */}
      <span className="flex shrink-0 flex-col items-end gap-1">
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
          {/* A muted chat with unread says so in its grey pill. */}
          {row.muted && !badge ? (
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
            >
              <span aria-hidden>{badge.text}</span>
              <span className="sr-only">{badge.label}</span>
            </span>
          ) : null}
        </span>
      </span>
    </ListCard>
  );
}
