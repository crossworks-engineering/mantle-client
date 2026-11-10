'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiSend } from '@mantle/web-ui/api-fetch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@mantle/web-ui/ui/alert-dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@mantle/web-ui/ui/field';
import { Input } from '@mantle/web-ui/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@mantle/web-ui/ui/select';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { useToast } from '@mantle/web-ui/ui/toast';
import { formatDateTime } from '@mantle/web-ui/lib/format-datetime';
import { boxName, type FleetBox, type FleetOverview } from '@/lib/fleet';
import { FLEET_MATRIX_KEY } from '@/lib/fleet-matrix';
import {
  currentModel,
  FLEET_MODELS_PATH,
  MODEL_ID,
  modelChangeText,
  modelUpdatePending,
  shippedSlugs,
} from '@/lib/fleet-models';
import { BoxPicker, useBoxPick } from './fleet-box-picker';
import { matrixQuery } from './fleet-matrix';
import { refusalText, Section } from './fleet-section';

const TONE = { ok: 'text-muted-foreground', bad: 'text-destructive-ink' } as const;

/** Each box's last model job: waiting, or each change's answer. */
function ModelStates({ boxes }: { boxes: FleetBox[] }) {
  const rows = boxes.filter((b) => b.modelJob || b.modelResult);
  if (rows.length === 0) return null;
  return (
    <ul
      className="divide-y divide-border rounded-md border border-border"
      aria-label="Model updates"
    >
      {rows.map((b) => (
        <li key={b.id} className="space-y-1 p-3">
          <p className="text-sm font-medium">{boxName(b)}</p>
          {b.modelJob ? (
            <>
              {b.modelJob.changes.map((c) => (
                <p key={c.slug} className="text-xs">
                  <span className="font-mono">{c.slug}</span> to{' '}
                  <span className="font-mono">{c.model}</span>:{' '}
                  <span className="text-muted-foreground">Waiting for the next run.</span>
                </p>
              ))}
              <p className="text-xs text-muted-foreground">
                By {b.modelJob.by}, {formatDateTime(b.modelJob.at)}.
              </p>
            </>
          ) : (
            <>
              {b.modelResult!.results.map((r) => {
                const answer = modelChangeText(r);
                return (
                  <p key={r.slug} className="text-xs">
                    <span className="font-mono">{r.slug}</span> to{' '}
                    <span className="font-mono">{r.model}</span>:{' '}
                    <span className={TONE[answer.tone]}>{answer.text}</span>
                  </p>
                );
              })}
              <p className="text-xs text-muted-foreground">
                By {b.modelResult!.by}, {formatDateTime(b.modelResult!.at)}.
              </p>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Set the model of one agent the system ships on one or many boxes. Each box
 * checks the agent is its shipped one and that its own model policy allows
 * the model, then sets the model field only: the provider and its key stay.
 */
export function ModelsSection({ data, onChanged }: { data: FleetOverview; onChanged: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  // The current models: the matrix (the same read as its section).
  const matrix = useQuery(matrixQuery);
  const rows = matrix.data?.boxes ?? [];
  const slugs = shippedSlugs(rows);
  const [slug, setSlug] = useState('');
  const agent = slug && slugs.includes(slug) ? slug : (slugs[0] ?? '');
  const [model, setModel] = useState('');
  const typed = model.trim();
  const valid = MODEL_ID.test(typed);
  const { picked, setPicked, chosen, count } = useBoxPick(data.boxes);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  // When the last job is answered, read the matrix again: it shows the new models.
  const waiting = modelUpdatePending(data.boxes);
  const wasWaiting = useRef(waiting);
  useEffect(() => {
    if (wasWaiting.current && !waiting) {
      void queryClient.invalidateQueries({ queryKey: FLEET_MATRIX_KEY });
    }
    wasWaiting.current = waiting;
  }, [waiting, queryClient]);

  const send = async () => {
    setPending(true);
    try {
      await apiSend(FLEET_MODELS_PATH, 'POST', {
        changes: [{ slug: agent, model: typed }],
        boxIds: chosen.map((b) => b.id),
      });
      setModel('');
      setConfirming(false);
      toast.success(`Sent to ${count}. Each box sets it at its next run.`);
      onChanged();
    } catch (err) {
      toast.error(refusalText(err, 'Could not send the model.'));
    } finally {
      setPending(false);
    }
  };

  const byId = new Map(rows.map((r) => [r.id, r]));

  return (
    <Section title="Agent models">
      <p className="text-sm text-muted-foreground">
        Set the model of an agent the system ships on the boxes you pick. Each box checks its own
        model policy first. The agent keeps its provider and key.
      </p>
      {data.boxes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No box is linked.</p>
      ) : matrix.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : slugs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No box has sent its agents yet. They come with the next good run.
        </p>
      ) : (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && agent && chosen.length > 0) setConfirming(true);
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="fleet-model-agent">Agent</FieldLabel>
              <Select value={agent} onValueChange={setSlug}>
                <SelectTrigger id="fleet-model-agent">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {slugs.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="fleet-model-value">Model</FieldLabel>
              <Input
                id="fleet-model-value"
                className="font-mono"
                placeholder="vendor/model-name"
                autoComplete="off"
                spellCheck={false}
                maxLength={200}
                value={model}
                aria-invalid={typed !== '' && !valid}
                onChange={(e) => setModel(e.target.value)}
              />
              <FieldDescription>
                {typed !== '' && !valid
                  ? 'A model id has letters, digits and . _ : / @ + - only, with no space.'
                  : 'The model id as the provider names it.'}
              </FieldDescription>
            </Field>
            <BoxPicker
              boxes={data.boxes}
              picked={picked}
              setPicked={setPicked}
              idPrefix="fleet-model-box"
            />
            <ul className="space-y-0.5 text-xs text-muted-foreground" aria-label="Current models">
              {data.boxes.map((b) => {
                const row = byId.get(b.id);
                const now = row ? currentModel(row, agent) : null;
                return (
                  <li key={b.id}>
                    {boxName(b)}:{' '}
                    {now !== null ? (
                      <span className="font-mono">{now || 'no model'}</span>
                    ) : (
                      'not known'
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="flex justify-end">
              <SubmitButton pending={false} disabled={!valid || !agent || chosen.length === 0}>
                {chosen.length > 0 ? `Set model on ${count}` : 'Set model'}
              </SubmitButton>
            </div>
          </FieldGroup>
        </form>
      )}
      <ModelStates boxes={data.boxes} />
      <AlertDialog open={confirming} onOpenChange={(o) => !o && !pending && setConfirming(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Set {agent} to {typed} on {count}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Each box sets the model if its model policy allows it. A box that refuses keeps the
              model it had.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              Set model
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  );
}
