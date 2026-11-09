'use client';

import { useCallback, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Paperclip, X } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { useToast } from '@mantle/web-ui/ui/toast';
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
import { apiFetch, apiSend, ApiError } from '@mantle/web-ui/api-fetch';
import { useAssetUrl } from '@mantle/web-ui/hooks/use-asset-url';
import { KIND_TINT, describeFile } from '@mantle/web-ui/lib/mime-label';
import type { TaskRow } from '@mantle/client-types';
import { formatBytes } from '@/lib/upload-progress';
import {
  TASK_FILE_ACCEPT,
  TASK_FILE_MAX_BYTES,
  TASK_FILES_MAX,
  checkTaskUploads,
  taskFileName,
  type TaskFile,
} from '@/lib/task-files';

/** The one-task read, which alone carries `files` (a list never does).
 *  Absent on a brain before files on tasks: no files, the button stays. */
type TaskWithFiles = TaskRow & { files?: TaskFile[] };

const filePath = (taskId: string, fileId: string) => `/api/tasks/${taskId}/files/${fileId}`;

/**
 * A task's files and the two writes on them. The files come from the
 * one-task read under the same query key the tasks screen already uses for
 * it (`['tasks', id]`), so its realtime refresh repaints them too. Uploads
 * go one at a time, and the task is read again after each.
 */
export function useTaskFiles(taskId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const query = useQuery({
    queryKey: ['tasks', taskId],
    queryFn: () => apiFetch<{ task: TaskWithFiles }>(`/api/tasks/${taskId}`).then((r) => r.task),
  });
  const files: TaskFile[] = (query.data as TaskWithFiles | undefined)?.files ?? [];
  const [uploading, setUploading] = useState<string | null>(null);
  // A drop while a batch is still going waits its turn, so the count each
  // batch is checked against is the one the brain holds.
  const chain = useRef<Promise<void>>(Promise.resolve());

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['tasks', taskId], exact: true }),
    [queryClient, taskId],
  );

  const runBatch = useCallback(
    async (picked: File[]) => {
      const held = queryClient.getQueryData<TaskWithFiles>(['tasks', taskId])?.files?.length ?? 0;
      const { accepted, refused } = checkTaskUploads(picked, held);
      for (const reason of refused) toast.error(reason);
      for (const f of accepted) {
        const name = taskFileName(f);
        const file = name === f.name ? f : new File([f], name, { type: f.type });
        const body = new FormData();
        body.append('file', file, name);
        setUploading(name);
        try {
          // FormData body: apiFetch, not apiSend, so the browser sets the
          // multipart boundary.
          await apiFetch<{ file: TaskFile }>(`/api/tasks/${taskId}/files`, {
            method: 'POST',
            body,
          });
        } catch (e) {
          setUploading(null);
          if (e instanceof ApiError && e.status === 401) return; // already bounced to /login
          toast.error(
            e instanceof ApiError && e.status === 413
              ? `${name} is over the ${formatBytes(TASK_FILE_MAX_BYTES)} limit for a task file.`
              : e instanceof Error
                ? e.message
                : `Could not add ${name}`,
          );
          return;
        }
        await refresh();
      }
      setUploading(null);
    },
    [queryClient, taskId, toast, refresh],
  );

  const upload = useCallback(
    (picked: File[]) => {
      if (picked.length === 0) return;
      chain.current = chain.current.then(() => runBatch(picked));
    },
    [runBatch],
  );

  const remove = useCallback(
    async (fileId: string) => {
      try {
        await apiSend(filePath(taskId, fileId), 'DELETE');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return;
        toast.error(e instanceof Error ? e.message : 'Could not remove the file');
        return;
      }
      await refresh();
    },
    [taskId, toast, refresh],
  );

  return { files, uploading, upload, remove };
}

/**
 * The Files card under the task's body: pictures as small thumbnails, other
 * files as chips, each opening its bytes in a new tab. Attach, and a remove
 * on each file with the confirm every delete has. The task detail shows the
 * same Edit to everyone who opens it, so these show with it; the brain
 * holds the line (who edits the task adds and removes).
 */
