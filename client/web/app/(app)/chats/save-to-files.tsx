'use client';

import { useToast } from '@mantle/web-ui/ui/toast';
import { FolderPickerDialog } from '@/components/item-tree/folder-picker';
import { filesAdapter } from '@/components/item-tree/kinds/files';
import { messengerApi } from '@/lib/messenger/api';
import type { MessengerAttachment } from '@/lib/messenger/dto';
import { FILES_ROOT } from '@/app/(app)/files/files-shared';

/**
 * Save to Files (fleet chat, plan section 8): a copy of one chat file into
 * a folder of Files, picked in the Files tree (the same picker as Move), as
 * an upload by hand in my own scope (the folder decides who reads it; a
 * taken name is refused). The same act as `messenger_attachment_save`.
 */
export function SaveToFilesDialog({
  file,
  onClose,
}: {
  file: MessengerAttachment;
  onClose: () => void;
}) {
  const toast = useToast();
  const save = async (parentPath: string) => {
    try {
      const saved = await messengerApi.saveAttachment(file.id, parentPath);
      toast.success(`Saved to Files as ${saved.filename}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the file');
    }
  };
  return (
    <FolderPickerDialog
      kind="files"
      adapter={filesAdapter}
      sort="name"
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Save “${file.name}” to…`}
      description="A copy goes into the folder. The folder decides who can read it."
      rootLabel="All files"
      pickLabel="Save here"
      onPick={(folder) => void save(folder?.path ?? FILES_ROOT)}
    />
  );
}
