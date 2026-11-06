'use client';

import { useEffect, useState } from 'react';
import { STAGE, type NoticePhase } from '@/lib/update-notice/state';

export const NOTICE_HEADING = 'Update In Progress';
export const NOTICE_TEXT =
  'We are adding features and fixing bugs. This takes a few minutes. Thanks for your understanding.';

/**
 * What the update notice shows: the MantleOS logo, the heading, the text and
 * a bar that mimics progress. No button, no link, nothing to answer. The bar
 * creeps toward its stage's mark with a long ease-out (it slows and never
 * quite stops), and runs to the end when the update is done. Under reduced
 * motion the global clamp (app/globals.css) makes every change a jump and
 * stops the shimmer: the bar steps from stage to stage, the words still say
 * where it is.
 *
 * The heading and the text are the dialog's title and description for
 * assistive tech (update-notice.tsx), so they are hidden from it here.
 */
export function UpdateNoticeBody({ phase }: { phase: Exclude<NoticePhase, 'off'> }) {
  const stage = STAGE[phase];
  // Start empty, then move: a transition needs a first frame to run from.
  const [pct, setPct] = useState(0);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setPct(stage.pct));
    return () => cancelAnimationFrame(raf);
  }, [stage.pct]);

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/mantleos-logo-stacked.svg"
        alt=""
        aria-hidden
        width={160}
        height={160}
        className="mantle-notice-breathe h-36 w-auto object-contain"
      />
      {/* Read once, as the dialog's title and description (update-notice.tsx). */}
      <div aria-hidden className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{NOTICE_HEADING}</h1>
        <p className="text-muted-foreground">{NOTICE_TEXT}</p>
      </div>
      <div className="w-full space-y-2">
        <div
          role="progressbar"
          aria-label={NOTICE_HEADING}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={stage.text}
          className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className="relative h-full overflow-hidden rounded-full bg-primary transition-[width] ease-out"
            style={{ width: `${pct}%`, transitionDuration: `${stage.ms}ms` }}
          >
            <span aria-hidden className="mantle-notice-shimmer absolute inset-0" />
          </div>
        </div>
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {stage.text}
        </p>
      </div>
    </div>
  );
}
