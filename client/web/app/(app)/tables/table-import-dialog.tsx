'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { bounceToLogin } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { useToast } from '@mantle/web-ui/ui/toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@mantle/web-ui/ui/dialog';
import { Field, FieldError, FieldGroup, FieldLabel } from '@mantle/web-ui/ui/field';
import type { TableDetail } from '@mantle/content-core/table-model';
import { UploadProgressBar, useUnloadGuard } from '@/components/uploads/upload-provider';
import {
  TABLE_IMPORT_ACCEPT,
  TABLE_IMPORT_CLOSE_AFTER_MS,
  TABLE_IMPORT_MAY_LAND,
  TableImportAnswerLost,
  importTable,
  tableImportError,
  tableImportRefusal,
} from '@/lib/table-import';
import { aggregateProgress, formatBytes, progressTicker } from '@/lib/upload-progress';
import { UploadAbortedError, UploadHttpError } from '@/lib/xhr-upload';

type Sent = { loaded: number; total: number; rate: number | null };

/**
 * Pick a spreadsheet, send it, get a new table. While the bytes go out Cancel
 * stops them. Once they are all sent the brain is building the table and it
 * will land whatever this dialog does (`importTable` stops bytes only), so the
 * dialog stays until it answers. An answer may never come, so after a long wait
 * a Close hides the dialog. A late answer then refreshes the list and shows as
 * a toast.
 * While a file goes out only these buttons are a way out: Escape or a stray
 * click must not lose an upload with no word.
 */
export function TableImportDialog({
  open,
  onOpenChange,
  onImported,
  onMayLand,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (table: TableDetail) => void;
  /** A table may have landed that this dialog never heard about. */
  onMayLand: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);
  const [waitedLong, setWaitedLong] = useState(false);
  const toast = useToast();
  const pickerRef = useRef<HTMLInputElement | null>(null);
  const sending = useRef<AbortController | null>(null);
  const left = useRef(false);

  useUnloadGuard(busy);

  // Leaving the screen stops bytes still going out, and `submit` says so. Once
  // all are sent the table lands anyway, and the answer is a toast.
  useEffect(() => {
    left.current = false; // Strict Mode runs this effect twice.
    return () => {
      left.current = true;
      sending.current?.abort();
      sending.current = null;
    };
  }, []);

  const building = busy && sent !== null && sent.loaded >= sent.total;

  const locked = building && !waitedLong;

  useEffect(() => {
    if (!building) return;
    const timer = setTimeout(() => setWaitedLong(true), TABLE_IMPORT_CLOSE_AFTER_MS);
    return () => {
      clearTimeout(timer);
      setWaitedLong(false);
    };
  }, [building]);

  const reset = () => {
    setFile(null);
    setError(null);
    setBusy(false);
    setSent(null);
    onOpenChange(false);
  };

  const close = () => {
    // Refresh again now: the table may have landed since the answer was lost.
    if (error === TABLE_IMPORT_MAY_LAND) onMayLand();
    sending.current?.abort();
    sending.current = null;
    reset();
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
      if (sending.current !== controller) {
        onMayLand();
        toast.success(`Imported ${table.title}`);
        return;
      }
      sending.current = null;
      close();
      onImported(table);
    } catch (err) {
      if (err instanceof UploadAbortedError) {
        if (left.current) toast.error('The import stopped because you left the screen.');
        return; // Cancel: already closed.
      }
      if (err instanceof UploadHttpError && err.status === 401) bounceToLogin();
      if (err instanceof TableImportAnswerLost) onMayLand();
      if (sending.current !== controller) {
        toast.error(tableImportError(err));
        return;
      }
      sending.current = null;
      setBusy(false);
      setSent(null);
      // The table may land: a second try is a choice, so it starts with a pick.
      if (err instanceof TableImportAnswerLost) setFile(null);
      setError(tableImportError(err));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else if (!busy) close();
      }}
    >
      <DialogContent className="sm:max-w-md" hideClose={busy}>
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
          disabled={busy}
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <form onSubmit={(e) => void submit(e)} noValidate>
          <FieldGroup>
            <Field data-invalid={!!error || undefined}>
              <FieldLabel id="table-import-label" htmlFor="table-import-file">
                Spreadsheet
              </FieldLabel>
              <div className="flex min-w-0 items-center gap-2">
                {/* The file input is display:none, so the label names this button. */}
                <Button
                  id="table-import-choose"
                  type="button"
                  variant="outline"
                  disabled={busy}
                  aria-labelledby="table-import-label table-import-choose"
                  aria-invalid={!!error || undefined}
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
                {waitedLong
                  ? 'This is taking a long time. You can close this. The table may still appear in the list.'
                  : 'Making the table. A large sheet takes a while.'}
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
              <Button type="button" variant="outline" disabled={locked} onClick={close}>
                {waitedLong ? 'Close' : 'Cancel'}
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
