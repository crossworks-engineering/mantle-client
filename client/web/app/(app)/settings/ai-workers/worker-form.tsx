'use client';

/**
 * Shared form for creating and editing ai_workers. Renders the right
 * field set based on `kind`. The submit handler delegates to the
 * passed-in action — the wrapper page provides either create or update.
 *
 * Why a single component for both create/edit: the field set is the
 * same; the only difference is whether `id` exists. Splitting into two
 * components would mean two parallel field renderers to maintain.
 */

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeftRight, RefreshCw } from 'lucide-react';
import type { AiWorkerDTO, AiWorkerKind } from '@mantle/client-types';
import {
  CAPABILITY_FOR_KIND,
  getProvider,
  isProviderId,
  isProviderWired,
  providersForCapability,
  type ChatModelInfo,
  type ImageGenModelInfo,
  type SttModelInfo,
  type TtsModelInfo,
  type VisionModelInfo,
} from '@mantle/voice-client';
import { Button } from '@mantle/web-ui/ui/button';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { Input } from '@mantle/web-ui/ui/input';
import { Field, FieldError, FieldLabel } from '@mantle/web-ui/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@mantle/web-ui/ui/select';
import { FieldHint, hintId } from '@mantle/web-ui/ui/field-hint';
import { Switch } from '@mantle/web-ui/ui/switch';
import { CuratedPoolSelect } from '@/components/curated-pool-select';
import { ModelSelect } from '@/components/ui/model-select';
import { useToast } from '@mantle/web-ui/ui/toast';
import type { ExplorerModel } from '@mantle/client-types';
import { apiSend } from '@mantle/web-ui/api-fetch';
import { TtsTestButton } from './tts-test-button';
import { SttTestButton } from './stt-test-button';
import { ChatTestButton } from '@/components/settings/chat-test-button';
import { VisionTestButton } from './vision-test-button';
import { DocumentTestButton } from './document-test-button';
import { ImageGenTestButton } from './image-gen-test-button';
import { DecisionTestButton } from './decision-test-button';
import { DeciderFields } from './worker-fields-decider';
import { SttFields, TtsFields } from './worker-fields-speech';
import { DocumentFields, ImageGenFields, VisionFields } from './worker-fields-media';
import { COLUMN_DIMS, EmbeddingFields } from './worker-fields-embedding';
import { useOpenRouterPricing } from './use-openrouter-pricing';
import {
  NONE,
  PROVIDER_FOR_KIND,
  toExplorerModels,
  validateWorker,
  staticCatalogFor,
} from './worker-form-state';
import type { KeyOption, WorkerErrors } from './worker-form-state';
import { LlmWorkerFields } from './worker-fields-llm';
import { KeyValidityHint, RouteHostFields } from './worker-route-fields';
import { play } from '@/lib/sounds/play';

type Props = {
  mode: 'create' | 'edit';
  kind: AiWorkerKind;
  worker?: AiWorkerDTO;
  keys: KeyOption[];
  action: (formData: FormData) => Promise<void>;
  /** Controlled by the parent (rendered as header switches). Injected into
   *  the submitted FormData so the server actions stay unchanged. */
  enabled: boolean;
  isDefault: boolean;
  /** Provider ids whose vision adapter reads PDFs natively (derived from the
   *  adapter registry, server-side). Drives the Document-worker provider badge
   *  — non-native providers rasterize at ingest. */
  nativeDocProviders: string[];
  /** Online tailnet peer MagicDNS names — backs the route base-URL datalist
   *  when a tailnet is up. Empty otherwise (input stays free-text). */
  tailnetPeers?: string[];
};

const MODEL_HINT_FOR_KIND: Record<AiWorkerKind, string> = {
  reflector: 'anthropic/claude-haiku-4.5',
  extractor: 'anthropic/claude-haiku-4.5',
  summarizer: 'anthropic/claude-haiku-4.5',
  // gpt-4o-mini-tts (May 2026) is the recommended default — 13 voices,
  // supports style instructions. The legacy tts-1 / tts-1-hd are still
  // available for cheaper or higher-fidelity fallback.
  tts: 'gpt-4o-mini-tts',
  stt: 'whisper-1',
  vision: 'openai/gpt-4o',
  document: 'claude-sonnet-5',
  image_gen: 'dall-e-3',
  // 768-dim local default (migration 0060), keyless via Ollama — the
  // brain's current column shape. Anything else either matches 768 or
  // requires a re-embed pass — the form's dim guard will warn.
  embedding: 'embeddinggemma:latest',
  search: 'perplexity/sonar',
  search_advanced: 'perplexity/sonar-pro',
  // Cheap + fast — it runs once per tool step, off the critical path.
  narrator: 'google/gemini-3.1-flash-lite',
  // Cheap + fast: one short question per turn, off the critical path.
  suggester: 'google/gemini-3.1-flash-lite',
  // The only typed-decision model on OpenRouter (alpha decisions endpoint).
  decider: 'typesafe/jev-1.13',
};

