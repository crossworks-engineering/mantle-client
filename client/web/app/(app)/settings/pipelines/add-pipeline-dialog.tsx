'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FolderOpen } from 'lucide-react';
import { apiSend } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@mantle/web-ui/ui/dialog';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { useToast } from '@mantle/web-ui/ui/toast';
import {
  INSTALL_LINE,
  PIPELINES_PATH,
  addRefusedText,
  readPackage,
  readsText,
  replacesText,
  sizeText,
  type PackageRead,
  type PickedFile,
  type PipelineInstallAnswer,
  type PipelineRowV1,
} from '@/lib/pipelines';

/** The files of a folder pick, each read as bytes; a file the browser
 *  cannot read is kept with null, so the dialog says it. */
async function pickedFiles(list: FileList): Promise<PickedFile[]> {
  return Promise.all(
    Array.from(list).map(async (file) => ({
      path: file.webkitRelativePath || file.name,
      bytes: await file.arrayBuffer().then(
        (b) => new Uint8Array(b),
        () => null,
      ),
    })),
  );
}

/**
 * Add a pipeline: pick its folder, see what it is, install it. The client
 * reads the files into the package (text as text, any other as base64) and
 * says a file it could not read, or a folder over the caps, before the
 * send. The brain checks the package; a refusal shows its own sentence.
 * Nothing of the package is run or shown as HTML here.
 */
export function AddPipelineDialog({
  open,
  onOpenChange,
  rows,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The list's rows: an own one of the same id is replaced. */
  rows: readonly PipelineRowV1[];
  onAdded: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [read, setRead] = useState<PackageRead | null>(null);
  const [reading, setReading] = useState(false);
  const install = useMutation({
    mutationFn: (r: PackageRead) => apiSend<PipelineInstallAnswer>(PIPELINES_PATH, 'POST', r.pkg),
    onSuccess: async (answer, r) => {
      const id = answer.row?.id ?? r.manifest?.id ?? '';
      await queryClient.invalidateQueries({ queryKey: [PIPELINES_PATH] });
      toast.success(answer.note);
      onAdded(id);
      close(false);
    },
  });

  function close(o: boolean) {
    if (!o) {
      setRead(null);
      install.reset();
    }
    onOpenChange(o);
  }

  const onPick = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    install.reset();
    setReading(true);
    try {
      setRead(readPackage(await pickedFiles(list)));
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const m = read?.manifest ?? null;
  const replaces = m ? replacesText(rows, m) : null;
  const blocked = !read || read.problems.length > 0;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a pipeline</DialogTitle>
          <DialogDescription>
            Pick the folder of its package, with pipeline.json at its top.
          </DialogDescription>
        </DialogHeader>
        <input
          ref={(el) => {
            // Not a React prop: the folder picker is a DOM attribute.
            el?.setAttribute('webkitdirectory', '');
            inputRef.current = el;
          }}
          type="file"
          multiple
          hidden
          aria-label="Package folder"
          data-testid="pipeline-folder-input"
          onChange={(e) => void onPick(e.target.files)}
        />
        <div className="space-y-4 text-sm">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={reading || install.isPending}
            onClick={() => inputRef.current?.click()}
          >
            {reading ? <Spinner size={14} label="Reading" /> : <FolderOpen />}
            {read ? 'Pick another folder' : 'Pick a folder'}
          </Button>
          {read && (
            <section aria-label="Package" className="space-y-3">
              {m && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
                  <dt className="text-muted-foreground">Name</dt>
                  <dd>{m.name || '-'}</dd>
                  <dt className="text-muted-foreground">Version</dt>
                  <dd className="font-mono text-xs leading-5">{m.version || '-'}</dd>
                  <dt className="text-muted-foreground">Reads</dt>
                  <dd>{m.reads.length > 0 ? readsText(m.reads) : '-'}</dd>
                  <dt className="text-muted-foreground">Role</dt>
                  <dd>{m.role}</dd>
                </dl>
              )}
              <p className="text-muted-foreground">
                {read.count === 1 ? '1 file' : `${read.count} files`}, {sizeText(read.bytes)}
                {read.leftOut.length > 0 && `. Left out: ${read.leftOut.join(', ')}`}
              </p>
              {read.problems.map((p) => (
                <p key={p} className="text-destructive-ink">
                  {p}
                </p>
              ))}
              {replaces && <p className="font-medium">{replaces}</p>}
              <p>{INSTALL_LINE}</p>
            </section>
          )}
          {install.isError && (
            <p role="alert" className="text-destructive-ink">
              {addRefusedText(install.error)}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={blocked || install.isPending}
            onClick={() => read && install.mutate(read)}
          >
            {install.isPending && <Spinner size={14} label="Installing" />}
            Install
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
