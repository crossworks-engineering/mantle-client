'use client';

import { useState } from 'react';
import { Bot } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@mantle/web-ui/ui/field';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@mantle/web-ui/ui/select';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import type { FleetOverview } from '@/lib/fleet';
import { currentModel, FLEET_MODELS_PATH, MODEL_ID, shippedSlugs } from '@/lib/fleet-models';
import {
  Callout,
  DetailPane,
  FleetScreen,
  SendBar,
  TargetList,
  useBoxPick,
  useMatrixRows,
} from '../cc-kit';
import { FleetModelPicker, PickerHint } from '../default-model';
import { ConfirmSend, useFleetSend } from '../fleet-writes';

/**
 * Set the model of one agent the system ships on one or many boxes. Each box
 * checks the agent is its shipped one and that its own model policy allows
 * the model, then sets the model field only: the provider and its key stay.
 * Each card on the left shows the model that box runs for the agent now.
 */
function Models({ data, refresh }: { data: FleetOverview; refresh: () => void }) {
  // The current models: the matrix (the same read as its screen).
  const { query: matrix, rows } = useMatrixRows(data.boxes);
  const slugs = shippedSlugs(rows);
  const [slug, setSlug] = useState('');
  const agent = slug && slugs.includes(slug) ? slug : (slugs[0] ?? '');
  const [model, setModel] = useState('');
  const typed = model.trim();
  const valid = MODEL_ID.test(typed);
  const { picked, setPicked, chosen, count } = useBoxPick(data.boxes);
  const [confirming, setConfirming] = useState(false);
  const { pending, send } = useFleetSend(FLEET_MODELS_PATH, refresh);
  const byId = new Map(rows.map((r) => [r.id, r]));
  // The models the fleet runs for this agent now, each once: one click fills
  // the field, so a box that differs is brought in line without typing.
  const inUse = [
    ...new Set(rows.map((r) => currentModel(r, agent)).filter((m): m is string => !!m)),
  ].sort();

  const confirm = async () => {
    const ids = chosen.map((b) => b.id);
    if (await send([{ slug: agent, model: typed }], ids, 'Could not send the model.')) {
      setModel('');
      setConfirming(false);
    }
  };

  return (
    <>
      <MasterDetail
        id="cc-models"
        list={
          <TargetList
            boxes={data.boxes}
            picked={picked}
            setPicked={setPicked}
            line={(b) => {
              const row = byId.get(b.id);
              const now = row && agent ? currentModel(row, agent) : null;
              return {
                tone: 'ok',
                text:
                  now !== null ? (
                    <span className="break-all font-mono">{now || 'no model'}</span>
                  ) : (
                    'Model not known'
                  ),
              };
            }}
          />
        }
        detail={
          <DetailPane icon={<Bot />} title="Set an agent model">
            <Callout>
              Each box checks its own model policy first. A box that refuses keeps the model it had.
              The agent keeps its provider and key.
            </Callout>
            {data.boxes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No box is linked.</p>
            ) : matrix.isLoading ? (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <Spinner size={20} /> Loading…
              </div>
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
                    <FieldDescription>
                      The cards on the left show the model each box runs for it now.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="fleet-model-value">Model</FieldLabel>
                    <FleetModelPicker
                      id="fleet-model-value"
                      value={model}
                      invalid={typed !== '' && !valid}
                      onValueChange={setModel}
                    />
                    <FieldDescription>
                      {typed !== '' && !valid
                        ? 'A model id has letters, digits and . _ : / @ + - only, with no space.'
                        : "From the Default Model's list, or type the model id as the agent's provider names it."}
                    </FieldDescription>
                    <PickerHint />
                  </Field>
                  {inUse.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs text-muted-foreground">In use on the fleet now:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {inUse.map((m) => (
                          <Button
                            key={m}
                            type="button"
                            size="2xs"
                            variant="outline"
                            className="font-mono font-normal"
                            onClick={() => setModel(m)}
                          >
                            {m}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                  <SendBar count={chosen.length}>
                    <SubmitButton
                      pending={false}
                      disabled={!valid || !agent || chosen.length === 0}
                    >
                      {chosen.length > 0 ? `Set model on ${count}` : 'Set model'}
                    </SubmitButton>
                  </SendBar>
                </FieldGroup>
              </form>
            )}
          </DetailPane>
        }
      />
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
    </>
  );
}

export function ModelsClient() {
  return (
    <FleetScreen needs="writes">
      {(data, refresh) => <Models data={data} refresh={refresh} />}
    </FleetScreen>
  );
}
