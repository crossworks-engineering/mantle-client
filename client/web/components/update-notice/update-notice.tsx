'use client';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@mantle/web-ui/ui/dialog';
import { useUpdateNotice } from '@/lib/update-notice/use-update-notice';
import { NOTICE_HEADING, NOTICE_TEXT, UpdateNoticeBody } from './update-notice-body';

/** Swallow a close request: the notice goes only when the update is done. */
const stay = (e: Event) => e.preventDefault();

/**
 * The "Update In Progress" notice: full screen, above everything (menus sit
 * at z-[2002]), and it cannot be closed. Escape, a click outside and focus
 * leaving are all refused; Radix keeps focus inside and hides the page from
 * assistive tech while it shows. The background is solid: nothing of the
 * page behind it shows through.
 *
 * Mounted beside the shell gate (components/app-shell.tsx), so a page opened
 * while the brain is down shows it rather than the reconnecting card, and on
 * the sign-in page, so a login sent there mid-restart still sees why.
 */
export function UpdateNotice() {
  const { phase } = useUpdateNotice();
  if (phase === 'off') return null;
  return (
    <Dialog open modal>
      <DialogContent
        hideClose
        role="alertdialog"
        onEscapeKeyDown={stay}
        onInteractOutside={stay}
        onPointerDownOutside={stay}
        onFocusOutside={stay}
        className="inset-0 left-0 top-0 z-[3000] flex h-dvh max-h-none w-screen max-w-none translate-x-0 translate-y-0 items-center justify-center overflow-hidden rounded-none border-0 bg-background p-6 shadow-none"
      >
        <DialogTitle className="sr-only">{NOTICE_HEADING}</DialogTitle>
        <DialogDescription className="sr-only">{NOTICE_TEXT}</DialogDescription>
        <UpdateNoticeBody phase={phase} />
      </DialogContent>
    </Dialog>
  );
}
