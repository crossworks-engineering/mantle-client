'use client';

import { AccessSlot } from '@/components/share/access-slot';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Archive, ArchiveRestore, Check, Flag } from 'lucide-react';
import { FormShell } from '@mantle/web-ui/ui/form-shell';
import { RowButton } from '@mantle/web-ui/ui/row-button';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@mantle/web-ui/ui/select';
import { cn } from '@mantle/web-ui/lib/utils';
import { formatDateTime } from '@mantle/web-ui/lib/format-datetime';
import { NO_IMAGES } from '@mantle/web-ui/no-images';
import { HeaderPill, ItemHeader } from '@/components/layout/item-header';
import { TaskForm, taskToForm, type TaskPayload } from './task-form';
import { PRIORITY_BADGE, STATUSES, STATUS_BADGE, STATUS_LABEL, type Status } from './task-meta';
import { TaskTodos } from './task-todos';
import type { TaskRow as WireTaskRow, TaskTodo } from '@mantle/client-types';

// Wire shape is the GET /api/tasks mapper's output — single source of truth.
// Re-exported so the list client keeps importing it from here; a drift between
// the @mantle/content row and what this screen renders is now a compile error.
// `statusBeforeDone` (the status a reopen restores) is optional in the brain's
// contract but newer than the pinned one: drop the widening at the pin bump.
export type TaskRow = WireTaskRow & { statusBeforeDone?: Status | null };
export type { Status };

/** A partial task write (status move, todos edit) — subset of the form payload. */
export type TaskPatch = Partial<TaskPayload> & {
  todos?: TaskTodo[];
  /** File the task away (or restore it). The server stamps `archivedAt`. */
  archived?: boolean;
  /** Take a done task back to the status it had before done. The brain
   *  remembers that status; an explicit `status` in the same patch wins. */
  reopen?: boolean;
};

/**
 * Presentational task detail — the client owns the tasks list + all fetches and
 * passes the fresh row + callbacks, so a status toggle from the list card and an
 * edit here stay in sync. Manages only its own edit-mode flag.
 */
export function TaskDetail({
  task,
  onToggleStatus,
  onSave,
  onPatch,
  onDelete,
  editing: editingProp,
  onEditingChange,
}: {
  task: TaskRow;
  /** Edit mode from the task's address (`?edit=1`); internal when absent. */
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  onToggleStatus: () => void;
  onSave: (payload: TaskPayload) => Promise<boolean>;
  onPatch: (patch: TaskPatch) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [editingState, setEditingState] = useState(false);
  const editing = editingProp ?? editingState;
  const setEditing = (on: boolean) => {
    if (onEditingChange) onEditingChange(on);
    else setEditingState(on);
  };
  const [deleteOpen, setDeleteOpen] = useState(false);
  const done = task.status === 'done';
  const archived = !!task.archivedAt;
  const overdue = !!task.dueAt && new Date(task.dueAt) < new Date() && !done;

  const deleteDialog = (
    <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{task.title}”?</AlertDialogTitle>
          <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => {
              setDeleteOpen(false);
              onDelete();
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (editing) {
    return (
      // Same boxed composer as the "New task" pane — create and edit are the
      // same form, so they get the same surface. Width comes from the panel
      // divider, not a `max-w-*` here.
      // The item header (contract 2026-10-21) in edit mode: the same row as
      // the read view; the pressed pencil leaves editing. The form keeps its
      // Save and Cancel at its foot.
      <div>
        <ItemHeader
          section="Tasks"
          title={task.title}
          badges={<HeaderPill>editing</HeaderPill>}
          access={<AccessSlot type="task" nodeId={task.id} canShare shares={task} />}
          onDelete={() => setDeleteOpen(true)}
          deleteLabel="Delete task"
          edit={{
            onSelect: () => setEditing(false),
            pressed: true,
            label: 'Done editing: discard unsaved',
          }}
          info={{ tags: task.tags }}
          infoLabel="About this task"
        />
        <div className="p-6">
          <FormShell>
            <TaskForm
              initial={taskToForm(task)}
              submitLabel="Save task"
              onSubmit={async (payload) => {
                if (await onSave(payload)) setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          </FormShell>
        </div>
        {deleteDialog}
      </div>
    );
  }

  return (
    // Fills the panel, like the composer: the divider sets the reading width,
    // so reading a task and editing it occupy the same column. No card wrapper
    // here, unlike the composer — the body and checklist below are
    // already cards, and boxing them again just nests borders.
    <div>
      <div>
        {/* The item header (contract 2026-10-21): one row. The done box leads,
            a sibling of the `h2` (a control nested in a heading would join its
            accessible name). The status is the one state pill, still a
            picker; priority, due date and tags sit behind Info. Archive is
            the task's own tool: the reversible way to put finished work away. */}
        <ItemHeader
          section="Tasks"
          lead={
            <RowButton
              onClick={onToggleStatus}
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-md border transition-colors',
                done
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input hover:bg-muted',
              )}
              aria-label={done ? 'Mark not done' : 'Mark done'}
              aria-pressed={done}
            >
              {done && <Check className="size-4" />}
            </RowButton>
          }
          title={
            <span className={cn(done && 'text-muted-foreground line-through')}>{task.title}</span>
          }
          badges={
            <Select
              value={task.status}
              onValueChange={(status) => void onPatch({ status: status as Status })}
            >
              {/* A status PILL, not a field: rounded-full, no border, and it
                  carries the badge colour. */}
              <SelectTrigger
                aria-label="Status"
                className={cn(
                  'h-6 w-auto shrink-0 gap-1.5 rounded-full border-0 px-2.5 text-[11px] font-medium',
                  STATUS_BADGE[task.status],
                )}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
          access={<AccessSlot type="task" nodeId={task.id} canShare shares={task} />}
          tools={[
            {
              key: 'archive',
              label: archived ? 'Restore from archive' : 'Archive',
              icon: archived ? <ArchiveRestore /> : <Archive />,
              onSelect: () => void onPatch({ archived: !archived }),
            },
          ]}
          onDelete={() => setDeleteOpen(true)}
          deleteLabel="Delete task"
          move={{ kind: 'tasks', item: { id: task.id, title: task.title } }}
          edit={{ onSelect: () => setEditing(true), label: 'Edit task' }}
          info={{
            tags: task.tags,
            rows: [
              {
                label: 'Priority',
                value: (
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5',
                      PRIORITY_BADGE[task.priority],
                    )}
                  >
                    <Flag className="size-3" /> {task.priority}
                  </span>
                ),
              },
              ...(task.dueAt
                ? [
                    {
                      label: 'Due',
                      value: (
                        <span className={cn(overdue && 'font-medium text-destructive-ink')}>
                          {formatDateTime(task.dueAt)}
                          {overdue && ' · overdue'}
                        </span>
                      ),
                    },
                  ]
                : []),
            ],
          }}
          infoLabel="About this task"
        />
        <div className="space-y-4 p-6">
          {/* No picture loads from a body: a request's task holds a client's
            or a member's words (client tier audit U5). */}
          {task.body && (
            <article className="prose prose-sm dark:prose-invert max-w-none prose-accent rounded-md border border-border bg-card p-4">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={NO_IMAGES}>
                {task.body}
              </ReactMarkdown>
            </article>
          )}

          <TaskTodos todos={task.todos} onChange={(todos) => void onPatch({ todos })} />

          {task.summary && (
            <p className="text-xs italic text-muted-foreground">Indexed: {task.summary}</p>
          )}

          {deleteDialog}
        </div>
      </div>
    </div>
  );
}
