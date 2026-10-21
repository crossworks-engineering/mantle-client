'use client';

import { HeaderPill, ItemHeader } from '@/components/layout/item-header';
import { AccessSlot } from '@/components/share/access-slot';
import { useRememberLastOpened } from '@/components/last-opened/last-opened';
import { useEffect, useState } from 'react';
import {
  Download,
  Eye,
  EyeOff,
  History,
  Loader2,
  PencilLine,
  Save,
  SplitSquareHorizontal,
  X,
} from 'lucide-react';
import { describeFile, fileTypeLabel, KIND_TINT } from '@mantle/web-ui/lib/mime-label';
import { Textarea } from '@mantle/web-ui/ui/textarea';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { apiFetch, apiSend, ApiError } from '@mantle/web-ui/api-fetch';
import { useAssetUrl } from '@mantle/web-ui/hooks/use-asset-url';
import { Button } from '@mantle/web-ui/ui/button';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { Input } from '@mantle/web-ui/ui/input';
import { useToast } from '@mantle/web-ui/ui/toast';
import { useIsAdminUser } from '@/components/workspaces/use-shell-workspaces';
import { itemAccess, readOnlyNote } from '@/lib/item-access';

type FileRow = {
  id: string;
  parentPath: string;
  filename: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  isText: boolean;
  summary: string | null;
  indexing: 'full' | 'metadata' | null;
  indexingApplied: 'full' | 'metadata' | null;
  createdAt: string;
  updatedAt: string;
};

type Mode = 'edit' | 'preview' | 'split';

