'use client';

/**
 * The Files screen's dialogs: rename, create folder, create file.
 *
 * Moved out of files-client.tsx unchanged (structure pass, phase 1):
 * already standalone, just living in the wrong file. No signatures changed.
 */
import { useEffect, useState } from 'react';
import { ApiError, apiSend } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { Input } from '@mantle/web-ui/ui/input';
import { Label } from '@mantle/web-ui/ui/label';
import { Textarea } from '@mantle/web-ui/ui/textarea';
import { useToast } from '@mantle/web-ui/ui/toast';
import { ToggleGroup, ToggleGroupItem } from '@mantle/web-ui/ui/toggle-group';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@mantle/web-ui/ui/dialog';
import { useIsAdminUser } from '@/components/workspaces/use-shell-workspaces';
import { visibilityRefusal } from '@/components/item-tree/sharing';
import {
  VisibilityConfirmDialog,
  type PendingConfirm,
} from '@/components/item-tree/visibility-confirm';
import { defaultBodyFor, slugify } from './files-shared';
import type { FileRow, RenameTarget, TextExt } from './files-shared';
import { play } from '@/lib/sounds/play';

// ─── Rename file / folder dialog ───────────────────────────────────
export function RenameDialog({
  target,
  onOpenChange,
  onRenamed,
}: {
  target: RenameTarget | null;
  onOpenChange: (open: boolean) => void;
  onRenamed: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!target) return;
    setBusy(false);
    if (target.kind === 'file') {
      const suffix = target.extension ? `.${target.extension}` : '';
      setName(
        suffix && target.filename.endsWith(suffix)
          ? target.filename.slice(0, -suffix.length)
          : target.filename,
      );
    } else {
      setName(target.slug);
    }
  }, [target]);

  if (!target) return null;
  const isFile = target.kind === 'file';
  const valid = name.trim().length > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    const url = isFile ? `/api/files/files/${target.id}` : `/api/files/folders/${target.id}`;
    try {
      await apiSend(url, 'PATCH', { rename: name.trim() });
    } catch (err) {
      play('danger');
      toast.error(err instanceof ApiError ? err.message : 'Rename failed');
      return;
    } finally {
      setBusy(false);
    }
    play('success');
    toast.success('Renamed');
    onRenamed();
    onOpenChange(false);
  };

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onOpenChange(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename {isFile ? 'file' : 'folder'}</DialogTitle>
          <DialogDescription>
            {isFile
              ? 'The extension is kept — only the name changes.'
              : 'Every file and sub-folder inside moves with it.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rename-input">New name</Label>
            <div className="flex items-center gap-1">
              <Input
                id="rename-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
              {isFile && target.extension && (
                <span className="shrink-0 text-sm text-muted-foreground">.{target.extension}</span>
              )}
            </div>
            {!isFile && name.trim() && (
              <p className="text-xs text-muted-foreground">
                Saved as <code className="font-mono">{slugify(name)}</code>
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <SubmitButton pending={busy} disabled={!valid}>
              Rename {isFile ? 'file' : 'folder'}
            </SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Create folder dialog ──────────────────────────────────────────

// ─── Create folder dialog ──────────────────────────────────────────
export function CreateFolderDialog({
  open,
  onOpenChange,
  parentPath,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentPath: string;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setDescription('');
      setBusy(false);
    }
  }, [open]);

  const slug = slugify(name);
  const valid = slug.length > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    try {
      await apiSend('/api/files/folders', 'POST', { parentPath, slug, description });
    } catch (err) {
      play('danger');
      toast.error(err instanceof ApiError ? err.message : 'Could not create folder');
      setBusy(false);
      return;
    }
    play('success');
    toast.success(`Created folder “${slug}”`);
    onOpenChange(false);
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New folder</DialogTitle>
          <DialogDescription>
            Created inside <code className="font-mono">{parentPath}</code>.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="folder-name">Name</Label>
            <Input
              id="folder-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-folder"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Saved as <code className="font-mono">{slug || '…'}</code> — lowercase, dashes only.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="folder-desc">
              Description <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="folder-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What lives in this folder?"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <SubmitButton pending={busy} disabled={!valid}>
              Create folder
            </SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Create file dialog ────────────────────────────────────────────

// ─── Create file dialog ────────────────────────────────────────────
export function CreateFileDialog({
  ext,
  onOpenChange,
  parentPath,
  onCreated,
}: {
  ext: TextExt | null;
  onOpenChange: (open: boolean) => void;
  parentPath: string;
  onCreated: (fileId: string) => void;
}) {
  const toast = useToast();
  // A file's text is read and edited on a route only an Admin user may call
  // (W6b): any other login gets the file, not its editor.
  const isAdminUser = useIsAdminUser();
  const open = ext !== null;
  const [stem, setStem] = useState('');
  const [type, setType] = useState<TextExt>('md');
  const [busy, setBusy] = useState(false);
  // The brain's 409 `visibility`: the folder is shared, so the new file is
  // read by the team or clients at once. Asked, then created with `confirm`.
  const [exposed, setExposed] = useState<PendingConfirm | null>(null);

  useEffect(() => {
    if (ext) {
      setStem('');
      setType(ext);
      setBusy(false);
    }
  }, [ext]);

  const cleanStem = stem.trim().replace(/\.[^.]*$/, '');
  const valid = cleanStem.length > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    await create(false);
  };

  const create = async (confirm: boolean) => {
    setBusy(true);
    const filename = `${cleanStem}.${type}`;
    let file: FileRow;
    try {
      ({ file } = await apiSend<{ file: FileRow }>('/api/files/files', 'POST', {
        parentPath,
        filename,
        content: defaultBodyFor(type),
        ...(confirm ? { confirm: true } : {}),
      }));
    } catch (err) {
      const refusal = visibilityRefusal(err);
      if (refusal) {
        setExposed({
          refusal,
          action: `Create “${filename}” in ${parentPath}.`,
          note: 'A file in this folder takes the folder’s workspaces.',
          verb: 'Create file',
          run: () => void create(true),
        });
      } else {
        play('danger');
        toast.error(err instanceof ApiError ? err.message : 'Could not create file');
      }
      setBusy(false);
      return;
    }
    play('success');
    toast.success(`Created ${file.filename}`);
    onOpenChange(false);
    onCreated(file.id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New file</DialogTitle>
          <DialogDescription>
            Created inside <code className="font-mono">{parentPath}</code>
            {isAdminUser ? ' and opened for editing.' : '.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={type}
              onValueChange={(v) => v && setType(v as TextExt)}
            >
              <ToggleGroupItem value="md">Markdown</ToggleGroupItem>
              <ToggleGroupItem value="txt">Text</ToggleGroupItem>
              <ToggleGroupItem value="json">JSON</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="file-stem">Filename</Label>
            <div className="flex items-center gap-2">
              <Input
                id="file-stem"
                value={stem}
                onChange={(e) => setStem(e.target.value)}
                placeholder="untitled"
                autoFocus
              />
              <span className="shrink-0 text-sm text-muted-foreground">.{type}</span>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <SubmitButton pending={busy} disabled={!valid}>
              Create file
            </SubmitButton>
          </div>
        </form>
        <VisibilityConfirmDialog pending={exposed} onOpenChange={(o) => !o && setExposed(null)} />
      </DialogContent>
    </Dialog>
  );
}
