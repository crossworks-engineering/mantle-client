'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { boxName, type FleetOverview } from '@/lib/fleet';
import { currentModel, FLEET_MODELS_PATH, MODEL_ID, shippedSlugs } from '@/lib/fleet-models';
import { BoxPicker, useBoxPick } from './fleet-box-picker';
import { matrixQuery } from './fleet-matrix';
import { ConfirmSend, useFleetSend } from './fleet-writes';
import { Section } from './fleet-section';

/**
 * Set the model of one agent the system ships on one or many boxes. Each box
 * checks the agent is its shipped one and that its own model policy allows
 * the model, then sets the model field only: the provider and its key stay.
 */
export function ModelsSection({ data, onChanged }: { data: FleetOverview; onChanged: () => void }) {
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
  const { pending, send } = useFleetSend(FLEET_MODELS_PATH, onChanged);

  const confirm = async () => {
    const ids = chosen.map((b) => b.id);
    if (await send([{ slug: agent, model: typed }], ids, 'Could not send the model.')) {
      setModel('');
      setConfirming(false);
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
      <ConfirmSend
        open={confirming}
        pending={pending}
        title={`Set ${agent} to ${typed} on ${count}?`}
        action="Set model"
        onCancel={() => setConfirming(false)}
        onConfirm={() => void confirm()}
      >
        Each box sets the model if its model policy allows it. A box that refuses keeps the model it
        had. See each answer under Fleet changes.
      </ConfirmSend>
    </Section>
  );
}