export function FileEditor({
  fileId,
  onClose,
  onSaved,
  onLoaded,
}: {
  fileId: string;
  onClose: () => void;
  onSaved: () => void;
  /** The file's detail, once loaded: the files screen opens its folder when
   *  the link named only the file (a /n link). */
  onLoaded?: (file: { parentPath: string }) => void;
}) {
  const toAsset = useAssetUrl();
  const toast = useToast();
  // History is a route only an Admin user may call (W6b).
  const isAdminUser = useIsAdminUser();
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'loaded'; file: FileRow; content: string }
  >({ kind: 'loading' });
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<Mode>('split');
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  // Files opens on this file next time (lib/last-opened.ts).
  useRememberLastOpened('files', state.kind === 'loaded' ? fileId : null);

  useEffect(() => {
    let cancelled = false;
    // Every login reads the file's detail and its text here, in its own
    // scope (W6b fix round, contract change 4); a file it cannot read is
    // 404. Its bytes stay on the byte route the shell maps for the login.
    async function load() {
      try {
        const body = await apiFetch<{ file: FileRow; content?: string }>(
          `/api/files/files/${fileId}`,
        );
        if (cancelled) return;
        const content = body.content ?? '';
        setState({ kind: 'loaded', file: body.file, content });
        setDraft(content);
        setDirty(false);
        onLoaded?.(body.file);
      } catch (err) {
        if (cancelled) return;
        setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // Loaded once per file, not on each list refresh: a refresh must not
    // reload the open file over unsaved edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  const save = async () => {
    if (state.kind !== 'loaded') return;
    setSaving(true);
    try {
      await apiSend(`/api/files/files/${fileId}`, 'PATCH', { content: draft });
      setDirty(false);
      toast.success('Saved');
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const submitRename = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (state.kind !== 'loaded' || !renameDraft.trim()) return;
    setSaving(true);
    try {
      const { file } = await apiSend<{ file: FileRow }>(`/api/files/files/${fileId}`, 'PATCH', {
        rename: renameDraft.trim(),
      });
      setState({ kind: 'loaded', file, content: draft });
      setRenaming(false);
      toast.success('Renamed');
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Rename failed');
    } finally {
      setSaving(false);
    }
  };

  if (state.kind === 'loading') {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-destructive-ink">{state.message}</p>
        <Button variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }

  const { file } = state;
  const toggleIndexing = async () => {
    const next =
      file.indexing === 'metadata' || file.indexingApplied === 'metadata' ? 'full' : 'metadata';
    try {
      const { file: updated } = await apiSend<{ file: FileRow }>(
        `/api/files/files/${fileId}`,
        'PATCH',
        { indexing: next },
      );
      setState((prev) => (prev.kind === 'loaded' ? { ...prev, file: updated } : prev));
      toast.success(
        next === 'metadata' ? 'Name only: its content leaves the index' : 'Content indexing queued',
      );
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not change indexing');
    }
  };
  const isMarkdown = file.extension === 'md' || file.extension === 'markdown';
  // The login's caps on the file (W6b fix round): no edit, rename or
  // indexing switch without mayEdit (never on a snapshot copy), no Grant
  // Access without mayManage. Delete is in the list.
  const access = itemAccess(file);
  const readOnly = !access.edit;
  const canEdit = access.edit;
  const note = readOnlyNote(access);
  // Without text editing the view is the preview only.
  const view: Mode = canEdit ? mode : 'preview';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* The item header (contract 2026-10-21): one row. Save is the word
          button; the view, indexing, history, download and close are the
          file's tools; the pencil renames it (the name is edited in place);
          where it lives, its type and a read-only note sit behind Info.
          Delete is in the list. */}
      <ItemHeader
        section="Files"
        visual={(() => {
          const d = describeFile(file.mimeType, file.filename);
          const Icon = d.icon;
          return <Icon aria-hidden className={`size-4 shrink-0 ${KIND_TINT[d.kind]}`} />;
        })()}
        title={
          renaming && !readOnly ? (
            <form onSubmit={submitRename} className="flex items-center gap-1.5">
              <Input
                autoFocus
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setRenaming(false)}
                aria-label="File name"
                className="h-7 w-56"
                placeholder="new-name"
              />
              <span className="text-xs font-normal text-muted-foreground">.{file.extension}</span>
              <SubmitButton pending={saving} disabled={!renameDraft.trim()} size="xs">
                Rename
              </SubmitButton>
            </form>
          ) : (
            file.filename
          )
        }
        badges={dirty ? <HeaderPill title="Save keeps your changes">unsaved</HeaderPill> : null}
        textActions={
          file.isText && canEdit ? (
            <Button size="sm" onClick={save} disabled={!dirty || saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              Save
            </Button>
          ) : null
        }
        access={<AccessSlot type="file" nodeId={file.id} canShare={access.share} shares={file} />}
        tools={[
          ...(isMarkdown && canEdit
            ? [
                {
                  key: 'view',
                  label: `View: ${mode === 'edit' ? 'Edit' : mode === 'split' ? 'Split' : 'Preview'}`,
                  icon:
                    mode === 'edit' ? (
                      <PencilLine />
                    ) : mode === 'split' ? (
                      <SplitSquareHorizontal />
                    ) : (
                      <Eye />
                    ),
                  choices: (['edit', 'split', 'preview'] as const).map((m) => ({
                    key: m,
                    label: `${m === 'edit' ? 'Edit' : m === 'split' ? 'Split' : 'Preview'}${mode === m ? ' ✓' : ''}`,
                    onSelect: () => setMode(m as Mode),
                  })),
                },
              ]
            : []),
          ...(canEdit
            ? [
                {
                  // Per-file brain-indexing override: one click flips between
                  // content-indexed and name-only; the folder's mode is
                  // restored from the files screen ('inherit' lives there).
                  key: 'indexing',
                  label:
                    file.indexing === 'metadata' || file.indexingApplied === 'metadata'
                      ? 'Name only: content not indexed. Click to index content.'
                      : 'Indexed: click for name only (store and share without indexing)',
                  icon:
                    file.indexing === 'metadata' || file.indexingApplied === 'metadata' ? (
                      <EyeOff />
                    ) : (
                      <Eye />
                    ),
                  onSelect: () => void toggleIndexing(),
                },
              ]
            : []),
          ...(isAdminUser
            ? [
                {
                  // Every trace that touched this file (ingest, extractor, …).
                  key: 'history',
                  label: 'History: what the system did with this file',
                  icon: <History />,
                  href: `/nodes/${file.id}/history`,
                },
              ]
            : []),
          {
            key: 'download',
            label: 'Download',
            icon: <Download />,
            href: toAsset(`/api/files/files/${file.id}?raw=1`),
            download: file.filename,
          },
          {
            key: 'close',
            label: 'Close the file',
            icon: <X />,
            onSelect: onClose,
          },
        ]}
        edit={
          readOnly
            ? { disabled: true, label: 'Rename file' }
            : {
                label: 'Rename file',
                pressed: renaming,
                onSelect: () => {
                  if (renaming) return setRenaming(false);
                  const stem =
                    file.filename.lastIndexOf('.') > 0
                      ? file.filename.slice(0, file.filename.lastIndexOf('.'))
                      : file.filename;
                  setRenameDraft(stem);
                  setRenaming(true);
                },
              }
        }
        info={{
          path: file.parentPath.split('.').filter(Boolean),
          rows: [
            { label: 'Type', value: fileTypeLabel(file.mimeType, file.filename) },
            ...(note ? [{ label: 'Access', value: note }] : []),
          ],
        }}
        infoLabel="About this file"
      />

      {/* Body */}
      {file.isText && !canEdit && !isMarkdown ? (
        <pre className="flex-1 overflow-auto scrollbar-thin whitespace-pre-wrap p-4 font-mono text-sm">
          {draft}
        </pre>
      ) : file.isText ? (
        <div className="flex flex-1 overflow-hidden">
          {(view === 'edit' || view === 'split' || !isMarkdown) && (
            <Textarea
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setDirty(e.target.value !== state.content);
              }}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                  e.preventDefault();
                  void save();
                }
              }}
              className={
                // The kit supplies the ring, the placeholder and scrollbar-thin;
                // the overrides are this pane's own: no border (the pane has
                // one), full height, and an INSET ring so it cannot overflow.
                'h-full min-h-0 resize-none rounded-none border-0 bg-background p-4 font-mono text-sm focus-visible:ring-inset focus-visible:ring-offset-0 ' +
                (view === 'split' && isMarkdown ? 'w-1/2 border-r border-border' : 'flex-1')
              }
              spellCheck={file.extension !== 'json'}
            />
          )}
          {isMarkdown && (view === 'preview' || view === 'split') && (
            <article
              className={
                'h-full overflow-y-auto p-6 prose prose-sm dark:prose-invert max-w-none ' +
                (view === 'split' ? 'w-1/2' : 'flex-1')
              }
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft}</ReactMarkdown>
            </article>
          )}
        </div>
      ) : (
        <FilePreviewBody file={file} />
      )}
    </div>
  );
}

