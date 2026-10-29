'use client';

import { AccessSlot } from '@/components/share/access-slot';
import { useState, useTransition } from 'react';
import {
  Bell,
  CalendarCheck,
  CalendarClock,
  CalendarPlus,
  Clock,
  MapPin,
  Repeat,
} from 'lucide-react';
import { FormShell } from '@mantle/web-ui/ui/form-shell';
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
import { apiSend, ApiError } from '@mantle/web-ui/api-fetch';
import { HeaderPill, ItemHeader } from '@/components/layout/item-header';
import { formatDateTime } from '@mantle/web-ui/lib/format-datetime';
import { useNow } from '@/components/use-now';
import {
  approachProgress,
  buildIcsHref,
  countdownParts,
  eventProgress,
  eventState,
  formatRelativeShort,
} from '@mantle/client-types/lib/event-time';
import { EventForm, eventToForm, type EventPayload } from './event-form';
import type { EventRow } from '@mantle/client-types';
import { play } from '@/lib/sounds/play';

// Wire shape is the GET /api/events mapper's output — single source of truth.
// Re-exported so the list client keeps importing it from here; drift is a
// compile error. (The canonical row also carries `timezone`, unused here.)
export type { EventRow };

const pad = (n: number) => String(n).padStart(2, '0');

/** Circular progress ring (theme-token stroke). progress 0..1. */
function Ring({ progress, children }: { progress: number; children: React.ReactNode }) {
  const C = 2 * Math.PI * 52;
  return (
    <div className="relative grid size-36 shrink-0 place-items-center">
      <svg viewBox="0 0 120 120" className="absolute size-36 -rotate-90">
        <circle
          cx="60"
          cy="60"
          r="52"
          fill="none"
          strokeWidth="7"
          style={{ stroke: 'var(--muted)' }}
        />
        <circle
          cx="60"
          cy="60"
          r="52"
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          style={{
            stroke: 'var(--primary)',
            strokeDasharray: C,
            strokeDashoffset: C * (1 - Math.min(1, Math.max(0, progress))),
            transition: 'stroke-dashoffset 1s linear',
          }}
        />
      </svg>
      <div className="text-center">{children}</div>
    </div>
  );
}

/** The live countdown hero — ring for upcoming, pulse+bar for in-progress,
 *  muted for past. Renders a static date until `now` ticks (SSR-safe). */
