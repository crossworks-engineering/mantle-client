'use client';

/**
 * The card's face, talking (Project Bubble Chat, plan section 8). It is the
 * same face as everywhere else (ChatAvatar), with the mouth swapped about 6
 * times a second and a small bob, while `talking`. Only the mouth changes,
 * from the brain's own style, so it stays the same person; the stored avatar
 * never changes. A photo, a group and a style with one mouth bob only.
 *
 * Reduced motion: no frames and no bob. A hidden tab runs no timer.
 */
import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { useAvatarStyle } from '@mantle/web-ui/avatar-style-provider';
import { loadedAvatarStyle } from '@mantle/web-ui/avatar';
import { avatarPartsOf } from '@mantle/web-ui/avatar-parts';
import { GeneratedAvatar } from '@mantle/web-ui/generated-avatar';
import { prefersReducedMotion } from '@mantle/web-ui/lib/motion';
import { cn } from '@mantle/web-ui/lib/utils';
import { ChatAvatar } from '@/components/messenger/chat-avatar';
import { TALK_FRAME_MS, mouthFrames } from '@/lib/bubbles/mouths';

const BOB: Keyframe[] = [
  { transform: 'translateY(0)' },
  { transform: 'translateY(-2px)' },
  { transform: 'translateY(0)' },
];

/** The tab is shown: a hidden one runs no timer. */
function useShown(): boolean {
  const [shown, setShown] = useState(() => typeof document === 'undefined' || !document.hidden);
  useEffect(() => {
    const on = () => setShown(!document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return shown;
}

export function TalkingAvatar({
  talking,
  ...face
}: ComponentProps<typeof ChatAvatar> & { talking: boolean }) {
  const { avatarStyle } = useAvatarStyle();
  const shown = useShown();
  const moving = talking && shown && !prefersReducedMotion();
  const boxRef = useRef<HTMLSpanElement>(null);
  const [frame, setFrame] = useState(0);

  const { kind = 'person', name } = face;
  const avatar = face.face?.avatar ?? null;
  const drawn = kind !== 'group' && !(kind === 'person' && face.face?.photo);
  const seed = kind === 'agent' ? avatar?.seed || face.face?.slug || name : avatar?.seed;
  const own = avatarPartsOf(avatar);
  const ownMouth = typeof own?.mouth === 'string' ? own.mouth : null;
  const frames = useMemo(
    () =>
      drawn && seed
        ? mouthFrames(loadedAvatarStyle(avatarStyle)?.variants.mouth, seed, ownMouth)
        : [],
    [drawn, seed, avatarStyle, ownMouth],
  );

  // The mouth: the own one, then a frame, then the own one again, and so on.
  useEffect(() => {
    if (!moving || frames.length === 0) {
      setFrame(0);
      return;
    }
    let i = 0;
    const timer = window.setInterval(() => {
      i += 1;
      setFrame(i % 2 === 1 ? 1 + (Math.floor(i / 2) % frames.length) : 0);
    }, TALK_FRAME_MS);
    return () => window.clearInterval(timer);
  }, [moving, frames]);

  // The bob, for every face, a photo too.
  useEffect(() => {
    const node = boxRef.current;
    if (!moving || !node || typeof node.animate !== 'function') return;
    const run = node.animate(BOB, { duration: 900, iterations: Infinity, easing: 'ease-in-out' });
    return () => run.cancel();
  }, [moving]);

  const mouth = frame > 0 ? frames[frame - 1] : undefined;
  const px = { xs: 24, sm: 32, md: 40, lg: 44 }[face.size ?? 'md'];
  return (
    <span
      ref={boxRef}
      data-testid="bubble-face"
      data-talking={moving ? 'true' : undefined}
      className={cn('inline-flex', face.className)}
    >
      {mouth && seed ? (
        <GeneratedAvatar seed={seed} parts={{ ...own, mouth }} size={px} />
      ) : (
        <ChatAvatar {...face} className={undefined} />
      )}
    </span>
  );
}
