'use client';

import { Users } from 'lucide-react';
import { Avatar, AvatarFallback } from '@mantle/web-ui/ui/avatar';
import { avatarPartsOf } from '@mantle/web-ui/avatar-parts';
import { GeneratedAvatar } from '@mantle/web-ui/generated-avatar';
import { cn } from '@mantle/web-ui/lib/utils';
import { AppTile } from '@/components/app-nav/app-tile';
import { ProfilePhoto } from '@/components/profile-photo';
import { initials } from '@/lib/messenger/format';
import type { ChatFace, GroupLook } from '@/lib/messenger/faces';

const PX = { xs: 24, sm: 32, md: 40, lg: 44 } as const;

/**
 * The round avatar of a chat row, a header, a group member, a transcript
 * author and the New message pick list: the face the login or agent chose in
 * Appearance (`useChatFaces`). The same precedence as the rail's account
 * row: a person's uploaded photo, then the generated
 * avatar from their seed, then initials. An agent always has a generated
 * avatar (its seed, else its slug), never initials. A group shows its icon
 * and colour on a round tile (`AppTile`, a folder's look), else the group
 * glyph. A small green dot at the corner while the person is online.
 */
export function ChatAvatar({
  name,
  kind = 'person',
  face,
  look,
  online = false,
  size = 'md',
  className,
}: {
  name: string;
  kind?: 'person' | 'group' | 'agent';
  /** The chosen avatar, from the `useChatFaces()` lookup. */
  face?: ChatFace | null;
  /** A group's icon and colour (`groupLook`). */
  look?: GroupLook | null;
  online?: boolean;
  size?: keyof typeof PX;
  className?: string;
}) {
  const px = PX[size];
  const box = {
    xs: 'size-6 text-[10px]',
    sm: 'size-8 text-[11px]',
    md: 'size-10 text-xs',
    lg: 'size-11 text-xs',
  }[size];
  const fallback = (
    <Avatar className={box}>
      <AvatarFallback className="bg-muted font-medium text-muted-foreground">
        {kind === 'group' ? (
          <Users className={size === 'md' || size === 'lg' ? 'size-4' : 'size-3.5'} aria-hidden />
        ) : (
          initials(name)
        )}
      </AvatarFallback>
    </Avatar>
  );
  const seed = kind === 'agent' ? face?.avatar?.seed || face?.slug || name : face?.avatar?.seed;
  const generated =
    kind !== 'group' && seed ? (
      <GeneratedAvatar seed={seed} parts={avatarPartsOf(face?.avatar)} size={px} />
    ) : (
      fallback
    );
  const drawn =
    kind === 'group' && (look?.icon || look?.color) ? (
      <AppTile icon={look.icon} color={look.color} kind="group" size={`face-${size}`} />
    ) : kind === 'person' && face?.photo ? (
      <ProfilePhoto
        path={face.photo.path}
        version={face.photo.version}
        size={px}
        alt=""
        fallback={generated}
      />
    ) : (
      generated
    );
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      {drawn}
      {online ? (
        <span
          className="absolute bottom-0 right-0 size-2.5 rounded-full bg-success ring-2 ring-background"
          aria-label="Online"
          role="img"
        />
      ) : null}
    </span>
  );
}