export function TaskFilesCard({
  taskId,
  files,
  uploading,
  onUpload,
  onRemove,
}: {
  taskId: string;
  files: TaskFile[];
  uploading: string | null;
  onUpload: (files: File[]) => void;
  onRemove: (fileId: string) => void;
}) {
  const toAsset = useAssetUrl();
  const inputRef = useRef<HTMLInputElement>(null);
  const [removing, setRemoving] = useState<TaskFile | null>(null);
  const full = files.length >= TASK_FILES_MAX;

  return (
    <section className="space-y-2 rounded-md border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Files</h3>
        <div className="flex items-center gap-2">
          {files.length > 0 && (
            <span className="text-xs tabular-nums text-muted-foreground">
              {files.length} of {TASK_FILES_MAX}
            </span>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={full || uploading !== null}
            title={full ? `A task holds ${TASK_FILES_MAX} files.` : undefined}
            onClick={() => inputRef.current?.click()}
          >
            <Paperclip /> Attach
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept={TASK_FILE_ACCEPT}
            multiple
            className="hidden"
            aria-hidden
            tabIndex={-1}
            onChange={(e) => {
              onUpload(Array.from(e.target.files ?? []));
              // Reset so picking the same file again still fires onChange.
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {files.length === 0 && !uploading ? (
        <p className="text-xs text-muted-foreground">
          Drop, paste or attach a screenshot, log or PDF. Up to {TASK_FILES_MAX} files,{' '}
          {formatBytes(TASK_FILE_MAX_BYTES)} each.
        </p>
      ) : (
        <ul className="flex flex-wrap items-start gap-2">
          {files.map((f) => (
            <TaskFileItem
              key={f.id}
              file={f}
              href={toAsset(filePath(taskId, f.id))}
              thumb={toAsset(`${filePath(taskId, f.id)}?thumb=1`)}
              onRemove={() => setRemoving(f)}
            />
          ))}
        </ul>
      )}

      {uploading && (
        <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner className="size-3.5" /> Adding {uploading}…
        </p>
      )}

      <AlertDialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{removing?.filename}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The file is deleted from the task. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const target = removing;
                setRemoving(null);
                if (target) onRemove(target.id);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/** One file: a thumbnail for a picture (a chip again if the thumbnail
 *  cannot load), a chip for anything else. Both open the bytes. */
function TaskFileItem({
  file,
  href,
  thumb,
  onRemove,
}: {
  file: TaskFile;
  href: string;
  thumb: string;
  onRemove: () => void;
}) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const described = describeFile(file.mimeType, file.filename);
  const TypeIcon = described.icon;
  const label = `${file.filename}, ${formatBytes(file.sizeBytes)}`;
  const removeButton = (
    <Button
      type="button"
      variant="ghost"
      size="icon-2xs"
      onClick={onRemove}
      aria-label={`Remove ${file.filename}`}
      title="Remove"
    >
      <X />
    </Button>
  );

  if (file.mimeType.startsWith('image/') && !thumbFailed) {
    return (
      <li className="relative" data-testid="task-file">
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          title={label}
          className="block size-20 overflow-hidden rounded-md border border-border bg-muted/40 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- authed thumbnail; next/image can't carry the asset token */}
          <img
            src={thumb}
            alt={file.filename}
            loading="lazy"
            className="h-full w-full object-cover"
            onError={() => setThumbFailed(true)}
          />
        </a>
        <span className="absolute right-0.5 top-0.5 rounded-md bg-background/80">
          {removeButton}
        </span>
      </li>
    );
  }

  return (
    <li
      className="flex h-8 max-w-full items-center gap-1 rounded-full border border-border pl-2.5 pr-1 text-xs"
      data-testid="task-file"
    >
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={label}
        className="flex min-w-0 items-center gap-1.5 rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <TypeIcon aria-hidden className={`size-3.5 shrink-0 ${KIND_TINT[described.kind]}`} />
        <span className="max-w-48 truncate">{file.filename}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {formatBytes(file.sizeBytes)}
        </span>
      </a>
      {removeButton}
    </li>
  );
}
