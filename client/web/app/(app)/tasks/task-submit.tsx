'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { Input } from '@mantle/web-ui/ui/input';
import { Textarea } from '@mantle/web-ui/ui/textarea';
import { Field, FieldDescription, FieldError, FieldLabel } from '@mantle/web-ui/ui/field';
import { ToggleGroup, ToggleGroupItem } from '@mantle/web-ui/ui/toggle-group';
import { formatDateTime } from '@mantle/web-ui/lib/format-datetime';
import { useToast } from '@mantle/web-ui/ui/toast';
import { apiFetch, apiSend, ApiError } from '@mantle/web-ui/api-fetch';
import {
  REPLY_NOTE_MAX,
  REPLY_VERSION_MAX,
  SUBMISSION_KINDS,
  SUBMISSION_KIND_LABEL,
  checkReply,
  fromLabel,
  sendLabel,
  sentToLabel,
  submitErrorText,
  type SubmissionKind,
  type SubmissionReply,
  type SubmitTarget,
  type TaskSubmission,
} from '@/lib/task-submit';
import type { TaskRow } from './task-detail';

/**
 * Where this box can send a task (`GET /api/tasks/submit`). Its own query
 * key, outside `['tasks']`, so a task refresh does not read it again. A
 * brain before submit answers 404: no targets, so nothing to send with.
 */
export function useSubmitTargets(): SubmitTarget[] {
  const query = useQuery({
    queryKey: ['task-submit-targets'],
    queryFn: () => apiFetch<{ buttons: SubmitTarget[] }>('/api/tasks/submit'),
    retry: false,
    staleTime: 5 * 60_000,
  });
  return query.data?.buttons ?? [];
}

