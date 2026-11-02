'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeftRight } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { Switch } from '@mantle/web-ui/ui/switch';
import { Input } from '@mantle/web-ui/ui/input';
import { Field, FieldError, FieldLabel } from '@mantle/web-ui/ui/field';
import { Checkbox } from '@mantle/web-ui/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@mantle/web-ui/ui/select';
import { FieldHint, hintId } from '@mantle/web-ui/ui/field-hint';
import { ModelSelect } from '@/components/ui/model-select';
import { cn } from '@mantle/web-ui/lib/utils';
import { isProviderWired, providersForCapability } from '@mantle/voice-client';
import type { ProfilePreferences } from '@mantle/client-types';
import { apiFetch } from '@mantle/web-ui/api-fetch';
import {
  AGENT_THINKING_EFFORT_OPTIONS,
  THINKING_EFFORT_WARNINGS,
  parseAgentThinkingEffort,
  profileThinkingLabel,
} from '@/lib/thinking-effort';
import { estimateTokens, CORPUS_MAP_CHARS_PER_TOKEN } from '@/lib/token-estimate';
import {
  CORPUS_MAP_DEFAULT_CHARS,
  CORPUS_MAP_MAX_CHARS,
  CORPUS_MAP_MIN_CHARS,
  TOOL_LOADING_OPTIONS,
  defaultToolLoading,
  parseToolLoading,
  type AgentErrors,
  type FormState,
} from './agent-form-state';
import type { ModelCatalog } from './use-model-catalog';

/** Built-in node types the extractor can be allow-listed against. Matches
 *  the `node_type` enum in packages/db/src/schema/nodes.ts minus `branch`
 *  (folders, never extracted). `secret` is included but uses metadata-only
 *  extraction — see `apps/agent/src/extractor.ts:readNodeBodyRaw`. */
const KNOWN_NODE_TYPES = [
  'note',
  'file',
  'email',
  'email_thread',
  'secret',
  'task',
  'event',
  'telegram_message',
] as const;
// `sermon`, `contact`, `printer_project` remain in the Postgres
// `node_type` enum but have no writer code. Hidden from the chip picker
// so the UI doesn't suggest types that produce no nodes. Re-add here
// (and a matching `case` in extractor.ts:readNodeBodyRaw) if a surface
// for one of them is ever built.

/** Radix `Select` forbids an empty-string item value, so "no choice" rides a
 *  sentinel that maps back to `''` in the form state. */
export const NONE = '__none__';

type ApiKeyOption = { id: string; service: string; label: string; masked: string };

type SetFormState = React.Dispatch<React.SetStateAction<FormState>>;

/** Select value for "no own effort". Radix Select forbids an empty value. */
const INHERIT = '__inherit__';

/** The agent's own thinking effort. Inherit (the default) follows the person's
 *  profile, and the option says which level that is right now, so "Inherit"
 *  is never a mystery. The profile is read on its own query: a failure only
 *  drops the level from the label. */
