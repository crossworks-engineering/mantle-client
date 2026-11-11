'use client';

import { useState, type ReactNode } from 'react';
import { apiSend } from '@mantle/web-ui/api-fetch';
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
import { useToast } from '@mantle/web-ui/ui/toast';
import { sentText, type FleetWriteChange } from '@/lib/fleet-writes';
import { refusalText } from './fleet-section';

/** One fleet write send: the changes to the boxes picked, then a toast that
 *  says how many boxes were queued. True when it was sent. */
export function useFleetSend(path: string, onChanged: () => void) {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const send = async (
    changes: FleetWriteChange[] | { slug: string; model: string }[],
    boxIds: string[],
    fallback: string,
  ): Promise<boolean> => {
    setPending(true);
    try {
      const r = await apiSend<{ queued?: number }>(path, 'POST', { changes, boxIds });
      toast.success(sentText(boxIds.length, r?.queued ?? boxIds.length));
      onChanged();
      return true;
    } catch (err) {
      toast.error(refusalText(err, fallback));
      return false;
    } finally {
      setPending(false);
    }
  };
  return { pending, send };
}

/** The one question before a fleet write goes. */
export function ConfirmSend({
  open,
  pending,
  title,
  children,
  action,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  pending: boolean;
  title: string;
  children: ReactNode;
  action: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && !pending && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{children}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            {action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
