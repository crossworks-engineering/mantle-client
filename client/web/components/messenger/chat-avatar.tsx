'use client';

import { Bot, Users } from 'lucide-react';
import { Avatar, AvatarFallback } from '@mantle/web-ui/ui/avatar';
import { cn } from '@mantle/web-ui/lib/utils';
import { initials } from '@/lib/messenger/format';

/**
 * The round avatar of a chat row, a header and a group member: initials for
 * a person (the brain serves no other login's photo), a group glyph for a
 * group, a bot glyph for an assistant. A small green dot at the corner while
 * the person is online.
 */
export function ChatAvatar({
  name,
  kind = 'person',
  online = false,
  size = 'md',
  className,
}: {
  name: string;
  kind?: 'person' | 'group' | 'agent';
  online?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const box = size === 'sm' ? 'size-8 text-[11px]' : 'size-10 text-xs';
  const glyph = size === 'sm' ? 'size-3.5' : 'size-4';
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <Avatar className={box}>
        <AvatarFallback className="bg-muted font-medium text-muted-foreground">
          {kind === 'group' ? (
            <Users className={glyph} aria-hidden />
          ) : kind === 'agent' ? (
            <Bot className={glyph} aria-hidden />
          ) : (
            initials(name)
          )}
        </AvatarFallback>
      </Avatar>
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