function Countdown({ event, now }: { event: EventRow; now: number }) {
  if (!now) {
    return (
      <div className="grid size-36 shrink-0 place-items-center rounded-full border border-border text-center">
        <span className="px-2 text-xs text-muted-foreground">{formatDateTime(event.startsAt)}</span>
      </div>
    );
  }

  const state = eventState(event.startsAt, event.endsAt, now);

  if (state === 'upcoming') {
    const p = countdownParts(event.startsAt, now);
    const underADay = p.days < 1;
    return (
      <div className="flex flex-col items-center gap-1.5">
        <Ring progress={approachProgress(event.startsAt, now)}>
          {underADay ? (
            <>
              <div className="text-2xl font-bold tabular-nums">
                {pad(p.hours)}:{pad(p.minutes)}:{pad(p.seconds)}
              </div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                to go
              </div>
            </>
          ) : (
            <>
              <div className="text-4xl font-bold tabular-nums leading-none">{p.days}</div>
              <div className="text-xs text-muted-foreground">day{p.days === 1 ? '' : 's'}</div>
              <div className="mt-1 text-xs tabular-nums text-muted-foreground">
                {p.hours}h {p.minutes}m
              </div>
            </>
          )}
        </Ring>
      </div>
    );
  }

  if (state === 'in_progress') {
    const prog = eventProgress(event.startsAt, event.endsAt, now);
    return (
      <div className="flex w-40 flex-col items-center gap-3 py-4">
        <span className="relative flex size-3">
          <span
            className="absolute inline-flex size-full animate-ping rounded-full opacity-60"
            style={{ background: 'var(--primary)' }}
          />
          <span
            className="inline-flex size-3 rounded-full"
            style={{ background: 'var(--primary)' }}
          />
        </span>
        <div className="text-lg font-semibold" style={{ color: 'var(--primary)' }}>
          Happening now
        </div>
        {event.endsAt && (
          <div className="w-full space-y-1">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full transition-[width] duration-1000"
                style={{ width: `${Math.round(prog * 100)}%`, background: 'var(--primary)' }}
              />
            </div>
            <div className="text-center text-xs text-muted-foreground">
              ends {formatRelativeShort(event.endsAt, now)}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex w-36 flex-col items-center gap-2 py-6 text-muted-foreground">
      <CalendarCheck className="size-9" aria-hidden />
      <div className="text-sm">
        Ended {formatRelativeShort(event.endsAt ?? event.startsAt, now)}
      </div>
    </div>
  );
}

/**
 * Chrome-free event detail: a live countdown hero + metadata + add-to-calendar,
 * edit, delete. Reused by the master-detail right pane and the /events/[id]
 * deep link (which adds page chrome). Mount with `key={event.id}` so selecting
 * another event resets edit state.
 */
export function EventDetail({
  event,
  onUpdated,
  onDeleted,
  editing: editingProp,
  onEditingChange,
  className,
}: {
  event: EventRow;
  /** Edit mode from the item's address (`?edit=1`); internal when absent. */
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  onUpdated?: (e: EventRow) => void;
  onDeleted?: () => void;
  /**
   * Reading width. In the master-detail pane this is empty on purpose — the
   * panel divider sets the measure, and a `max-w-*` here would stop the
   * content growing when the user drags the pane wider. The `/events/[id]`
   * deep link has no divider, so IT passes `mx-auto max-w-2xl`.
   */
  className?: string;
}) {
  const toast = useToast();
  const now = useNow(1000);
  const [meta, setMeta] = useState(event);
  const [editingState, setEditingState] = useState(false);
  const editing = editingProp ?? editingState;
  const setEditing = (on: boolean) => {
    if (onEditingChange) onEditingChange(on);
    else setEditingState(on);
  };
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const saveEdit = async (payload: EventPayload) => {
    let updated: EventRow;
    try {
      ({ event: updated } = await apiSend<{ event: EventRow }>(
        `/api/events/${meta.id}`,
        'PATCH',
        payload,
      ));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return; // already bounced to /login
      play('danger');
      toast.error(e instanceof Error ? e.message : 'Save failed');
      return;
    }
    play('success');
    setMeta(updated);
    setEditing(false);
    onUpdated?.(updated);
  };

  const confirmDelete = async () => {
    setDeleteOpen(false);
    try {
      await apiSend(`/api/events/${meta.id}`, 'DELETE');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return; // already bounced to /login
      toast.error(e instanceof Error ? e.message : 'Could not delete event');
      return;
    }
    toast.success(`Deleted “${meta.title}”`);
    startTransition(() => onDeleted?.());
  };

  const deleteDialog = (
    <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{meta.title}”?</AlertDialogTitle>
          <AlertDialogDescription>
            Any pending reminder won&apos;t fire. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={confirmDelete}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (editing) {
    return (
      // Same boxed composer as the "New event" pane (§6c) — create and edit are
      // the same form, so they get the same surface.
      // The item header (contract 2026-10-21) in edit mode: the same row as
      // the read view; the pressed pencil leaves editing. The form keeps its
      // Save and Cancel at its foot.
      <div className={className}>
        <ItemHeader
          section="Events"
          visual={<CalendarClock className="size-4 text-primary-ink" aria-hidden />}
          title={meta.title}
          badges={<HeaderPill>editing</HeaderPill>}
          access={<AccessSlot type="event" nodeId={meta.id} canShare shares={meta} />}
          onDelete={() => setDeleteOpen(true)}
          deleteLabel="Delete event"
          edit={{
            onSelect: () => setEditing(false),
            pressed: true,
            label: 'Done editing: discard unsaved',
          }}
          info={{ tags: meta.tags }}
          infoLabel="About this event"
        />
        <div className="p-6">
          <FormShell>
            <EventForm
              initial={eventToForm(meta)}
              submitLabel="Save event"
              submitting={pending}
              onSubmit={saveEdit}
              onCancel={() => setEditing(false)}
            />
          </FormShell>
        </div>
        {deleteDialog}
      </div>
    );
  }

  const ics = buildIcsHref(meta);

  return (
    <div className={className}>
      {/* The item header (contract 2026-10-21): one row; tags behind Info,
          "Add to calendar" the event's own tool. When and where are the
          event itself, so they open the content, beside the countdown. */}
      <ItemHeader
        section="Events"
        visual={<CalendarClock className="size-4 text-primary-ink" aria-hidden />}
        title={meta.title}
        access={<AccessSlot type="event" nodeId={meta.id} canShare shares={meta} />}
        tools={
          ics
            ? [
                {
                  key: 'ics',
                  label: 'Add to calendar',
                  icon: <CalendarPlus />,
                  href: ics,
                  download: `${meta.title || 'event'}.ics`,
                },
              ]
            : []
        }
        onDelete={() => setDeleteOpen(true)}
        deleteLabel="Delete event"
        move={{ kind: 'events', item: { id: meta.id, title: meta.title } }}
        edit={{ onSelect: () => setEditing(true), label: 'Edit event' }}
        info={{ tags: meta.tags }}
        infoLabel="About this event"
      />
      <div className="space-y-5 p-6">
        <div className="flex flex-col-reverse gap-5 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1 space-y-2">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="size-4 shrink-0" aria-hidden />
              <span>
                {formatDateTime(meta.startsAt)}
                {meta.endsAt && ` → ${formatDateTime(meta.endsAt)}`}
              </span>
            </p>
            {meta.location && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <MapPin className="size-4 shrink-0" aria-hidden /> {meta.location}
              </p>
            )}
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Bell className="size-3.5 shrink-0" aria-hidden />
              {meta.reminderSentAt
                ? `Reminder sent ${formatDateTime(meta.reminderSentAt)}`
                : `Reminder ${
                    meta.remindMinutesBefore === 0
                      ? 'at start'
                      : `${meta.remindMinutesBefore}m before`
                  } · fires ${formatDateTime(meta.remindAt)}`}
            </p>
            {meta.recur !== 'none' && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Repeat className="size-3.5 shrink-0" aria-hidden />
                <span className="capitalize">{meta.recur}</span>
                {meta.recurUntil && (
                  <span className="lowercase">until {formatDateTime(meta.recurUntil)}</span>
                )}
              </p>
            )}
          </div>

          <Countdown event={meta} now={now} />
        </div>

        {meta.body && (
          <pre className="whitespace-pre-wrap rounded-md border border-border bg-card p-4 font-sans text-sm">
            {meta.body}
          </pre>
        )}
        {meta.summary && (
          <p className="text-xs italic text-muted-foreground">Indexed: {meta.summary}</p>
        )}

        {deleteDialog}
      </div>
    </div>
  );
}
