'use client';

import { useState } from 'react';
import { Button } from '@mantle/web-ui/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@mantle/web-ui/ui/dialog';
import { Field, FieldLabel } from '@mantle/web-ui/ui/field';
import { Input } from '@mantle/web-ui/ui/input';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { useToast } from '@mantle/web-ui/ui/toast';
import { messengerApi } from '@/lib/messenger/api';
import type { MessengerAttachment } from '@/lib/messenger/dto';

/**
 * Save to Files (fleet chat, plan section 8): a copy of one chat file into
 * a folder of Files, as an upload by hand in my own scope (the folder
 * decides who reads it; a taken name is refused). The folder is its path,
 * `/` the top of Files. The same act as `messenger_attachment_save`.
 */
export function SaveToFilesDialog({
  file,
  onClose,
}: {
  file: MessengerAttachment;
  onClose: () => void;
}) {
  const toast = useToast();
  const [path, setPath] = useState('/');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const parentPath = path.trim() || '/';
    setBusy(true);
    try {
      const saved = await messengerApi.saveAttachment(file.id, parentPath);
      toast.success(`Saved to Files as ${saved.filename}.`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the file');
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save to Files</DialogTitle>
          <DialogDescription>
            A copy of {file.name} goes into the folder. The folder decides who can read it.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field>
            <FieldLabel htmlFor="save-to-files-path">Folder</FieldLabel>
            <Input
              id="save-to-files-path"
              value={path}
              maxLength={500}
              autoFocus
              placeholder="/Reports"
              onChange={(e) => setPath(e.target.value)}
            />
            <span className="text-xs text-muted-foreground">
              The folder path in Files. A slash alone is the top of Files.
            </span>
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <SubmitButton pending={busy}>Save</SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
