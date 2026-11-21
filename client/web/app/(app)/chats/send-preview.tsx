'use client';

import { useState } from 'react';
import { FileText, X } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@mantle/web-ui/ui/dialog';
import { Field, FieldLabel } from '@mantle/web-ui/ui/field';
import { Textarea } from '@mantle/web-ui/ui/textarea';
import type { DraftFile } from '@/lib/messenger/draft-files';
import { formatBytes, type AddedLine } from '@/lib/messenger/fleet';
import {
  INTAKE_NAMES,
  MESSENGER_INTAKE_ANSWER_MAX,
  MESSENGER_INTAKE_FORMS,
  type MessengerIntakeKind,
} from '@/lib/messenger/intake';

/** The warning on each picture that leaves the chat (plan section 5). */
export const SHOT_WARNING = 'A screenshot can show client data. Check it before you send.';
/** A file over the cap, in the composer and here. */
export const TOO_BIG = 'Too big. It will not be sent.';

/**
 * The send screen of a line to a handle or an IT desk (plan section 5): the
 * exact package before it goes. The intake form's questions (when the
 * address has one), the text, the lines the app adds (each removable), and
 * each file with its picture and the client data warning. Nothing goes
 * until Send.
 */
export function SendPreview({
  to,
  intake,
  text,
  files,
  lines: initialLines,
  onRemoveFile,
  onSend,
  onCancel,
}: {
  /** Where it goes, as shown: `@qa`, `@bugs (IT)`. */
  to: string;
  intake: MessengerIntakeKind | null;
  text: string;
  files: readonly DraftFile[];
  lines: readonly AddedLine[];
  onRemoveFile: (key: string) => void;
  onSend: (out: { answers: Record<string, string>; lines: AddedLine[] }) => void;
  onCancel: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<AddedLine[]>(() => [...initialLines]);
  const questions = intake ? MESSENGER_INTAKE_FORMS[intake] : [];
  const answered = Object.values(answers).some((a) => a.trim());
  const empty = !text.trim() && !answered && files.length === 0;
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-xl" data-testid="send-preview">
        <DialogHeader>
          <DialogTitle>Send to {to}</DialogTitle>
          <DialogDescription>
            This is exactly what goes{intake ? ` (${INTAKE_NAMES[intake]})` : ''}. Nothing else from
            this chat goes with it. Remove what should not go.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1 scrollbar-thin">
          {questions.map((q) => (
            <Field key={q.key}>
              <FieldLabel htmlFor={`intake-${q.key}`}>{q.label}</FieldLabel>
              <Textarea
                id={`intake-${q.key}`}
                rows={2}
                maxLength={MESSENGER_INTAKE_ANSWER_MAX}
                value={answers[q.key] ?? ''}
                onChange={(e) => setAnswers((cur) => ({ ...cur, [q.key]: e.target.value }))}
                className="min-h-14 resize-y"
              />
            </Field>
          ))}
          {text.trim() ? (
            <section aria-label="Your text" className="space-y-1">
              <h4 className="text-sm font-semibold">Your text</h4>
              <p className="whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-2 text-sm [overflow-wrap:anywhere]">
                {text}
              </p>
            </section>
          ) : null}
          {lines.length > 0 ? (
            <section aria-label="Added for you" className="space-y-1">
              <h4 className="text-sm font-semibold">Added for you</h4>
              <ul className="space-y-1" data-testid="added-lines">
                {lines.map((l) => (
                  <li
                    key={l.key}
                    className="flex items-start gap-2 rounded-md border border-border px-2 py-1 text-xs"
                  >
                    <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                      <span className="text-muted-foreground">{l.label}:</span> {l.value}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Remove ${l.label}`}
                      onClick={() => setLines((cur) => cur.filter((x) => x.key !== l.key))}
                    >
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {files.length > 0 ? (
            <section aria-label="Files" className="space-y-2">
              <h4 className="text-sm font-semibold">Files</h4>
              <ul className="space-y-2">
                {files.map((f) => (
                  <li key={f.key} className="space-y-1 rounded-md border border-border p-2">
                    <div className="flex items-center gap-2 text-xs">
                      <FileText className="size-3.5 shrink-0" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{f.name}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {formatBytes(f.bytes)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Remove ${f.name}`}
                        onClick={() => onRemoveFile(f.key)}
                      >
                        <X />
                      </Button>
                    </div>
                    {f.state === 'too-big' ? (
                      <p className="text-xs text-destructive-ink">{TOO_BIG}</p>
                    ) : f.url ? (
                      <>
                        {/* A local blob: next/image cannot optimise it. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={f.url}
                          alt={f.name}
                          className="max-h-48 w-auto max-w-full rounded border border-border object-contain"
                        />
                        <p className="text-xs text-warning-ink" data-testid="shot-warning">
                          {SHOT_WARNING}
                        </p>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={empty} onClick={() => onSend({ answers, lines })}>
            Send
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
