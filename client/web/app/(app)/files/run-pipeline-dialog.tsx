'use client';

/**
 * Run a pipeline on a file or a folder (lib/pipeline-run.ts), or read a
 * pipeline's older files again (Settings > Pipelines). One dialog: it
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
  rereadRouteGone,
  runRouteGone,
  skipLines,
  subscribeRereadRouteGone,
  subscribeRunRouteGone,
  type PipelineRunAnswer,
  type PipelineRunBody,
  type RunStep,
  type RunTarget,
} from '@/lib/pipeline-run';

/** Whether the run route is gone for this session (a 404). */
export function useRunRouteGone(): boolean {
  return useSyncExternalStore(subscribeRunRouteGone, runRouteGone, () => false);
}

/** Whether the re-read route is gone for this session (a 404). The flag is
 *  the module's on both sides, so a render test can read it too. */
export function useRereadRouteGone(): boolean {
  return useSyncExternalStore(subscribeRereadRouteGone, rereadRouteGone, rereadRouteGone);
}

/** Run a pipeline on a file or a folder of Files. */
export function RunPipelineDialog({
  target,
  onOpenChange,
}: {
  target: RunTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <RunDialog
      openKey={target}
      title="Run a pipeline"
      description={
        target
          ? `On ${target.kind === 'file' ? 'the file' : 'the files in the folder'} ${target.name}${
              target.kind === 'folder' ? ' and below' : ''
            }.`
          : ''
      }
      post={(body) => postRun(target!, body, apiSend)}
      onOpenChange={onOpenChange}
    />
  );
}

/**
 * The one Run dialog, fed by one route (`post`): the run of Files, or the
 * re-read of Settings > Pipelines. Each open (a new `openKey`) asks first
 * with the dry run; Run and "Run the next" send only the bodies of
 * applyBody and nextBody. A 404 closes it (the caller's `post` marks the
 * route gone). `onRan` is told after each run.
 */
export function RunDialog({
  openKey,
  title,
  description,
  post,
  onOpenChange,
  onRan,
  refused,
}: {
  openKey: unknown;
  title: string;
  description: string;
  post: (body: PipelineRunBody) => Promise<PipelineRunAnswer>;
  onOpenChange: (open: boolean) => void;
  onRan?: () => void;
  refused?: (word: string) => string;
}) {
  const open = openKey !== null && openKey !== undefined;
  const [step, setStep] = useState<RunStep>({ step: 'asking' });
  const [pick, setPick] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Every open asks first: the dry run.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStep({ step: 'asking' });
    setPick(null);
    post(DRY_RUN_BODY)
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
    // Once per open key: the screens pass a fresh post and onOpenChange each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey]);

  if (!open) return null;

  const send = async (body: PipelineRunBody | null, pipeline: string) => {
    if (!body || pending || (step.step !== 'shown' && step.step !== 'done')) return;
    const dry = step.dry;
    setPending(true);
    try {
      const result = await post(body);
      setStep({ step: 'done', dry, pipeline, result });
      onRan?.();
    } catch (err) {
      setStep({ step: 'error', message: err instanceof ApiError ? err.message : String(err) });
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onOpenChange(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <RunPipelineView
          step={step}
          pick={pick}
          onPick={setPick}
          pending={pending}
          onRun={() => pick && void send(applyBody(step, pick), pick)}
          onNext={() => step.step === 'done' && void send(nextBody(step), step.pipeline)}
          onClose={() => onOpenChange(false)}
          refused={refused}
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
  refused = refusedText,
}: {
  step: RunStep;
  pick: string | null;
  onPick: (pipeline: string) => void;
  pending: boolean;
  onRun: () => void;
  onNext: () => void;
  onClose: () => void;
  /** A refusal word in plain words: the run's, or the re-read's. */
  refused?: (word: string) => string;
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
                  <span className="block text-xs text-muted-foreground">{refused(c.refused)}</span>
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
