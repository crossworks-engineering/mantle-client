'use client';

/**
 * The LLM field group for the worker form.
 *
 * Moved out of worker-form.tsx unchanged (structure pass, phase 1): the
 * components were already standalone and took plain props, they were just
 * living in a 2,507-line file. No signatures changed.
 */
import { HUGGINGFACE_ROUTING_POLICIES } from '@mantle/voice-client';
import { Input } from '@mantle/web-ui/ui/input';
import { Checkbox } from '@mantle/web-ui/ui/checkbox';
import { Textarea } from '@mantle/web-ui/ui/textarea';
import { Field, FieldLabel } from '@mantle/web-ui/ui/field';
import { SelectItem } from '@mantle/web-ui/ui/select';
import { FieldHint, hintId } from '@mantle/web-ui/ui/field-hint';
import { FormSelect } from './worker-form-select';

export function LlmWorkerFields({
  params,
  systemPrompt,
  kind,
  provider,
}: {
  params: Record<string, unknown>;
  systemPrompt: string | null | undefined;
  kind: 'reflector' | 'extractor' | 'summarizer' | 'narrator' | 'suggester' | 'translator';
  provider: string;
}) {
  return (
    <div className="space-y-4">
      {kind === 'suggester' && (
        <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          The suggester proposes <strong>one follow-up question</strong> after each reply, shown as
          an accept-with-Enter chip above the composer. The{' '}
          <strong>system prompt below is the tuning knob</strong>: steer the tone or focus of the
          question it proposes. It only runs for agents with “Suggest follow-ups” switched on, off
          the turn’s critical path; if it’s slow or fails, no chip appears.
        </p>
      )}
      {kind === 'narrator' && (
        <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          The narrator restyles the live “thought trail” into your assistant’s voice. The{' '}
          <strong>system prompt below is the verbosity dial</strong> — tell it to reply with a terse
          phrase, a full sentence, or a short paragraph, and it follows. Raise{' '}
          <strong>Max tokens</strong> if you ask for more words. It runs once per tool step, off the
          turn’s critical path; if it’s slow or fails, the plain grounded line stays.
        </p>
      )}
      {kind === 'translator' && (
        <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          The translator runs the <strong>translate</strong> tool, only when a person or an agent
          asks. The text goes in parts sized by the model&apos;s own limits, and every part is
          translated; code blocks are never sent. The model above runs every part. The built-in
          translation rules always apply: a system prompt here only adds to them.
        </p>
      )}
      <Field>
        <FieldLabel htmlFor="systemPrompt">System prompt</FieldLabel>
        <Textarea
          id="systemPrompt"
          name="systemPrompt"
          defaultValue={systemPrompt ?? ''}
          rows={8}
          placeholder={
            kind === 'narrator'
              ? 'e.g. "Rewrite this status as ONE warm first-person sentence, present tense, ending with an ellipsis…" — blank uses the built-in concise default.'
              : '(default prompt is used if blank)'
          }
          className="min-h-[120px] font-mono"
        />
        <p className="text-xs text-muted-foreground">
          {kind === 'narrator'
            ? 'Leave blank for the built-in concise voice (a short phrase). Write your own to control how much it says.'
            : kind === 'translator'
              ? 'Leave blank for the built-in rules alone. Text here is added to them (terms, style).'
              : 'Leave blank to use the built-in default for this worker kind.'}
        </p>
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field>
          <FieldLabel htmlFor="temperature">Temperature</FieldLabel>
          <Input
            id="temperature"
            name="temperature"
            type="number"
            step="0.05"
            min="0"
            max="2"
            defaultValue={(params.temperature as number) ?? 0.2}
            aria-describedby={hintId('temperature')}
          />
          <FieldHint
            id="temperature"
            warn="Background workers want low — high invites invented detail."
          >
            How much the model improvises. 0.2 keeps it factual.
          </FieldHint>
        </Field>
        <Field>
          <FieldLabel htmlFor="max_tokens">Max tokens</FieldLabel>
          <Input
            id="max_tokens"
            name="max_tokens"
            type="number"
            // The translator's parts are sized by the model's own output
            // limit: blank keeps it. A low number here makes many small parts.
            defaultValue={
              (params.max_tokens as number | undefined) ?? (kind === 'translator' ? '' : 1500)
            }
            placeholder={kind === 'translator' ? 'blank = the model’s limit' : undefined}
            aria-describedby={hintId('max_tokens')}
          />
          {kind === 'translator' ? (
            <FieldHint id="max_tokens" warn="A low cap means many small parts, and more calls.">
              Ceiling on each part&apos;s answer. Blank uses the model&apos;s own output limit.
            </FieldHint>
          ) : (
            <FieldHint id="max_tokens" warn="Too low truncates the output mid-way.">
              Ceiling on each run&apos;s output. 1500 suits a summary or a note.
            </FieldHint>
          )}
        </Field>
      </div>
      {kind === 'reflector' && (
        <div className="grid grid-cols-2 gap-4">
          <Field>
            <FieldLabel htmlFor="window_size">Window size (turns)</FieldLabel>
            <Input
              id="window_size"
              name="window_size"
              type="number"
              defaultValue={(params.window_size as number) ?? 50}
              aria-describedby={hintId('window_size')}
            />
            <FieldHint
              id="window_size"
              warn="A wide window makes every run a bigger, pricier prompt."
            >
              How many recent turns the reflector reviews per run.
            </FieldHint>
          </Field>
          <Field>
            <FieldLabel htmlFor="max_notes_per_run">Max rules per run</FieldLabel>
            <Input
              id="max_notes_per_run"
              name="max_notes_per_run"
              type="number"
              defaultValue={(params.max_notes_per_run as number) ?? 10}
              aria-describedby={hintId('max_notes_per_run')}
            />
            <FieldHint id="max_notes_per_run" warn="Raise it and the Journal fills with trivia.">
              Ceiling on learned rules written per run. Default 10.
            </FieldHint>
          </Field>
        </div>
      )}
      {kind === 'extractor' && (
        <>
          <Field>
            <FieldLabel htmlFor="target_types">Target node types (comma-separated)</FieldLabel>
            <Input
              id="target_types"
              name="target_types"
              defaultValue={
                Array.isArray(params.target_types)
                  ? (params.target_types as string[]).join(', ')
                  : ''
              }
              placeholder="note, * (* = all non-skip types)"
              aria-describedby={hintId('target_types')}
            />
            <FieldHint id="target_types" warn="`*` means every ingested node gets an LLM pass.">
              Which node types this extractor runs on.
            </FieldHint>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field orientation="horizontal">
              <Checkbox
                id="extract_facts"
                name="extract_facts"
                defaultChecked={params.extract_facts !== false}
              />
              <FieldLabel htmlFor="extract_facts" className="cursor-pointer font-normal">
                Extract facts (vs. summary only)
              </FieldLabel>
            </Field>
            <Field>
              <FieldLabel htmlFor="extract_cost_cap_micro_usd">Cost cap (µUSD per node)</FieldLabel>
              <Input
                id="extract_cost_cap_micro_usd"
                name="extract_cost_cap_micro_usd"
                type="number"
                defaultValue={(params.extract_cost_cap_micro_usd as number | undefined) ?? ''}
                placeholder="blank = no cap"
                aria-describedby={hintId('extract_cost_cap_micro_usd')}
              />
              <FieldHint
                id="extract_cost_cap_micro_usd"
                warn="Blank means a bulk import extracts with no ceiling."
              >
                Spend allowed on a single node before extraction gives up.
              </FieldHint>
            </Field>
            <Field>
              <FieldLabel htmlFor="max_embedded_images_per_doc">
                Embedded images per document
              </FieldLabel>
              <Input
                id="max_embedded_images_per_doc"
                name="max_embedded_images_per_doc"
                type="number"
                min={0}
                defaultValue={(params.max_embedded_images_per_doc as number | undefined) ?? ''}
                placeholder="blank = 30"
                aria-describedby={hintId('max_embedded_images_per_doc')}
              />
              <FieldHint
                id="max_embedded_images_per_doc"
                warn="Every image kept costs one vision call, so a big number across a big corpus is real money."
              >
                Diagrams and screenshots kept per document, in reading order. The default 30 suits a
                mixed corpus; a screenshot-heavy manual needs more or its later figures are dropped.
              </FieldHint>
            </Field>
          </div>
        </>
      )}
      {kind === 'summarizer' && (
        <div className="grid grid-cols-2 gap-4">
          <Field>
            <FieldLabel htmlFor="summarize_threshold">Threshold (turns)</FieldLabel>
            <Input
              id="summarize_threshold"
              name="summarize_threshold"
              type="number"
              defaultValue={(params.summarize_threshold as number) ?? 30}
              aria-describedby={hintId('summarize_threshold')}
            />
            <FieldHint
              id="summarize_threshold"
              warn="Set it low and the summarizer fires constantly."
            >
              Min undigested turns before we attempt a rollup.
            </FieldHint>
          </Field>
          <Field>
            <FieldLabel htmlFor="summarize_batch">Batch (turns)</FieldLabel>
            <Input
              id="summarize_batch"
              name="summarize_batch"
              type="number"
              defaultValue={(params.summarize_batch as number) ?? 20}
              aria-describedby={hintId('summarize_batch')}
            />
            <FieldHint
              id="summarize_batch"
              warn="Fold in too many at once and the digest turns vague."
            >
              Max turns folded per digest.
            </FieldHint>
          </Field>
        </div>
      )}
      {kind === 'translator' && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="fallback_model">Fallback model</FieldLabel>
              <Input
                id="fallback_model"
                name="fallback_model"
                defaultValue={(params.fallback_model as string | undefined) ?? ''}
                placeholder="blank = none"
                className="font-mono"
                aria-describedby={hintId('fallback_model')}
              />
              <FieldHint id="fallback_model">
                Takes a part only when the main model fails it (an error, a refusal, an empty or cut
                answer). A model id on this worker&apos;s provider.
              </FieldHint>
            </Field>
            <Field>
              <FieldLabel htmlFor="high_model">High-quality model</FieldLabel>
              <Input
                id="high_model"
                name="high_model"
                defaultValue={(params.high_model as string | undefined) ?? ''}
                placeholder="blank = none"
                className="font-mono"
                aria-describedby={hintId('high_model')}
              />
              <FieldHint
                id="high_model"
                warn="Blank means a call that asks for high quality fails."
              >
                Runs a call that asks for high quality, instead of the main model. A model id on
                this worker&apos;s provider.
              </FieldHint>
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="part_tokens">Part size (tokens)</FieldLabel>
            <Input
              id="part_tokens"
              name="part_tokens"
              type="number"
              min={1}
              defaultValue={(params.part_tokens as number | undefined) ?? ''}
              placeholder="blank = the model’s own"
              className="w-48"
              aria-describedby={hintId('part_tokens')}
            />
            <FieldHint id="part_tokens">
              Asks for smaller parts than the model&apos;s limits allow, never larger.
            </FieldHint>
          </Field>
        </>
      )}
      {provider === 'huggingface' && (
        <Field>
          <FieldLabel htmlFor="huggingface_routing">HF routing policy</FieldLabel>
          <FormSelect
            id="huggingface_routing"
            name="huggingface_routing"
            defaultValue={(params.huggingface_routing as string) ?? 'fastest'}
          >
            {HUGGINGFACE_ROUTING_POLICIES.map((policy) => (
              <SelectItem key={policy} value={policy}>
                {policy}
                {policy === 'fastest' && ' — lowest latency provider (default)'}
                {policy === 'cheapest' && ' — lowest cost per output token'}
                {policy === 'preferred' && ' — your saved provider preference order'}
              </SelectItem>
            ))}
          </FormSelect>
          <p className="text-xs text-muted-foreground">
            HF's router picks which sub-provider (Cerebras, Groq, Together…) actually serves this
            call. Appended as a suffix to the model id at request time.
          </p>
        </Field>
      )}
    </div>
  );
}