export function WorkerForm({
  mode,
  kind,
  worker,
  keys,
  action,
  enabled,
  isDefault,
  nativeDocProviders,
  tailnetPeers = [],
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<WorkerErrors>({});
  // Only complain AFTER a submit has failed — a brand-new worker should not
  // open marked red.
  const [submitted, setSubmitted] = useState(false);
  // Embedding-kind only: lifted from EmbeddingFields so the save button
  // can disable itself when the picked model emits a dim that doesn't
  // fit the brain's vector(768) column. Null = unknown (untested,
  // unlisted), 768 = compatible, anything else = save blocked.
  const [embeddingDim, setEmbeddingDim] = useState<number | null>(null);

  const params = (worker?.params ?? {}) as Record<string, unknown>;

  // Identity state — lifted out of uncontrolled defaults so the
  // model dropdown can react to api-key changes and so the voice
  // dropdown can react to model changes. Without controlled inputs
  // for these, switching keys wouldn't trigger re-discovery.
  const [apiKeyId, setApiKeyId] = useState<string>(worker?.apiKeyId ?? '');
  const [model, setModel] = useState<string>(worker?.model ?? '');
  const [provider, setProvider] = useState<string>(worker?.provider ?? PROVIDER_FOR_KIND[kind]);

  // Backup chat route (chat-shaped workers only). Unlike embeddings, a chat
  // backup may be a DIFFERENT provider + model — the enabler for a local
  // primary with a cloud safety net. Submitted as backup_* form fields and
  // parsed in actions.ts. Free-text model id (the operator knows the backup's
  // slug; we don't run a second discovery pass for it).
  const [backupEnabled, setBackupEnabled] = useState<boolean>(worker?.backupEnabled ?? false);
  const [backupProvider, setBackupProvider] = useState<string>(
    worker?.backupProvider ?? 'openrouter',
  );
  const [backupModel, setBackupModel] = useState<string>(worker?.backupModel ?? '');
  const [backupApiKeyId, setBackupApiKeyId] = useState<string>(worker?.backupApiKeyId ?? '');
  // Per-route host + tailnet flag (migration 0063). Shown only for `local`
  // routes — a self-hosted/LAN/tailnet box. Submitted as base_url/via_tailnet
  // (primary) + backup_base_url/backup_via_tailnet.
  const [baseUrl, setBaseUrl] = useState<string>(worker?.baseUrl ?? '');
  const [viaTailnet, setViaTailnet] = useState<boolean>(worker?.viaTailnet ?? false);
  const [backupBaseUrl, setBackupBaseUrl] = useState<string>(worker?.backupBaseUrl ?? '');
  const [backupViaTailnet, setBackupViaTailnet] = useState<boolean>(
    worker?.backupViaTailnet ?? false,
  );

  // Filtered provider list — only providers that support this worker's
  // kind appear in the dropdown. Adding a new provider is a one-line
  // change to SUPPORTED_PROVIDERS in @mantle/voice; the UI picks it
  // up automatically. The `!` is safe: every AiWorkerKind has an
  // entry in CAPABILITY_FOR_KIND (proven by providers.test.ts).
  const capability = CAPABILITY_FOR_KIND[kind]!;
  const catalogProviders = providersForCapability(capability);

  // Post-Phase-3: every kind dispatches through the adapter registry
  // and the worker's provider field actually controls runtime routing.
  // The form lists every provider in the catalog that declares the
  // kind's capability; the runtime resolves the adapter via
  // getXxxAdapter(worker.provider) at call time. Adapters that
  // haven't been wired yet show as "not yet wired" via isProviderWired
  // (see the dropdown render below). The legacy RUNTIME_OR_ONLY_KINDS
  // clamp went away with 3a (chat-shaped workers) + 3b (tool loop).
  const eligibleProviders = catalogProviders;
  const selectedProvider = eligibleProviders.find((p) => p.id === provider);

  // Filter the api-key dropdown to keys whose service matches the
  // capability's wired providers. KeyValidityHint surfaces the
  // "key is for service X but worker wants Y" mismatch when the
  // operator picks a provider the key doesn't cover.
  const eligibleProviderIds = new Set(eligibleProviders.map((p) => p.id as string));
  const eligibleKeys =
    eligibleProviderIds.size > 0 ? keys.filter((k) => eligibleProviderIds.has(k.service)) : keys;

  // Reactive model catalogue. For tts/stt/chat-shaped kinds we hit
  // the adapter's discoverModels when the api_key is selected; for
  // anything else we fall back to free-text input.
  //
  // "Chat-shaped" = reflector/extractor/summarizer (they make chat
  // completion calls). For those, we offer discovery only when the
  // worker's provider is one we have a chat adapter for — currently
  // xAI and Hugging Face. OpenRouter chat doesn't go through this
  // registry; the user types model ids by hand for OpenRouter.
  const chatShaped =
    kind === 'reflector' ||
    kind === 'extractor' ||
    kind === 'summarizer' ||
    kind === 'narrator' ||
    kind === 'suggester';
  // Whether to show a model dropdown (vs. free-text) is gated on the SAME
  // wired-provider table that drives the "not wired yet" hint — WIRED_PROVIDERS
  // from @mantle/voice (the static mirror of the adapter registry). One source
  // of truth, so the two can't drift (this duplicated four hand-kept Sets that
  // had already fallen behind — e.g. missing deepseek/local chat + local
  // embedding). tts/stt always discover (every key surfaces voices/models).
  const supportsDiscovery =
    kind === 'tts' ||
    kind === 'stt' ||
    (kind === 'vision' && isProviderWired(provider, 'vision')) ||
    (kind === 'document' && isProviderWired(provider, 'vision')) ||
    (kind === 'image_gen' && isProviderWired(provider, 'image_gen')) ||
    (chatShaped && isProviderWired(provider, 'chat')) ||
    (kind === 'embedding' && isProviderWired(provider, 'embedding'));

  // The initial model list rendered before live discovery returns
  // depends on which provider+kind we're configuring. Picking the
  // right static fallback per (kind, provider) means the dropdown
  // is never empty in create mode.
  const initialCatalog = staticCatalogFor(kind, provider);
  const [discovery, setDiscovery] = useState<{
    available: Array<
      TtsModelInfo | SttModelInfo | ChatModelInfo | VisionModelInfo | ImageGenModelInfo
    >;
    filtered: boolean;
    error: string | null;
    loading: boolean;
  }>(() => ({
    available: initialCatalog,
    filtered: false,
    error: null,
    loading: false,
  }));

  // See use-openrouter-pricing.ts for why a miss here is silent.
  const orPricing = useOpenRouterPricing();
  const explorerModels: ExplorerModel[] = useMemo(
    () => toExplorerModels(discovery.available, provider, orPricing),
    [discovery.available, provider, orPricing],
  );

  const refreshDiscovery = async (keyId: string, providerOverride?: string) => {
    // Decide which dispatch kind to hand to the action: 'chat' for
    // reflector/extractor/summarizer (they make chat calls), 'embedding'
    // routes to OR's keyless catalog (no api key needed), or the
    // worker kind directly for tts/stt/vision/image_gen. We bail out
    // cleanly if the worker kind isn't supported by discovery yet.
    const discoveryKind =
      // Documents discover through the vision adapter (same multimodal models).
      kind === 'document'
        ? 'vision'
        : kind === 'tts' || kind === 'stt' || kind === 'vision' || kind === 'image_gen'
          ? kind
          : kind === 'embedding'
            ? 'embedding'
            : chatShaped
              ? 'chat'
              : null;
    if (!discoveryKind) return;
    // Embedding discovery is keyless (OR's public catalog) — every other
    // kind needs the key to know which models the user can actually use.
    if (!keyId && discoveryKind !== 'embedding') return;
    setDiscovery((d) => ({ ...d, loading: true }));
    try {
      const r = await apiSend<{
        available: Array<
          TtsModelInfo | SttModelInfo | ChatModelInfo | VisionModelInfo | ImageGenModelInfo
        >;
        filtered: boolean;
        error: string | null;
      }>('/api/ai-workers/models', 'POST', {
        apiKeyId: keyId,
        kind: discoveryKind,
        providerId: providerOverride ?? provider,
      });
      setDiscovery({
        available: r.available,
        filtered: r.filtered,
        error: r.error,
        loading: false,
      });
    } catch (err) {
      setDiscovery((d) => ({
        ...d,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
        filtered: false,
      }));
    }
  };

  // On first mount, fire discovery if we have a key (edit mode) OR if
  // the kind is `embedding` — that path is keyless against OR's public
  // embeddings catalog, so we can populate the picker before any key
  // selection happens.
  useEffect(() => {
    if (apiKeyId || kind === 'embedding') void refreshDiscovery(apiKeyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-discover when the provider changes — different providers have
  // different model-listing surfaces. If no api key is selected yet
  // we still want the dropdown to reflect the new provider, so swap
  // to that provider's static catalog as a stopgap until the user
  // picks a key and live discovery runs. Embedding's keyless path
  // means we DON'T need to wait for the key here.
  useEffect(() => {
    if (apiKeyId || kind === 'embedding') {
      void refreshDiscovery(apiKeyId, provider);
    } else {
      setDiscovery({
        available: staticCatalogFor(kind, provider),
        filtered: false,
        error: null,
        loading: false,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  // What the submit handler and the after-a-failure revalidation both need.
  // `base_url` is React state rather than an input value, so it is stamped in
  // before the rules read the FormData.
  const needsBaseUrl = chatShaped && provider === 'custom';
  const collect = (formEl: HTMLFormElement) => {
    const fd = new FormData(formEl);
    fd.set('base_url', baseUrl.trim());
    return fd;
  };

  return (
    <form
      noValidate
      // ONE handler instead of `onChange` on all thirty-odd controls: input
      // events bubble to the form, so a field that has been fixed stops
      // complaining as soon as it is. Does nothing until a submit has failed.
      onChange={(e) => {
        if (!submitted) return;
        setErrors(validateWorker(collect(e.currentTarget), { needsBaseUrl }));
      }}
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const fd = collect(e.currentTarget);
        const errs = validateWorker(fd, { needsBaseUrl });
        setSubmitted(true);
        setErrors(errs);
        const first = (['name', 'model', 'primary_base_url_input'] as const).find((k) => errs[k]);
        if (first) {
          document.getElementById(first)?.focus();
          return;
        }
        fd.set('kind', kind);
        fd.set('enabled', enabled ? 'on' : 'off');
        fd.set('isDefault', isDefault ? 'on' : 'off');
        // Backup chat route (chat-shaped workers). Always send all four so
        // toggling failover off or clearing a field actually persists.
        if (chatShaped) {
          fd.set('backup_enabled', backupEnabled ? 'on' : 'off');
          fd.set('backup_provider', backupProvider.trim());
          fd.set('backup_model', backupModel.trim());
          fd.set('backup_api_key_id', backupApiKeyId);
          // Per-route host + tailnet flag (migration 0063).
          fd.set('base_url', baseUrl.trim());
          fd.set('via_tailnet', viaTailnet ? 'on' : 'off');
          fd.set('backup_base_url', backupBaseUrl.trim());
          fd.set('backup_via_tailnet', backupViaTailnet ? 'on' : 'off');
        }
        startTransition(async () => {
          try {
            await action(fd);
            play('success');
            if (mode === 'edit') toast.success('Saved');
          } catch (err) {
            // Next's `redirect()` inside a server action throws a
            // sentinel error with `digest` starting with 'NEXT_REDIRECT'
            // — the framework catches it at the boundary and performs
            // the navigation. If we swallow it here, the redirect never
            // happens and the user sees a useless "NEXT_REDIRECT" toast.
            // Re-throw so React/Next can do its thing.
            // Same goes for 'NEXT_NOT_FOUND'.
            const digest = (err as { digest?: string } | null)?.digest;
            if (
              typeof digest === 'string' &&
              (digest.startsWith('NEXT_REDIRECT') || digest === 'NEXT_NOT_FOUND')
            ) {
              throw err;
            }
            play('danger');
            const msg = err instanceof Error ? err.message : String(err);
            setError(msg);
            toast.error(msg);
          }
        });
      }}
      className="space-y-6"
    >
      {/* ── Identity ─────────────────────────────────────────────── */}
      <section className="space-y-4">
        <Field data-invalid={!!errors.name || undefined}>
          <FieldLabel htmlFor="name">Name</FieldLabel>
          <Input
            id="name"
            name="name"
            defaultValue={worker?.name ?? ''}
            placeholder="e.g. Saskia's voice"
            required
            aria-invalid={!!errors.name || undefined}
            aria-describedby={errors.name ? `name-error ${hintId('name')}` : hintId('name')}
          />
          <FieldHint id="name">
            Display label only. The system uses the auto-generated slug for lookups.
          </FieldHint>
          <FieldError id="name-error">{errors.name}</FieldError>
        </Field>

        {/* Provider + key side by side; the model picker gets its own
            full-width row below — mirrors the agents form layout. */}
        <div className="grid grid-cols-2 gap-4">
          <Field>
            <FieldLabel htmlFor="provider">Provider</FieldLabel>
            <input type="hidden" name="provider" value={provider} />
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger id="provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {eligibleProviders.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                    {p.isAggregator ? ' (aggregator)' : ''}
                    {!isProviderWired(p.id, capability) ? ' — not yet wired' : ''}
                    {kind === 'document' && !nativeDocProviders.includes(p.id)
                      ? ' — page-OCR fallback'
                      : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedProvider && (
              <p className="text-xs text-muted-foreground">
                {selectedProvider.description}{' '}
                <a
                  href={selectedProvider.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  docs →
                </a>
              </p>
            )}
            {selectedProvider && !isProviderWired(selectedProvider.id, capability) && (
              <p className="text-xs text-warning-ink">
                No adapter registered for <code>{selectedProvider.id}</code> ·{' '}
                <code>{capability}</code>. The UI saves the config, but calls will fail until we
                ship the dispatch code for this provider.
              </p>
            )}
          </Field>
          <Field>
            <FieldLabel htmlFor="apiKeyId">API key</FieldLabel>
            <input type="hidden" name="apiKeyId" value={apiKeyId} />
            <Select
              value={apiKeyId || NONE}
              onValueChange={(choice) => {
                const newKeyId = choice === NONE ? '' : choice;
                setApiKeyId(newKeyId);
                // Auto-derive the provider from the picked key's service.
                // Picking an OpenAI key while provider='anthropic' was the
                // common cause of "discovery failed, key invalid" errors —
                // a mismatch the form can fix for the operator. We only
                // override if the key's service matches a provider that
                // actually supports this kind's capability (defensive
                // against a stale or hand-edited DB row).
                const picked = newKeyId ? keys.find((k) => k.id === newKeyId) : null;
                if (picked && isProviderId(picked.service)) {
                  const p = getProvider(picked.service);
                  if (p && p.capabilities.includes(capability)) {
                    setProvider(picked.service);
                    void refreshDiscovery(newKeyId, picked.service);
                    return;
                  }
                }
                void refreshDiscovery(newKeyId);
              }}
            >
              <SelectTrigger id="apiKeyId" aria-describedby={hintId('apiKeyId')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— none —</SelectItem>
                {eligibleKeys.map((k) => (
                  <SelectItem key={k.id} value={k.id}>
                    {k.service}/{k.label} ({k.masked})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldHint id="apiKeyId">
              Which saved key pays for this worker. Picking one switches the provider to match.
            </FieldHint>
            <KeyValidityHint
              kind={kind}
              capability={capability}
              apiKeyId={apiKeyId}
              supportsDiscovery={supportsDiscovery}
              discovery={discovery}
              keysAvailable={keys.length > 0}
              eligibleKeysAvailable={eligibleKeys.length > 0}
              eligibleProviderLabels={eligibleProviders.map((p) => p.label)}
            />
          </Field>
        </div>

        <Field data-invalid={!!errors.model || undefined}>
          <FieldLabel htmlFor="model">Model</FieldLabel>
          {/* Curated quick pick for this worker kind — strict: only entries
              reachable through the CURRENTLY selected provider, so a pick can
              never leave the route half-switched. Renders nothing when the
              pool is empty or the brain predates /api/model-pools. */}
          <CuratedPoolSelect
            pool={kind}
            preferProviders={[provider]}
            strict
            onPick={(route) => setModel(route.model)}
          />
          {supportsDiscovery ? (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <ModelSelect
                    id="model"
                    name="model"
                    value={model}
                    onValueChange={setModel}
                    models={explorerModels}
                    loading={discovery.loading}
                    placeholder="— pick a model —"
                    emptyMessage="No models in this catalogue match."
                    required
                    aria-invalid={!!errors.model || undefined}
                    aria-describedby={errors.model ? 'model-error' : undefined}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!apiKeyId || discovery.loading}
                  onClick={() => void refreshDiscovery(apiKeyId)}
                  title="Re-query the provider for the latest model list"
                >
                  <RefreshCw className={discovery.loading ? 'animate-spin' : ''} />
                </Button>
              </div>
              {model && (
                <p className="text-xs text-muted-foreground">
                  {discovery.available.find((m) => m.id === model)?.description ??
                    'Custom model id — make sure your key has access.'}
                </p>
              )}
              {!discovery.filtered && discovery.error && apiKeyId && (
                <p className="text-xs text-warning-ink">
                  Couldn't verify which models this key can use ({discovery.error}). Showing the
                  full catalogue.
                </p>
              )}
              {discovery.filtered && discovery.available.length === 0 && (
                <p className="text-xs text-destructive-ink">
                  This key doesn't have access to any {kind === 'tts' ? 'TTS' : 'transcription'}{' '}
                  models. Check the key's project at platform.openai.com.
                </p>
              )}
            </div>
          ) : (
            <Input
              id="model"
              name="model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={MODEL_HINT_FOR_KIND[kind]}
              required
              aria-invalid={!!errors.model || undefined}
              aria-describedby={errors.model ? 'model-error' : undefined}
            />
          )}
          <FieldError id="model-error">{errors.model}</FieldError>
        </Field>
        {/* Primary route host (migration 0063) — chat-shaped `local` (self-
            hosted/LAN/tailnet) and `custom` (cloud OpenAI-compatible) routes both
            take a per-route Base URL. */}
        {chatShaped && (provider === 'local' || provider === 'custom') && (
          <RouteHostFields
            idPrefix="primary"
            provider={provider}
            baseUrl={baseUrl}
            viaTailnet={viaTailnet}
            peers={tailnetPeers}
            onBaseUrl={setBaseUrl}
            onViaTailnet={setViaTailnet}
            error={errors.primary_base_url_input}
          />
        )}
      </section>

      {/* ── Backup chat route (failover) ─────────────────────────────
          Chat-shaped workers only (reflector / extractor / summarizer).
          Unlike embeddings, a chat backup may be a DIFFERENT provider +
          model — when the primary is unreachable (route-down / 429 / 5xx)
          chatWithFailover answers here. See docs/chat-failover.md. */}
      {chatShaped && (
        <section className="space-y-4 border-t border-border pt-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Backup route
              </h2>
              <p className="text-xs text-muted-foreground">
                On a route-down / 429 / 5xx from the primary, fall over to a backup — may be a
                different provider + model (e.g. local primary, cloud fallback).
              </p>
            </div>
            <Switch
              id="backup_enabled"
              checked={backupEnabled}
              onCheckedChange={setBackupEnabled}
            />
          </div>

          {backupEnabled && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  The <strong>primary</strong> above is always the active route. Swap to promote
                  this backup.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    // Exchange primary↔backup values. The runtime always treats
                    // the primary fields as active, so this value-swap is the
                    // whole switch (mirrors the agents form + the failover design).
                    const p = provider;
                    const m = model;
                    const k = apiKeyId;
                    setProvider(backupProvider || 'openrouter');
                    setModel(backupModel);
                    setApiKeyId(backupApiKeyId);
                    setBackupProvider(p);
                    setBackupModel(m);
                    setBackupApiKeyId(k);
                  }}
                >
                  <ArrowLeftRight />
                  Make backup primary
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="backup_provider">Provider</FieldLabel>
                  <Select value={backupProvider} onValueChange={setBackupProvider}>
                    <SelectTrigger
                      id="backup_provider"
                      aria-describedby={hintId('backup_provider')}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {eligibleProviders.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.label}
                          {p.isAggregator ? ' (aggregator)' : ''}
                          {!isProviderWired(p.id, capability) ? ' — not yet wired' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldHint id="backup_provider">
                    Who serves this worker when the primary is unreachable.
                  </FieldHint>
                  {!isProviderWired(backupProvider, capability) && (
                    <p className="text-xs text-warning-ink">
                      No adapter registered for <code>{backupProvider}</code> — failover to it will
                      fail until one ships.
                    </p>
                  )}
                </Field>
                <Field>
                  <FieldLabel htmlFor="backup_api_key_id">API key</FieldLabel>
                  <Select
                    value={backupApiKeyId || NONE}
                    onValueChange={(v) => setBackupApiKeyId(v === NONE ? '' : v)}
                  >
                    <SelectTrigger id="backup_api_key_id">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>
                        {backupProvider === 'local' ? 'None (keyless / local)' : '— none —'}
                      </SelectItem>
                      {keys
                        .filter((k) => k.service === backupProvider)
                        .map((k) => (
                          <SelectItem key={k.id} value={k.id}>
                            {k.service}/{k.label} ({k.masked})
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="backup_model">Model</FieldLabel>
                <Input
                  id="backup_model"
                  value={backupModel}
                  onChange={(e) => setBackupModel(e.target.value)}
                  placeholder={MODEL_HINT_FOR_KIND[kind]}
                />
              </Field>
              {(backupProvider === 'local' || backupProvider === 'custom') && (
                <RouteHostFields
                  idPrefix="backup"
                  provider={backupProvider}
                  baseUrl={backupBaseUrl}
                  viaTailnet={backupViaTailnet}
                  peers={tailnetPeers}
                  onBaseUrl={setBackupBaseUrl}
                  onViaTailnet={setBackupViaTailnet}
                />
              )}
            </div>
          )}
        </section>
      )}

      {/* ── Kind-specific config ─────────────────────────────────── */}
      <section className="space-y-4 border-t border-border pt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {kind === 'tts' && 'Voice settings'}
          {kind === 'stt' && 'Transcription settings'}
          {kind === 'vision' && 'Vision settings'}
          {kind === 'document' && 'Document settings'}
          {kind === 'image_gen' && 'Image gen settings'}
          {kind === 'reflector' && 'Reflector settings'}
          {kind === 'extractor' && 'Extractor settings'}
          {kind === 'summarizer' && 'Summarizer settings'}
          {kind === 'narrator' && 'Narrator settings'}
          {kind === 'suggester' && 'Suggester settings'}
          {kind === 'embedding' && 'Embedding settings'}
          {kind === 'decider' && 'Decider settings (experimental)'}
        </h2>

        {kind === 'tts' && (
          <TtsFields params={params} model={model} provider={provider} apiKeyId={apiKeyId} />
        )}
        {kind === 'stt' && <SttFields params={params} />}
        {kind === 'vision' && <VisionFields params={params} systemPrompt={worker?.systemPrompt} />}
        {kind === 'document' && (
          <DocumentFields params={params} systemPrompt={worker?.systemPrompt} />
        )}
        {kind === 'image_gen' && <ImageGenFields params={params} />}
        {kind === 'reflector' && (
          <LlmWorkerFields
            params={params}
            systemPrompt={worker?.systemPrompt}
            kind="reflector"
            provider={provider}
          />
        )}
        {kind === 'extractor' && (
          <LlmWorkerFields
            params={params}
            systemPrompt={worker?.systemPrompt}
            kind="extractor"
            provider={provider}
          />
        )}
        {kind === 'summarizer' && (
          <LlmWorkerFields
            params={params}
            systemPrompt={worker?.systemPrompt}
            kind="summarizer"
            provider={provider}
          />
        )}
        {kind === 'narrator' && (
          <LlmWorkerFields
            params={params}
            systemPrompt={worker?.systemPrompt}
            kind="narrator"
            provider={provider}
          />
        )}
        {kind === 'suggester' && (
          <LlmWorkerFields
            params={params}
            systemPrompt={worker?.systemPrompt}
            kind="suggester"
            provider={provider}
          />
        )}
        {kind === 'embedding' && (
          <EmbeddingFields
            model={model}
            savedModel={worker?.model ?? null}
            onDimChange={setEmbeddingDim}
          />
        )}
        {kind === 'decider' && <DeciderFields params={params} />}
      </section>

      {/* ── Priority ─────────────────────────────────────────────── */}
      <section className="space-y-3 border-t border-border pt-6">
        <Field>
          <FieldLabel htmlFor="priority">Priority</FieldLabel>
          <Input
            id="priority"
            name="priority"
            type="number"
            defaultValue={worker?.priority ?? 100}
            className="w-32"
            aria-describedby={hintId('priority')}
          />
          <FieldHint id="priority">
            Higher wins when no default is set and several workers of this kind are enabled.
          </FieldHint>
        </Field>
      </section>

      {/* ── Test button (kind-aware) ──────────────────────────────── */}
      {mode === 'edit' && worker && kind === 'tts' && (
        <section className="space-y-2 border-t border-border pt-6">
          <h3 className="text-sm font-semibold">Test the voice</h3>
          <p className="text-xs text-muted-foreground">
            Synthesise a short sample using the saved configuration so you can hear it before it
            ships. Uses the live API key.
          </p>
          <TtsTestButton workerId={worker.id} />
        </section>
      )}
      {mode === 'edit' && worker && kind === 'stt' && (
        <section className="space-y-2 border-t border-border pt-6">
          <h3 className="text-sm font-semibold">Test transcription</h3>
          <p className="text-xs text-muted-foreground">
            Record a short clip from your microphone; we send it through this worker's Whisper
            config and show what comes back.
          </p>
          <SttTestButton workerId={worker.id} />
        </section>
      )}
      {mode === 'edit' && worker && chatShaped && isProviderWired(provider, 'chat') && (
        <section className="space-y-2 border-t border-border pt-6">
          <h3 className="text-sm font-semibold">Test chat</h3>
          <p className="text-xs text-muted-foreground">
            Send a one-shot prompt through this worker's adapter ({provider}) and see what comes
            back. Uses the saved system prompt, model, and params — same path as production.
          </p>
          <ChatTestButton endpoint={`/api/ai-workers/${worker.id}/test/chat`} />
        </section>
      )}
      {mode === 'edit' && worker && kind === 'vision' && (
        <section className="space-y-2 border-t border-border pt-6">
          <h3 className="text-sm font-semibold">Test extraction</h3>
          <p className="text-xs text-muted-foreground">
            Pick an image from disk and we'll run it through this worker's vision adapter (
            {provider}) using the saved extraction prompt and model. Use this to dial in the prompt
            before the ingest pipeline starts feeding it photos.
          </p>
          <VisionTestButton workerId={worker.id} />
        </section>
      )}
      {mode === 'edit' && worker && kind === 'document' && (
        <section className="space-y-2 border-t border-border pt-6">
          <h3 className="text-sm font-semibold">Test extraction</h3>
          <p className="text-xs text-muted-foreground">
            Pick a PDF from disk and we'll send it natively through this worker's adapter (
            {provider}) using the saved prompt and model — the same path the ingest pipeline uses.
            Use it to dial in the prompt before feeding it real invoices.
            {!nativeDocProviders.includes(provider) &&
              ' (This provider has no native-PDF adapter — at ingest it would rasterize instead.)'}
          </p>
          <DocumentTestButton workerId={worker.id} />
        </section>
      )}
      {mode === 'edit' && worker && kind === 'decider' && (
        <section className="space-y-2 border-t border-border pt-6">
          <h3 className="text-sm font-semibold">Test a decision</h3>
          <p className="text-xs text-muted-foreground">
            Sends one sample message through this worker's adapter ({provider}) with three fixed
            questions (which team, how urgent, is it a bug). Works while every use is still off — it
            checks the key, the model and the endpoint.
          </p>
          <DecisionTestButton workerId={worker.id} />
        </section>
      )}
      {mode === 'edit' && worker && kind === 'image_gen' && (
        <section className="space-y-2 border-t border-border pt-6">
          <h3 className="text-sm font-semibold">Test generation</h3>
          <p className="text-xs text-muted-foreground">
            Type a prompt and we'll send it through this worker's image adapter ({provider}) using
            the saved size/style/quality. The result is rendered here only — nothing is persisted
            until Saskia (or another caller) invokes the `generate_image` tool.
          </p>
          <ImageGenTestButton workerId={worker.id} />
        </section>
      )}

      {/* ── Footer ──────────────────────────────────────────────── */}
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-ink">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <Button type="button" variant="outline" onClick={() => router.push('/settings/ai-workers')}>
          Cancel
        </Button>
        <SubmitButton
          pending={pending}
          // Hard block: when the operator picked an embedding model whose
          // dim we KNOW is non-768, save would persist a worker that
          // crashes ingest on its first call. Untested / unknown stays
          // saveable — the EmbeddingFields footer warns explicitly there.
          disabled={kind === 'embedding' && embeddingDim !== null && embeddingDim !== COLUMN_DIMS}
        >
          {mode === 'create' ? 'Create worker' : 'Save worker'}
        </SubmitButton>
      </div>
    </form>
  );
}

/**
 * Live key-validity indicator under the api-key dropdown. Reads the same
 * `discovery` state the model picker uses, but elevates the signal next
 * to the input that caused it — so an operator who picks the wrong key
 * sees the problem there, not buried under a model picker they'll never
 * scroll to.
 *
 * Five states in priority order (first matching one renders):
 *   1. no key picked → "no key" guidance
 *   2. no eligible keys exist at all → "go add one for {capability}"
 *   3. discovery in flight → "validating…"
 *   4. discovery succeeded with empty available list → "key has no access"
 *   5. discovery errored → "could not verify (error)"
 *   6. discovery succeeded with N models → "✓ N models discovered"
 *
 * Embedding skips discovery (keyless catalog), so it has its own line.
 */

/**
 * Embedding-kind worker fields. Deliberately tiny — embedding is a pure
 * text→vector transformation with no temperature / max_tokens / system
 * prompt to tune. The model picker above this section is the entire
 * interaction; this surface just adds the "is the dim compatible?"
 * verification dance.
 *
 * Three signals for the dim:
 *   1. Just-tested live (the operator clicked the Test button — most
 *      trustworthy, surfaces real provider behaviour).
 *   2. Verified allow-list (KNOWN_DIMS — a hand-curated set of OR slugs
 *      with confirmed dims). Stops being authoritative the moment OR
 *      ships a model we haven't catalogued, which is why the Test
 *      button exists.
 *   3. Unknown — the operator can still save, but the footer warns and
 *      the runtime will throw on first insert if the dim doesn't fit.
 *
 * `onDimChange` lifts the resolved dim up to the form so the Save button
 * can hard-block when it's non-768 — same model gets blocked here AND
 * at runtime, but blocking at save time avoids the operator getting a
 * confusing "ingest crashed" message ten minutes later.
 */