export function ThinkingEffortField({ form, setForm }: { form: FormState; setForm: SetFormState }) {
  const profile = useQuery({
    queryKey: ['profile', 'thinking'],
    queryFn: () => apiFetch<{ preferences: ProfilePreferences }>('/api/profile'),
    staleTime: 60_000,
  });
  const inheritLabel = profile.data
    ? `Inherit from profile (${profileThinkingLabel(profile.data.preferences)})`
    : 'Inherit from profile';
  const warning = form.thinkingEffort ? THINKING_EFFORT_WARNINGS[form.thinkingEffort] : undefined;
  return (
    <Field>
      <FieldLabel htmlFor="thinkingEffort">Thinking effort</FieldLabel>
      <Select
        value={form.thinkingEffort ?? INHERIT}
        onValueChange={(v) =>
          setForm((f) => ({ ...f, thinkingEffort: parseAgentThinkingEffort(v) }))
        }
      >
        <SelectTrigger
          id="thinkingEffort"
          className="w-64"
          aria-describedby={hintId('thinkingEffort')}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={INHERIT}>{inheritLabel}</SelectItem>
          {AGENT_THINKING_EFFORT_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldHint id="thinkingEffort" warn={warning}>
        How hard this agent reasons before it answers. Used when the model supports reasoning
        effort. Inherit follows your profile; Off never reasons; a level here applies whatever your
        profile says (your live-thinking switch then only shows or hides it).
      </FieldHint>
    </Field>
  );
}

/** Select value for "no mode set": the brain picks. */
const TOOL_LOADING_DEFAULT = '__default__';

/** How granted tools reach the model. Default (nothing stored) follows the
 *  brain and the option names the mode it picks for this role and model; a
 *  loaded mode stays as it is until the person picks another. */
export function ToolLoadingField({ form, setForm }: { form: FormState; setForm: SetFormState }) {
  const fallback = defaultToolLoading(form.role, form.model);
  const label = (v: string) => TOOL_LOADING_OPTIONS.find((o) => o.value === v)?.label ?? v;
  const active = TOOL_LOADING_OPTIONS.find((o) => o.value === (form.toolLoading ?? fallback));
  return (
    <Field>
      <FieldLabel htmlFor="toolLoading">Tool loading</FieldLabel>
      <Select
        value={form.toolLoading ?? TOOL_LOADING_DEFAULT}
        onValueChange={(v) => setForm((f) => ({ ...f, toolLoading: parseToolLoading(v) }))}
      >
        <SelectTrigger id="toolLoading" className="w-64" aria-describedby={hintId('toolLoading')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TOOL_LOADING_DEFAULT}>Default ({label(fallback)})</SelectItem>
          {TOOL_LOADING_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldHint id="toolLoading">{active?.hint}</FieldHint>
    </Field>
  );
}

/** The Memory tab's tuning fieldset — replay window, recall limits, and the
 *  role-specific extractor / summarizer knobs. */
/** The corpus map budget with a live token estimate (lib/token-estimate). */
function CorpusMapCharsField({
  form,
  setForm,
  error,
}: {
  form: FormState;
  setForm: SetFormState;
  error?: string;
}) {
  const typed = Number(form.corpusMapChars.trim());
  const chars =
    form.corpusMapChars.trim() && Number.isFinite(typed) && typed > 0
      ? typed
      : CORPUS_MAP_DEFAULT_CHARS;
  // Rounded to tens: the estimate is not precise enough for more digits.
  const tokens = Math.round(estimateTokens(chars, CORPUS_MAP_CHARS_PER_TOKEN) / 10) * 10;
  const describedBy = error
    ? `corpusMapChars-error ${hintId('corpusMapChars')}`
    : hintId('corpusMapChars');
  return (
    <Field data-invalid={!!error || undefined} className="sm:max-w-sm">
      <FieldLabel htmlFor="corpusMapChars">Corpus map size (characters)</FieldLabel>
      <div className="flex items-center gap-3">
        <Input
          id="corpusMapChars"
          type="number"
          inputMode="numeric"
          value={form.corpusMapChars}
          onChange={(e) => setForm((f) => ({ ...f, corpusMapChars: e.target.value }))}
          placeholder={`${CORPUS_MAP_DEFAULT_CHARS} (default)`}
          min={CORPUS_MAP_MIN_CHARS}
          max={CORPUS_MAP_MAX_CHARS}
          step={500}
          aria-invalid={!!error || undefined}
          aria-describedby={describedBy}
        />
        <span
          className="shrink-0 text-sm text-muted-foreground tabular-nums"
          aria-live="polite"
          data-testid="corpus-map-tokens"
        >
          about {tokens.toLocaleString('en-US')} tokens
        </span>
      </div>
      {error ? <FieldError id="corpusMapChars-error">{error}</FieldError> : null}
      <FieldHint
        id="corpusMapChars"
        warn="It is sent on every turn, so each 1,000 characters costs about 300 tokens a turn."
      >
        The overview of what the brain holds (pages, tables, files, notes, tasks) sent with each
        message. Empty = the default, {CORPUS_MAP_DEFAULT_CHARS.toLocaleString('en-US')} characters.
        Tokens are an estimate: characters ÷ {CORPUS_MAP_CHARS_PER_TOKEN}, measured on real maps,
        which are mostly ids, counts and short titles (prose is nearer 4). The provider&apos;s
        tokenizer decides the real count.
      </FieldHint>
    </Field>
  );
}

export function MemorySection({
  form,
  setForm,
  errors,
}: {
  form: FormState;
  setForm: SetFormState;
  errors?: AgentErrors;
}) {
  return (
    <fieldset className="space-y-3 rounded-md border border-border p-3">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Memory
      </legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="historyLimit">Turns to replay</FieldLabel>
          <Input
            id="historyLimit"
            type="number"
            value={form.historyLimit}
            onChange={(e) => setForm((f) => ({ ...f, historyLimit: e.target.value }))}
            min={0}
            step={1}
            aria-describedby={hintId('historyLimit')}
          />
          {form.role === 'summarizer' ? (
            <FieldHint id="historyLimit">Unused for summarizers — leave at 0.</FieldHint>
          ) : (
            <FieldHint id="historyLimit" warn="Every replayed turn is re-billed on each request.">
              How much of the recent conversation is re-sent with each new message. 20 is plenty.
            </FieldHint>
          )}
        </Field>
        <Field>
          <FieldLabel htmlFor="historyWindowHours">Time window (hours)</FieldLabel>
          <Input
            id="historyWindowHours"
            type="number"
            value={form.historyWindowHours}
            onChange={(e) => setForm((f) => ({ ...f, historyWindowHours: e.target.value }))}
            placeholder="(none — count only)"
            min={0}
            step={0.5}
            aria-describedby={hintId('historyWindowHours')}
          />
          <FieldHint id="historyWindowHours">
            Also drop replayed turns older than this, so an idle chat starts fresh. Blank = go by
            count alone.
          </FieldHint>
        </Field>
      </div>

      {(form.role === 'responder' || form.role === 'assistant') && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field>
            <FieldLabel htmlFor="digestLimit">Digests</FieldLabel>
            <Input
              id="digestLimit"
              type="number"
              value={form.digestLimit}
              onChange={(e) => setForm((f) => ({ ...f, digestLimit: e.target.value }))}
              min={0}
              step={1}
              aria-describedby={hintId('digestLimit')}
            />
            <FieldHint id="digestLimit">
              Rollups of older conversation pulled in for background. Default 3.
            </FieldHint>
          </Field>
          <Field>
            <FieldLabel htmlFor="factLimit">Facts</FieldLabel>
            <Input
              id="factLimit"
              type="number"
              value={form.factLimit}
              onChange={(e) => setForm((f) => ({ ...f, factLimit: e.target.value }))}
              min={0}
              step={1}
              aria-describedby={hintId('factLimit')}
            />
            <FieldHint id="factLimit" warn="Too many and the relevant ones get lost in the noise.">
              Extracted facts matched against the incoming message. Default 10.
            </FieldHint>
          </Field>
          <Field>
            <FieldLabel htmlFor="contentHitLimit">Content hits</FieldLabel>
            <Input
              id="contentHitLimit"
              type="number"
              value={form.contentHitLimit}
              onChange={(e) => setForm((f) => ({ ...f, contentHitLimit: e.target.value }))}
              min={0}
              step={1}
              aria-describedby={hintId('contentHitLimit')}
            />
            <FieldHint id="contentHitLimit" warn="Each hit is a full passage — these add up fast.">
              Passages from your notes and files pulled in for the question. Default 3.
            </FieldHint>
          </Field>
        </div>
      )}

      {(form.role === 'responder' || form.role === 'assistant') && (
        <CorpusMapCharsField form={form} setForm={setForm} error={errors?.corpusMapChars} />
      )}

      {form.role === 'extractor' && (
        <div className="space-y-3">
          <Field>
            <FieldLabel>Node types to process</FieldLabel>
            <NodeTypePicker
              value={form.extractTypes}
              onChange={(v) => setForm((f) => ({ ...f, extractTypes: v }))}
            />
            <FieldHint warn="Every extra type means another LLM pass on every matching node at ingest.">
              Click a chip to toggle. <strong>all types</strong> is a wildcard — matches every node
              type the extractor sees, so the specific chips become redundant when it&apos;s on. Add
              a custom type if you&apos;ve introduced a new node kind. <code>branch</code> and{' '}
              <code>secret</code> are HARD-SKIPPED regardless of this setting.
            </FieldHint>
          </Field>
          {/* Was a raw `<input type="checkbox">` carrying no focus ring and
              none of the theme's states (§6d). */}
          <Field orientation="horizontal">
            <Checkbox
              id="extractFacts"
              checked={form.extractFacts}
              onCheckedChange={(v) => setForm((f) => ({ ...f, extractFacts: v === true }))}
            />
            <FieldLabel htmlFor="extractFacts" className="cursor-pointer font-normal">
              Extract facts (uncheck for content_index population only)
            </FieldLabel>
          </Field>
          <Field>
            <FieldLabel htmlFor="extractCostCapCents">Cost cap per run (¢)</FieldLabel>
            <Input
              id="extractCostCapCents"
              type="number"
              step={0.1}
              min={0}
              value={form.extractCostCapCents}
              onChange={(e) => setForm((f) => ({ ...f, extractCostCapCents: e.target.value }))}
              placeholder="(none — unlimited)"
              aria-describedby={hintId('extractCostCapCents')}
            />
            <FieldHint
              id="extractCostCapCents"
              warn="Left blank there is no ceiling — a big import can run up a real bill."
            >
              Once trace cost crosses this, the fact-processing loop bails gracefully. Summary +
              entity reconciliation still run.
            </FieldHint>
          </Field>
        </div>
      )}

      {form.role === 'summarizer' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="summarizeThreshold">Trigger threshold</FieldLabel>
            <Input
              id="summarizeThreshold"
              type="number"
              value={form.summarizeThreshold}
              onChange={(e) => setForm((f) => ({ ...f, summarizeThreshold: e.target.value }))}
              min={1}
              step={1}
              aria-describedby={hintId('summarizeThreshold')}
            />
            <FieldHint
              id="summarizeThreshold"
              warn="Set it low and the summarizer fires constantly."
            >
              Undigested turns per chat before summarization fires. Default 30.
            </FieldHint>
          </Field>
          <Field>
            <FieldLabel htmlFor="summarizeBatch">Batch size</FieldLabel>
            <Input
              id="summarizeBatch"
              type="number"
              value={form.summarizeBatch}
              onChange={(e) => setForm((f) => ({ ...f, summarizeBatch: e.target.value }))}
              min={1}
              step={1}
              aria-describedby={hintId('summarizeBatch')}
            />
            <FieldHint
              id="summarizeBatch"
              warn="Fold in too many at once and the digest turns vague."
            >
              How many of the oldest turns to fold into one digest. Default 20.
            </FieldHint>
          </Field>
        </div>
      )}
    </fieldset>
  );
}