/** The kind picker: Bug, Feature, Request. */
export function SubmissionKindPicker({
  value,
  onChange,
}: {
  value: SubmissionKind;
  onChange: (kind: SubmissionKind) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={value}
      onValueChange={(v) => v && onChange(v as SubmissionKind)}
      aria-label="Kind"
    >
      {SUBMISSION_KINDS.map((k) => (
        <ToggleGroupItem key={k} value={k} className="px-3">
          {SUBMISSION_KIND_LABEL[k]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/**
 * The Send card on a task that was not sent: the kind, and one button per
 * target the box lists. The brain copies the task and its files; the
 * returned row replaces this one.
 */
export function TaskSendCard({
  taskId,
  targets,
  initialKind = 'bug',
  onSent,
}: {
  taskId: string;
  targets: SubmitTarget[];
  initialKind?: SubmissionKind;
  onSent: (task: TaskRow) => void;
}) {
  const toast = useToast();
  const [kind, setKind] = useState<SubmissionKind>(initialKind);
  const [sending, setSending] = useState<string | null>(null);

  const send = async (to: SubmitTarget['to']) => {
    setSending(to);
    try {
      const { task } = await apiSend<{ task: TaskRow }>(`/api/tasks/${taskId}/submit`, 'POST', {
        kind,
        to,
      });
      onSent(task);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return; // already bounced to /login
      toast.error(
        submitErrorText(
          'send',
          e instanceof ApiError ? e.status : undefined,
          e instanceof Error ? e.message : undefined,
        ),
      );
    } finally {
      setSending(null);
    }
  };

  return (
    <section
      className="space-y-3 rounded-md border border-border bg-card p-4"
      aria-labelledby="task-send-heading"
    >
      <h3 id="task-send-heading" className="text-sm font-semibold">
        Send
      </h3>
      <div className="flex flex-wrap items-center gap-2">
        <SubmissionKindPicker value={kind} onChange={setKind} />
        {targets.map((t) => (
          <Button
            key={t.to}
            type="button"
            size="sm"
            disabled={sending !== null}
            aria-busy={sending === t.to || undefined}
            onClick={() => void send(t.to)}
          >
            <Send /> {sendLabel(t.label)}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Sends a copy of this task and its files. Later changes stay here.
      </p>
    </section>
  );
}

/** The reply on a sent task and on its copy. */
function ReplyBlock({ reply }: { reply: SubmissionReply }) {
  return (
    <div className="space-y-1 rounded-md border border-border bg-muted/30 p-3" data-testid="reply">
      <p className="whitespace-pre-wrap text-sm">{reply.note}</p>
      <p className="text-xs text-muted-foreground">Version {reply.version}</p>
      <p className="text-xs text-muted-foreground">
        by {reply.by}, {formatDateTime(reply.at)}
      </p>
    </div>
  );
}

/**
 * The submission card on a task that was sent or received: where it went or
 * who sent it, and the reply once there is one. A received task with no
 * reply holds the Reply form; the brain says who may reply.
 */
export function TaskSubmissionCard({
  taskId,
  submission,
  targets,
  onReplied,
}: {
  taskId: string;
  submission: TaskSubmission;
  targets: SubmitTarget[];
  onReplied: (task: TaskRow) => void;
}) {
  const kind = SUBMISSION_KIND_LABEL[submission.kind] ?? submission.kind;
  return (
    <section
      className="space-y-2 rounded-md border border-border bg-card p-4"
      aria-labelledby="task-submission-heading"
      data-testid="task-submission"
    >
      <h3 id="task-submission-heading" className="text-sm font-semibold">
        {kind}
      </h3>
      {submission.side === 'sent' ? (
        <>
          <p className="text-sm">
            Sent to {sentToLabel(submission.to, targets)} ({formatDateTime(submission.sentAt)})
          </p>
          {submission.collectedAt && (
            <p className="text-sm text-muted-foreground">
              Collected ({formatDateTime(submission.collectedAt)})
            </p>
          )}
          {submission.reply ? (
            <ReplyBlock reply={submission.reply} />
          ) : (
            <p className="text-xs text-muted-foreground">No reply yet.</p>
          )}
        </>
      ) : (
        <>
          <p className="text-sm">{fromLabel(submission.from)}</p>
          <p className="text-xs text-muted-foreground">
            Received {formatDateTime(submission.receivedAt)}
          </p>
          {submission.reply ? (
            <ReplyBlock reply={submission.reply} />
          ) : (
            <ReplyForm taskId={taskId} onReplied={onReplied} />
          )}
        </>
      )}
    </section>
  );
}

function ReplyForm({ taskId, onReplied }: { taskId: string; onReplied: (task: TaskRow) => void }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [version, setVersion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const checked = checkReply(note, version);
    if (!checked.ok) return setError(checked.error);
    setError(null);
    setPending(true);
    try {
      const { task } = await apiSend<{ task: TaskRow }>(
        `/api/tasks/${taskId}/reply`,
        'POST',
        checked.body,
      );
      onReplied(task);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return; // already bounced to /login
      toast.error(
        submitErrorText(
          'reply',
          err instanceof ApiError ? err.status : undefined,
          err instanceof Error ? err.message : undefined,
        ),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-3 border-t border-border pt-3">
      <Field data-invalid={!!error || undefined}>
        <FieldLabel htmlFor="task-reply-note">Reply</FieldLabel>
        <Textarea
          id="task-reply-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={REPLY_NOTE_MAX}
          placeholder="What was done, or why not."
          aria-invalid={!!error || undefined}
          aria-describedby={error ? 'task-reply-error' : undefined}
        />
        <FieldError id="task-reply-error">{error}</FieldError>
      </Field>
      <Field>
        <FieldLabel htmlFor="task-reply-version">Version</FieldLabel>
        <Input
          id="task-reply-version"
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          maxLength={REPLY_VERSION_MAX}
          className="sm:max-w-48"
          aria-describedby="task-reply-version-description"
        />
        <FieldDescription id="task-reply-version-description">
          Leave empty for the version this box runs.
        </FieldDescription>
      </Field>
      <div className="flex justify-end">
        <SubmitButton size="sm" pending={pending}>
          Reply
        </SubmitButton>
      </div>
    </form>
  );
}
