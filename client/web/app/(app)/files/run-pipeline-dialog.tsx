'use client';

/**
 * Run a pipeline on a file or a folder (lib/pipeline-run.ts). One dialog: it
 * opens with the dry run, shows the choices of the answer with their counts,
 * and runs the one the person picks. The receipt says queued, not done.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { ApiError, apiSend } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { Label } from '@mantle/web-ui/ui/label';
import { RadioGroup, RadioGroupItem } from '@mantle/web-ui/ui/radio-group';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@mantle/web-ui/ui/dialog';
import {
  DRY_RUN_BODY,
  RUN_BUSY,
  RUN_NEXT_LABEL,
  RUN_NO_CHOICE,
  RUN_QUEUED_NOTE,
  applyBody,
  choiceOpen,
  filesText,
  firstPick,
  nextBody,
  openChoices,
  postRun,
  refusedText,
  resultLine,
  runRouteGone,
  skipLines,
  subscribeRunRouteGone,
  type PipelineRunBody,
  type RunStep,
  type RunTarget,
} from '@/lib/pipeline-run';

/** Whether the run route is gone for this session (a 404). */
export function useRunRouteGone(): boolean {
  return useSyncExternalStore(subscribeRunRouteGone, runRouteGone, () => false);
}

export function RunPipelineDialog({
  target,
  onOpenChange,
}: {
  target: RunTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [step, setStep] = useState<RunStep>({ step: 'asking' });
  const [pick, setPick] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Every open asks first: the dry run.
  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setStep({ step: 'asking' });
    setPick(null);
    postRun(target, DRY_RUN_BODY, apiSend)
      .then((dry) => {
        if (cancelled) return;
        setStep({ step: 'shown', dry });
        setPick(firstPick(dry));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) return onOpenChange(false);
        setStep({ step: 'error', message: err instanceof ApiError ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
    // Once per open target: the screens pass a fresh onOpenChange each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  if (!target) return null;

  const send = async (body: PipelineRunBody | null, pipeline: string) => {
    if (!body || pending || (step.step !== 'shown' && step.step !== 'done')) return;
    const dry = step.dry;
    setPending(true);
    try {
      const result = await postRun(target, body, apiSend);
      setStep({ step: 'done', dry, pipeline, result });
    } catch (err) {
      setStep({ step: 'error', message: err instanceof ApiError ? err.message : String(err) });
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onOpenChange(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Run a pipeline</DialogTitle>
          <DialogDescription>
            On {target.kind === 'file' ? 'the file' : 'the files in the folder'} {target.name}
            {target.kind === 'folder' ? ' and below' : ''}.
          </DialogDescription>
        </DialogHeader>
        <RunPipelineView
          step={step}
          pick={pick}
          onPick={setPick}
          pending={pending}
          onRun={() => pick && void send(applyBody(step, pick), pick)}
          onNext={() => step.step === 'done' && void send(nextBody(step), step.pipeline)}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

/** The dialog's body, by its step alone (rendered in the tests). */
export function RunPipelineView({
  step,
  pick,
  onPick,
  pending,
  onRun,
  onNext,
  onClose,
}: {
  step: RunStep;
  pick: string | null;
  onPick: (pipeline: string) => void;
  pending: boolean;
  onRun: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  if (step.step === 'asking') {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Looking at the files…
      </p>
    );
  }
  if (step.step === 'error') {
    return (
      <div className="space-y-4">
        <p className="text-sm text-destructive-ink">{step.message}</p>
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    );
  }

  if (step.step === 'done') {
    const { result } = step;
    const lines = skipLines(result);
    const more = nextBody(step) !== null;
    return (
      <div className="space-y-3 text-sm">
        {result.busy ? (
          <p>{RUN_BUSY}</p>
        ) : (
          <>
            <p className="font-medium">{resultLine(result)}</p>
            {lines.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                {lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            )}
            <p className="text-muted-foreground">{RUN_QUEUED_NOTE}</p>
          </>
        )}
        <div className="flex justify-end gap-2">
          {more && (
            <SubmitButton type="button" pending={pending} onClick={onNext}>
              {RUN_NEXT_LABEL}
            </SubmitButton>
          )}
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    );
  }

  const { dry } = step;
  const open = openChoices(dry);
  return (
    <div className="space-y-3 text-sm">
      {dry.busy ? (
        <p>{RUN_BUSY}</p>
      ) : dry.choices.length === 0 ? (
        <p className="text-muted-foreground">{RUN_NO_CHOICE}</p>
      ) : (
        <RadioGroup value={pick ?? ''} onValueChange={onPick} className="gap-2">
          {dry.choices.map((c) => (
            <div key={c.pipeline} className="flex items-start gap-2">
              <RadioGroupItem
                id={`run-${c.pipeline}`}
                value={c.pipeline}
                disabled={!choiceOpen(c)}
                className="mt-0.5"
              />
              <Label htmlFor={`run-${c.pipeline}`} className="block font-normal">
                <span className="font-medium">{c.name}</span>
                <span className="text-muted-foreground">: {filesText(c.files)}</span>
                {c.refused !== null && (
                  <span className="block text-xs text-muted-foreground">
                    {refusedText(c.refused)}
                  </span>
                )}
              </Label>
            </div>
          ))}
        </RadioGroup>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        {open.length > 0 && (
          <SubmitButton type="button" pending={pending} disabled={!pick} onClick={onRun}>
            Run pipeline
          </SubmitButton>
        )}
      </div>
    </div>
  );
}
