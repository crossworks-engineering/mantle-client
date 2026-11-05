'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@mantle/web-ui/ui/dialog';
import { Field, FieldError, FieldGroup, FieldLabel } from '@mantle/web-ui/ui/field';
import type { TableDetail } from '@mantle/content-core/table-model';
import { UploadProgressBar } from '@/components/uploads/upload-provider';
import {
  TABLE_IMPORT_ACCEPT,
  importTable,
  tableImportError,
  tableImportRefusal,
} from '@/lib/table-import';
import { aggregateProgress, formatBytes, progressTicker } from '@/lib/upload-progress';
import { UploadAbortedError } from '@/lib/xhr-upload';

type Sent = { loaded: number; total: number; rate: number | null };

/**
 * Pick a spreadsheet, send it, get a new table. While the bytes go out Cancel
 * stops them. Once they are all sent the brain is building the table and it
 * will land whatever this dialog does, so the dialog stays until it answers.
 */
export function TableImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (table: TableDetail) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);
  const pickerRef = useRef<HTMLInputElement | null>(null);
  const sending = useRef<AbortController | null>(null);

  // Leaving the screen stops an upload nobody is watching.
  useEffect(() => () => sending.current?.abort(), []);

  const building = busy && sent !== null && sent.loaded >= sent.total;

  const close = () => {
    sending.current?.abort();
    sending.current = null;
    setFile(null);
    setError(null);
    setBusy(false);
    setSent(null);
    onOpenChange(false);
  };

  const pick = (picked: File | undefined) => {
    if (!picked) return;
    const refusal = tableImportRefusal(picked);
    setError(refusal);
    setFile(refusal ? null : picked);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file || busy) return;
    const controller = new AbortController();
    sending.current = controller;
    setBusy(true);
    setError(null);
    setSent(null);
    let total = 0;
    const tick = progressTicker((loaded, rate) => setSent({ loaded, total, rate }));
    try {
      const table = await importTable(file, {
        signal: controller.signal,
        onProgress: (loaded, size) => {
          total = size;
          tick(loaded, size);
        },
      });
      sending.current = null;
      close();
      onImported(table);
    } catch (err) {
      if (err instanceof UploadAbortedError) return; // Cancel: already closed.
      sending.current = null;
      setBusy(false);
      setSent(null);
      setError(tableImportError(err));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else if (!building) close();
      }}
    >
      <DialogContent className="sm:max-w-md" hideClose={building}>
        <DialogHeader>
          <DialogTitle>Import a table</DialogTitle>
          <DialogDescription>
            A spreadsheet becomes a new table, with each sheet as a tab. It takes xlsx, xls or csv.
          </DialogDescription>
        </DialogHeader>
        <input
          ref={pickerRef}
          id="table-import-file"
          type="file"
          accept={TABLE_IMPORT_ACCEPT}
          className="hidden"
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <form onSubmit={(e) => void submit(e)} noValidate>
          <FieldGroup>
            <Field data-invalid={!!error || undefined}>
              <FieldLabel htmlFor="table-import-file">Spreadsheet</FieldLabel>
              <div className="flex min-w-0 items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  aria-describedby={error ? 'table-import-error' : undefined}
                  onClick={() => pickerRef.current?.click()}
                >
                  <Upload />
                  Choose file
                </Button>
                <span className="min-w-0 truncate text-sm text-muted-foreground">
                  {file ? `${file.name} · ${formatBytes(file.size)}` : 'No file chosen'}
                </span>
              </div>
              <FieldError id="table-import-error">{error}</FieldError>
            </Field>

            {building ? (
              <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
                Making the table. A large sheet takes a while.
              </p>
            ) : busy ? (
              <div className="overflow-hidden rounded-md border border-border">
                <UploadProgressBar
                  progress={aggregateProgress([
                    {
                      status: 'uploading',
                      size: sent?.total ?? file?.size ?? 0,
                      loaded: sent?.loaded ?? 0,
                      rate: sent?.rate ?? null,
                    },
                  ])}
                />
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={building} onClick={close}>
                Cancel
              </Button>
              <SubmitButton pending={busy} disabled={!file}>
                Import table
              </SubmitButton>
            </div>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
