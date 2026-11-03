'use client';

/**
 * The decider worker's Test button: ONE small request to the SAVED model,
 * sent as production sends it (the worker's privacy level, its timeout and
 * the model's request limits; mantle docs/decisions.md "The Test button").
 * It shows ok with the time and the cost, or the plain reason it failed.
 * Only on a click; the brain never retries it and never lowers the privacy
 * level. It works while the worker and every use are still off. The sample
 * carries nothing of the owner's; the text box lets the operator try their
 * own line.
 */
import { useState, useTransition } from 'react';
import { CheckCircle2, Loader2, Scale, XCircle } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import { Field, FieldLabel } from '@mantle/web-ui/ui/field';
import { Textarea } from '@mantle/web-ui/ui/textarea';
import { useToast } from '@mantle/web-ui/ui/toast';
import { apiSend } from '@mantle/web-ui/api-fetch';
import { privacyText, type DecisionTestResult } from '@/lib/decider';

type Answer =
  | { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: 'score'; score: number; confidence: number; probabilities: Record<string, number> }
  | { type: 'noul'; probability: number };

export function DecisionTestButton({ workerId }: { workerId: string }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState(
    'My checkout page shows a blank screen after I click Pay. I have tried two browsers.',
  );
  const [result, setResult] = useState<DecisionTestResult | null>(null);

  const run = () => {
    startTransition(async () => {
      try {
        const r = await apiSend<DecisionTestResult>(
          `/api/ai-workers/${workerId}/test/decision`,
          'POST',
          { text: text.trim() },
        );
        setResult(r);
      } catch (err) {
        // The route itself refused (no such worker, not a decider): a model
        // failure comes back as a result, not here.
        setResult(null);
        toast.error(err instanceof Error ? err.message : String(err));
      }
    });
  };

  const fmt = (a: Answer | undefined): string => {
    if (!a) return 'no answer';
    if (a.type === 'noul') return `yes with probability ${a.probability.toFixed(2)}`;
    if (a.type === 'choice') return `${a.choice} (confidence ${a.confidence.toFixed(2)})`;
    return `score ${a.score.toFixed(2)} (confidence ${a.confidence.toFixed(2)})`;
  };

  // A result from an older brain (before decider Part 3) has no `ok` field
  // and no privacy: it answered, so it is shown as ok.
  const ok = result ? result.ok !== false : false;
  const answers = (result && 'answers' in result ? result.answers : {}) as Record<
    string,
    Answer | undefined
  >;

  return (
    <div className="space-y-3">
      <Field>
        <FieldLabel htmlFor="decision-test-text">Sample message</FieldLabel>
        <Textarea
          id="decision-test-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          className="min-h-[80px]"
        />
      </Field>
      <div>
        <Button type="button" onClick={run} disabled={pending}>
          {pending ? (
            <>
              <Loader2 className="animate-spin" />
              Testing…
            </>
          ) : (
            <>
              <Scale />
              Test
            </>
          )}
        </Button>
      </div>
      {result && (
        <div
          className="space-y-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs"
          data-testid="decision-test-result"
        >
          {ok ? (
            <>
              <p className="flex items-center gap-1.5 font-medium text-success-ink">
                <CheckCircle2 className="size-3.5" />
                OK: the model answered in {result.ms} ms.
              </p>
              <p>
                <span className="font-medium">team:</span> {fmt(answers.team)} ·{' '}
                <span className="font-medium">urgency:</span> {fmt(answers.urgency)} ·{' '}
                <span className="font-medium">is a bug:</span> {fmt(answers.is_bug)}
              </p>
            </>
          ) : (
            <>
              <p className="flex items-center gap-1.5 font-medium text-destructive-ink">
                <XCircle className="size-3.5" />
                Failed
                {result.ms > 0 ? ` after ${result.ms} ms` : ''}:{' '}
                {'reason' in result ? result.reason : ''}
              </p>
              {'detail' in result && result.detail && (
                <p className="break-words text-muted-foreground">Provider said: {result.detail}</p>
              )}
            </>
          )}
          <p className="text-muted-foreground">
            model: {result.model}
            {result.privacy && ` · privacy: ${privacyText(result.privacy)}`}
            {result.timeoutMs ? ` · timeout ${result.timeoutMs} ms` : ''}
            {'tokensIn' in result &&
              result.tokensIn != null &&
              ` · ${result.tokensIn} input tokens`}
            {'costUsd' in result && result.costUsd != null && ` · $${result.costUsd.toFixed(6)}`}
          </p>
        </div>
      )}
    </div>
  );
}