/**
 * Inline preview for non-text files. Images (incl. SVG logos), PDFs, video, and
 * audio render from the raw asset route (served `content-disposition: inline`);
 * everything else falls back to a download card. SVG renders via `<img>`, which
 * never executes embedded scripts, so it's safe to show.
 */
function FilePreviewBody({ file }: { file: FileRow }) {
  const src = useAssetUrl()(`/api/files/files/${file.id}?raw=1`);
  const mime = file.mimeType || '';
  const isImage = mime.startsWith('image/');
  const isPdf = mime === 'application/pdf';
  const isVideo = mime.startsWith('video/');
  const isAudio = mime.startsWith('audio/');

  if (isImage) {
    return (
      // Muted backdrop so transparent logos (PNG/SVG) read clearly.
      <div className="flex flex-1 items-center justify-center overflow-auto scrollbar-thin bg-muted/20 p-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={file.filename}
          className="max-h-full max-w-full rounded-md border border-border object-contain"
        />
      </div>
    );
  }
  if (isPdf) {
    return <iframe src={src} title={file.filename} className="w-full flex-1 border-0" />;
  }
  if (isVideo) {
    return (
      // A viewer backdrop, not a surface: black is what makes an image or video
      // read as itself rather than tinted by whichever of the ~40 themes is on.
      // Neutral on purpose, so no token applies.
      // eslint-disable-next-line house/no-palette-literal
      <div className="flex flex-1 items-center justify-center bg-black p-6">
        <video src={src} controls className="max-h-full max-w-full" />
      </div>
    );
  }
  if (isAudio) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
        <audio src={src} controls className="w-full max-w-xl" />
        {file.summary && (
          <p className="max-w-md text-center text-xs italic text-muted-foreground">
            {file.summary}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground">
      <p>Preview not available for this file type.</p>
      <Button asChild size="sm">
        <a href={src} download={file.filename}>
          <Download /> Download {file.filename}
        </a>
      </Button>
      {file.summary && <p className="max-w-md text-center text-xs italic">{file.summary}</p>}
    </div>
  );
}
