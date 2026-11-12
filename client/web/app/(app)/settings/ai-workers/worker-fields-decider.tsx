'use client';

/**
 * The Decider field group: the experimental typed-decision layer (TypeSafe
 * Jev). The worker's own enable toggle in the header is the master switch;
 * this section holds one switch PER USE, each with a mode (`shadow` = the
 * answer only lands in the trace, behaviour unchanged; `live` = the answer
 * is used) and, where the use has one, a threshold. A use missing from
 * `params.uses` is off. Spec: mantle docs/decisions.md.
 */
import { Input } from '@mantle/web-ui/ui/input';
import { Checkbox } from '@mantle/web-ui/ui/checkbox';
import { Field, FieldLabel } from '@mantle/web-ui/ui/field';
import { SelectItem } from '@mantle/web-ui/ui/select';
import { FieldHint, hintId } from '@mantle/web-ui/ui/field-hint';
import { deciderPrivacyOf } from '@/lib/decider';
import { DECISION_USES } from '@/lib/decision-uses';
import { FormSelect } from './worker-form-select';

type UseConfig = {
  enabled?: boolean;
  mode?: 'shadow' | 'live';
  threshold?: number;
  pool?: number;
};

export function DeciderFields({ params }: { params: Record<string, unknown> }) {
  const uses = (params.uses ?? {}) as Record<string, UseConfig | undefined>;
  return (
    <div className="space-y-5">
      <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        The decider is a <strong>typed-decision model</strong>: it writes no text. Code sends it
        state and typed questions and gets back a choice, a score or a yes/no with probabilities in
        about 300 ms. A fresh brain ships every built use <strong>live</strong>, except PDF kind
        (shadow). Switch a use to <strong>shadow</strong> to watch it without acting: the answers
        land in /traces (steps named <code>decide_*</code>) and nothing else changes. Untick a use
        to turn it off.
      </p>
      <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
        <strong>Privacy:</strong> the state sent to the decider leaves this box (OpenRouter → the
        model&apos;s provider). Every call asks that the data is not used for training. With the box
        below ticked (the default) it also asks for zero data retention; unticked, the provider may
        keep the data for a time. A model with no zero-retention route fails under the default, and
        the brain never lowers the level by itself: you decide. Keep the worker off on a brain whose
        owner has not opted in.
      </p>

      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Uses
        </h3>
        {DECISION_USES.map((u) => {
          const cfg = uses[u.id] ?? {};
          const base = `use_${u.id}`;
          return (
            <div key={u.id} className="space-y-2 rounded-md border border-border p-3">
              <Field orientation="horizontal">
                <Checkbox
                  id={`${base}_enabled`}
                  name={`${base}_enabled`}
                  defaultChecked={cfg.enabled === true}
                />
                <FieldLabel htmlFor={`${base}_enabled`} className="cursor-pointer font-medium">
                  {u.label}
                </FieldLabel>
              </Field>
              <p className="text-xs text-muted-foreground">{u.description}</p>
              <div className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor={`${base}_mode`}>Mode</FieldLabel>
                  <FormSelect
                    id={`${base}_mode`}
                    name={`${base}_mode`}
                    defaultValue={cfg.mode === 'live' ? 'live' : 'shadow'}
                    describedBy={hintId(`${base}_mode`)}
                  >
                    <SelectItem value="shadow">Shadow (log only)</SelectItem>
                    <SelectItem value="live">Live (act on the answer)</SelectItem>
                  </FormSelect>
                  <FieldHint id={`${base}_mode`}>
                    Shadow logs the answer only. Live acts on it.
                  </FieldHint>
                </Field>
                {u.threshold != null && (
                  <Field>
                    <FieldLabel htmlFor={`${base}_threshold`}>
                      Threshold ({u.scale === 'probability' ? '0–1' : '0–3'})
                    </FieldLabel>
                    <Input
                      id={`${base}_threshold`}
                      name={`${base}_threshold`}
                      type="number"
                      step={u.scale === 'probability' ? '0.05' : '0.1'}
                      min="0"
                      max={u.scale === 'probability' ? '1' : '3'}
                      defaultValue={typeof cfg.threshold === 'number' ? cfg.threshold : u.threshold}
                      aria-describedby={hintId(`${base}_threshold`)}
                    />
                    <FieldHint id={`${base}_threshold`}>{u.thresholdHint}</FieldHint>
                  </Field>
                )}
                {u.pool && (
                  <Field>
                    <FieldLabel htmlFor={`${base}_pool`}>Passages judged (pool)</FieldLabel>
                    <Input
                      id={`${base}_pool`}
                      name={`${base}_pool`}
                      type="number"
                      step="1"
                      min="1"
                      max="100"
                      placeholder="Default"
                      defaultValue={typeof cfg.pool === 'number' ? cfg.pool : ''}
                      aria-describedby={hintId(`${base}_pool`)}
                    />
                    <FieldHint id={`${base}_pool`}>
                      How many search passages Jev scores before the cut. Blank = default (16 to
                      25). Above 25 means several Jev requests: more time and more cost.
                    </FieldHint>
                  </Field>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Worker-level limits
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <Field>
            <FieldLabel htmlFor="defer_below">Defer below (confidence)</FieldLabel>
            <Input
              id="defer_below"
              name="defer_below"
              type="number"
              step="0.05"
              min="0"
              max="1"
              defaultValue={(params.defer_below as number) ?? 0.6}
              aria-describedby={hintId('defer_below')}
            />
            <FieldHint id="defer_below">
              Under this confidence an answer is recorded, not acted on.
            </FieldHint>
          </Field>
          <Field>
            <FieldLabel htmlFor="act_alone_at">Act alone at (confidence)</FieldLabel>
            <Input
              id="act_alone_at"
              name="act_alone_at"
              type="number"
              step="0.05"
              min="0"
              max="1"
              defaultValue={(params.act_alone_at as number) ?? 0.9}
              aria-describedby={hintId('act_alone_at')}
            />
            <FieldHint id="act_alone_at">
              Only at or above this may an answer be acted on with no second check.
            </FieldHint>
          </Field>
          <Field>
            <FieldLabel htmlFor="timeout_ms">Timeout (ms)</FieldLabel>
            <Input
              id="timeout_ms"
              name="timeout_ms"
              type="number"
              step="100"
              min="200"
              max="5000"
              defaultValue={(params.timeout_ms as number) ?? 1500}
              aria-describedby={hintId('timeout_ms')}
            />
            <FieldHint id="timeout_ms">
              A slow decision is worse than none: past this, the caller carries on without it.
            </FieldHint>
          </Field>
          <Field orientation="horizontal" className="self-end">
            <Checkbox id="zdr" name="zdr" defaultChecked={deciderPrivacyOf(params) === 'zdr'} />
            <FieldLabel htmlFor="zdr" className="cursor-pointer font-normal">
              Request zero data retention on every call
            </FieldLabel>
          </Field>
        </div>
      </div>
    </div>
  );
}