/** ── Backup chat route (failover) ──────────────────────────────
 *  Unlike embeddings, a chat backup may be a DIFFERENT provider +
 *  model — there's no vector-space lock. When failover is on and
 *  the primary is unreachable (route-down / 429 / 5xx), the
 *  responder/assistant/heartbeat loop answers here (sticky for the
 *  rest of that turn). See docs/chat-failover.md. */
export function BackupRouteSection({
  form,
  setForm,
  apiKeys,
  tailnetPeers,
  catalog,
}: {
  form: FormState;
  setForm: SetFormState;
  apiKeys: ApiKeyOption[];
  /** Online tailnet peer MagicDNS names — passed through to RouteHostFields. */
  tailnetPeers: string[];
  /** Backup-route model catalog (keyed on form.backupProvider; fetched by the
   *  parent). One value, not a list plus a separate state object that has to be
   *  kept in step with it. */
  catalog: ModelCatalog;
}) {
  // "Make backup primary" — exchange the primary↔backup form values. The
  // runtime always treats the primary columns as the active route, so this
  // pure value-swap is the whole switch (mirrors the embedding page + the
  // documented chat-failover design). Only meaningful when a backup exists.
  const swapPrimaryBackup = () =>
    setForm((f) => ({
      ...f,
      provider: f.backupProvider || 'openrouter',
      model: f.backupModel,
      apiKeyId: f.backupApiKeyId,
      baseUrl: f.backupBaseUrl,
      viaTailnet: f.backupViaTailnet,
      backupProvider: f.provider,
      backupModel: f.model,
      backupApiKeyId: f.apiKeyId,
      backupBaseUrl: f.baseUrl,
      backupViaTailnet: f.viaTailnet,
    }));

  return (
    <fieldset className="space-y-3 rounded-md border border-border p-3">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Backup route
      </legend>
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <FieldLabel htmlFor="backupEnabled" className="cursor-pointer">
            Enable failover
          </FieldLabel>
          <FieldHint id="backupEnabled">
            On a route-down / 429 / 5xx from the primary, fall over to a backup route. May be a
            different provider + model — that&apos;s what enables a local primary with a cloud
            safety net (or the reverse).
          </FieldHint>
        </div>
        <Switch
          id="backupEnabled"
          checked={form.backupEnabled}
          onCheckedChange={(v) => setForm((f) => ({ ...f, backupEnabled: v }))}
        />
      </div>

      {form.backupEnabled && (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              The <strong>primary</strong> above is always the active route. Swap to promote this
              backup.
            </p>
            <Button type="button" variant="outline" size="sm" onClick={swapPrimaryBackup}>
              <ArrowLeftRight />
              Make backup primary
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="backupProvider">Provider</FieldLabel>
              {(() => {
                const chatProviders = providersForCapability('chat');
                return (
                  <>
                    <Select
                      value={form.backupProvider}
                      onValueChange={(v) => setForm((f) => ({ ...f, backupProvider: v }))}
                    >
                      <SelectTrigger
                        id="backupProvider"
                        aria-describedby={hintId('backupProvider')}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {chatProviders.map((p) => {
                          const wired = isProviderWired(p.id, 'chat');
                          return (
                            <SelectItem key={p.id} value={p.id}>
                              {p.label}
                              {wired ? '' : ' · not yet wired'}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    <FieldHint id="backupProvider">
                      Who answers when the primary route is down.
                    </FieldHint>
                    {!isProviderWired(form.backupProvider, 'chat') && (
                      <p className="text-xs text-warning-ink">
                        No chat adapter registered for <code>{form.backupProvider}</code> — failover
                        to it will fail until one ships.
                      </p>
                    )}
                  </>
                );
              })()}
            </Field>
            <Field>
              <FieldLabel htmlFor="backupApiKey">API key</FieldLabel>
              {(() => {
                const eligibleBackupKeys = apiKeys.filter((k) => k.service === form.backupProvider);
                return (
                  <>
                    <Select
                      // "no key" is a real choice for a local route, so it keeps
                      // an item rather than becoming a placeholder — on the NONE
                      // sentinel, because Radix forbids an empty item value.
                      value={form.backupApiKeyId || NONE}
                      onValueChange={(v) =>
                        setForm((f) => ({ ...f, backupApiKeyId: v === NONE ? '' : v }))
                      }
                    >
                      <SelectTrigger id="backupApiKey">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>
                          {form.backupProvider === 'local'
                            ? 'None (keyless / local)'
                            : '— select a key —'}
                        </SelectItem>
                        {eligibleBackupKeys.map((k) => (
                          <SelectItem key={k.id} value={k.id}>
                            {k.service} / {k.label} ({k.masked})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {apiKeys.length > 0 &&
                      eligibleBackupKeys.length === 0 &&
                      form.backupProvider !== 'local' && (
                        <p className="text-xs text-warning-ink">
                          None of your saved keys are for <code>{form.backupProvider}</code>.
                        </p>
                      )}
                  </>
                );
              })()}
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="backupModel">Model</FieldLabel>
            <ModelSelect
              id="backupModel"
              value={form.backupModel}
              onValueChange={(next) => setForm((f) => ({ ...f, backupModel: next }))}
              models={catalog.models}
              loading={catalog.loading}
              error={catalog.error}
              placeholder="— pick a model —"
              emptyMessage="No matching models in the catalog."
            />
            <FieldHint id="backupModel">
              Needn&apos;t match the primary — a cheaper or smaller model is fine here, since it
              only runs when the primary is down.
            </FieldHint>
          </Field>
          {(form.backupProvider === 'local' || form.backupProvider === 'custom') && (
            <RouteHostFields
              idPrefix="backup"
              provider={form.backupProvider}
              baseUrl={form.backupBaseUrl}
              viaTailnet={form.backupViaTailnet}
              peers={tailnetPeers}
              onBaseUrl={(v) => setForm((f) => ({ ...f, backupBaseUrl: v }))}
              onViaTailnet={(v) => setForm((f) => ({ ...f, backupViaTailnet: v }))}
            />
          )}
        </>
      )}
    </fieldset>
  );
}

/** Per-route host controls for a `local` or `custom` chat route (migration
 *  0063). For `local`, `baseUrl` overrides the localhost default (point it at a
 *  LAN/tailnet box) and `viaTailnet` routes through the bundled Tailscale proxy.
 *  For `custom` (a cloud OpenAI-compatible endpoint) the Base URL is REQUIRED and
 *  there is no localhost default or tailnet routing — so the peer autocomplete
 *  and the Tailscale toggle are hidden. Rendered only for those two providers;
 *  every other provider has a fixed endpoint. */
export function RouteHostFields({
  idPrefix,
  provider,
  baseUrl,
  viaTailnet,
  peers = [],
  onBaseUrl,
  onViaTailnet,
}: {
  idPrefix: string;
  provider: 'local' | 'custom';
  baseUrl: string;
  viaTailnet: boolean;
  /** Online tailnet peer MagicDNS names — surfaced as base-URL autocomplete. */
  peers?: string[];
  onBaseUrl: (v: string) => void;
  onViaTailnet: (v: boolean) => void;
}) {
  const isCustom = provider === 'custom';
  const listId = `${idPrefix}-tailnet-peers`;
  return (
    <div className="space-y-3 rounded-md border border-dashed border-border p-3">
      <Field>
        <FieldLabel htmlFor={`${idPrefix}BaseUrl`}>
          Base URL{isCustom && <span className="text-muted-foreground"> (required)</span>}
        </FieldLabel>
        <Input
          id={`${idPrefix}BaseUrl`}
          value={baseUrl}
          onChange={(e) => onBaseUrl(e.target.value)}
          placeholder={
            isCustom
              ? 'https://api.your-provider.com/v1'
              : 'blank = http://localhost:11434/v1 (Ollama default)'
          }
          list={!isCustom && peers.length > 0 ? listId : undefined}
        />
        {!isCustom && peers.length > 0 && (
          // Suggest tailnet peers as `http://<name>:PORT/v1`. Free-text still
          // works; this is just autocomplete when a tailnet is up.
          <datalist id={listId}>
            {peers.map((p) => (
              <option key={p} value={`http://${p}:1234/v1`} />
            ))}
          </datalist>
        )}
        {isCustom ? (
          <p className="text-xs text-muted-foreground">
            The provider&apos;s OpenAI-compatible root — e.g.{' '}
            <code>https://api.z.ai/api/paas/v4</code> (Z.ai/GLM) or{' '}
            <code>https://api.deepinfra.com/v1/openai</code>. We append{' '}
            <code>/chat/completions</code>, so include any version segment.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Where this <code>local</code> route&apos;s server lives — e.g.{' '}
            <code>http://gemma-box:11434/v1</code> (Ollama) or{' '}
            <code>http://192.168.0.50:1234/v1</code> (LM Studio). Blank uses the{' '}
            <code>MANTLE_LOCAL_CHAT_URL</code> env / localhost default.
            {peers.length > 0 && ' Tailnet devices are suggested as you type.'}
          </p>
        )}
      </Field>
      {!isCustom && (
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <FieldLabel htmlFor={`${idPrefix}ViaTailnet`} className="cursor-pointer">
              Reach via Tailscale
            </FieldLabel>
            <p className="text-xs text-muted-foreground">
              Route this request through the bundled Tailscale proxy so the Base URL (a MagicDNS
              name) reaches a box behind NAT. Inert until Tailscale is activated under Settings &gt;
              Local network.
            </p>
          </div>
          <Switch
            id={`${idPrefix}ViaTailnet`}
            checked={viaTailnet}
            onCheckedChange={onViaTailnet}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Chip multi-select for node types. The form state is still a
 * comma-separated string so the save path stays unchanged; this is
 * just a friendlier surface over it.
 */
function NodeTypePicker({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const selected = new Set(
    value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const [customDraft, setCustomDraft] = useState('');

  // Render known types first (in their fixed order), then any custom
  // values not already in the known set.
  const known = KNOWN_NODE_TYPES;
  const customs = Array.from(selected).filter(
    (t) => t !== '*' && !known.includes(t as (typeof KNOWN_NODE_TYPES)[number]),
  );

  const commit = (next: Set<string>) => {
    onChange(Array.from(next).join(','));
  };

  const toggle = (t: string) => {
    const next = new Set(selected);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    commit(next);
  };

  const addCustom = () => {
    const t = customDraft
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_');
    if (!t) return;
    const next = new Set(selected);
    next.add(t);
    commit(next);
    setCustomDraft('');
  };

  const wildcardOn = selected.has('*');

  // Chip styling: selection is marked by an ACCENT (primary border + a faint
  // accent tint), never a solid background fill. A saturated fill (the old
  // bg-primary / bg-emerald / bg-amber) drowns the chip label and any muted
  // text in many of the ~40 themes — the readability bug we're fixing. All
  // token-based (no hardcoded emerald/amber) so it tracks the active theme.
  const chipBase = 'rounded-full border px-2.5 py-0.5 text-xs transition';
  const chipOff =
    'border-input bg-transparent text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground';
  // On = a primary BORDER, no background fill — a saturated bg drowns the label
  // in many themes (content text is foreground, not accent-foreground).
  const chipOn = 'border-primary bg-background text-foreground';
  // Implicitly on because the wildcard covers it — same accent family, but
  // de-emphasized (dashed border, muted label) so an explicit pick still reads
  // distinctly from "covered by all types".
  const chipCovered = 'border-dashed border-primary/50 bg-background text-muted-foreground';

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {/* Wildcard chip: matches any non-HARD_SKIP type. When on, the
            specific chips below stay clickable (additive — clicking one
            just turns off the wildcard for clarity). */}
        <RowButton
          onClick={() => toggle('*')}
          className={cn(chipBase, 'font-medium', wildcardOn ? chipOn : chipOff)}
          title="Wildcard — match every non-secret, non-branch node type"
        >
          all types
        </RowButton>
        {known.map((t) => {
          const on = selected.has(t) || wildcardOn;
          return (
            <RowButton
              key={t}
              onClick={() => toggle(t)}
              className={cn(
                chipBase,
                'font-mono',
                wildcardOn ? chipCovered : on ? chipOn : chipOff,
              )}
              title={wildcardOn ? 'covered by "all types"' : undefined}
            >
              {t}
            </RowButton>
          );
        })}
        {customs
          .filter((t) => t !== '*')
          .map((t) => (
            <RowButton
              key={t}
              onClick={() => toggle(t)}
              className={cn(chipBase, 'font-mono', chipOn)}
              title="Custom type — click to remove"
            >
              {t} ✕
            </RowButton>
          ))}
      </div>
      <div className="flex gap-1.5">
        <Input
          value={customDraft}
          onChange={(e) => setCustomDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addCustom();
            }
          }}
          placeholder="add custom type"
          className="h-7 text-xs"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addCustom}
          disabled={!customDraft.trim()}
        >
          Add
        </Button>
      </div>
    </div>
  );
}
