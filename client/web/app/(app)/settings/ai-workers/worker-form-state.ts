/**
 * The pure layer behind the worker form: validation, the provider-per-kind table, the OpenRouter slug arithmetic, and the model-list shaping.
 *
 * Moved out of worker-form.tsx unchanged (structure pass, phase 1):
 * already standalone, just living in the wrong file. No signatures changed.
 */
import type { AiWorkerKind } from '@mantle/client-types';
import {
  type ChatModelInfo,
  type ImageGenModelInfo,
  type SttModelInfo,
  type TtsModelInfo,
  type VisionModelInfo,
  ANTHROPIC_CHAT_MODELS,
  ANTHROPIC_VISION_MODELS,
  ASSEMBLYAI_STT_MODELS,
  DEEPGRAM_STT_MODELS,
  ELEVENLABS_STT_MODELS,
  GOOGLE_CHAT_MODELS,
  GOOGLE_IMAGE_MODELS,
  GOOGLE_STT_MODELS,
  GOOGLE_VISION_MODELS,
  HUGGINGFACE_CHAT_MODELS,
  HUGGINGFACE_IMAGE_MODELS,
  OPENAI_IMAGE_MODELS,
  OPENAI_STT_MODELS,
  OPENAI_TTS_MODELS,
  OPENAI_VISION_MODELS,
  OPENROUTER_VISION_MODELS,
  XAI_CHAT_MODELS,
  XAI_IMAGE_MODELS,
  XAI_STT_MODELS,
  XAI_VISION_MODELS,
} from '@mantle/voice-client';
import type { ExplorerModel } from '@mantle/client-types';

/** Radix `Select` forbids an empty-string item value, so "none" rides a
 *  sentinel that maps back to `''` before it reaches the form data. */
export const NONE = '__none__';

/** Which control of the worker form can be wrong, keyed by its `id`. */
export type WorkerErrors = Partial<Record<'name' | 'model' | 'primary_base_url_input', string>>;

/**
 * The rules the form used to hand to the browser as `required`.
 *
 * A native bubble is announced to nothing, disappears on the next click, and
 * cannot say WHICH rule broke — and on `model` it never fired at all, because
 * `ModelSelect`'s trigger is a button rather than a form control. The `required`
 * attributes stay on as documentation; the form is `noValidate` and these run
 * instead, with the message landing on the field.
 *
 * Reads FormData rather than component state because this form is uncontrolled:
 * most of its inputs are `name` + `defaultValue`, so the DOM is where the
 * current answer actually lives.
 */
export function validateWorker(fd: FormData, opts: { needsBaseUrl: boolean }): WorkerErrors {
  const errs: WorkerErrors = {};
  const read = (k: string) => String(fd.get(k) ?? '').trim();
  if (!read('name')) errs.name = 'A name is required.';
  if (!read('model')) errs.model = 'A model is required.';
  // `custom` routes have nowhere to fall back to: without a base URL the
  // saved worker cannot run at all.
  if (opts.needsBaseUrl && !read('base_url'))
    errs.primary_base_url_input = 'A custom route needs its provider’s base URL.';
  return errs;
}

export type KeyOption = { id: string; service: string; label: string; masked: string };

/** Default provider per kind. The dropdown is populated from the
 *  canonical SUPPORTED_PROVIDERS catalog filtered to providers that
 *  declare the capability needed by the worker kind. */
export const PROVIDER_FOR_KIND: Record<AiWorkerKind, string> = {
  reflector: 'openrouter',
  extractor: 'openrouter',
  summarizer: 'openrouter',
  tts: 'openai',
  stt: 'openai',
  vision: 'openrouter',
  // Default to Anthropic — the provider that reads PDFs natively today.
  document: 'anthropic',
  image_gen: 'openai',
  // Embeddings have a full adapter framework now (openrouter, openai,
  // google, mistral, cohere) — the provider dropdown for embedding
  // workers is freely selectable, same as for tts / stt / vision.
  // Default to OpenRouter since that's where most operators start.
  embedding: 'openrouter',
  // Web search is Perplexity Sonar via OpenRouter — provider fixed to openrouter.
  search: 'openrouter',
  search_advanced: 'openrouter',
  // Narrator + suggester run on the cheap/fast OpenRouter workhorse by default.
  narrator: 'openrouter',
  suggester: 'openrouter',
  // The decider reaches TypeSafe Jev through OpenRouter's decisions endpoint.
  decider: 'openrouter',
  // Both ship on OpenRouter: the translator's chat models, the Scan reader's
  // PDF parser (no other provider has one wired).
  translator: 'openrouter',
  scan_reader: 'openrouter',
};

/** Suggested model per kind, used as the placeholder. */
/** Map workers' provider id to the OpenRouter slug prefix for pricing
 *  lookup. Two provider ids in SUPPORTED_PROVIDERS don't match OpenRouter's
 *  prefix verbatim:
 *    - `xai` → `x-ai` (the operator-facing label vs OR's published prefix)
 *    - `mistral` → `mistralai` (OR uses the full company name as prefix)
 *  Everything else matches directly. `openrouter` is its own prefix (the
 *  model id already includes the upstream like `anthropic/claude-…`).
 *  Providers OpenRouter doesn't carry at all (Deepgram, AssemblyAI,
 *  ElevenLabs) silently miss the fallback — fine, those are audio anyway
 *  and OR doesn't have pricing for them either way. */
export function openrouterPrefixFor(provider: string): string {
  if (provider === 'xai') return 'x-ai';
  if (provider === 'mistral') return 'mistralai';
  return provider;
}

/** Build the OpenRouter-style lookup key for a worker's (provider, model).
 *  For OpenRouter the id already carries the prefix; for direct providers
 *  we prepend the slug-mapped prefix. Lower-cased so it matches the cache
 *  key shape. */
export function openrouterSlugFor(provider: string, modelId: string): string {
  if (provider === 'openrouter') return modelId.toLowerCase();
  return `${openrouterPrefixFor(provider)}/${modelId}`.toLowerCase();
}

/** Convert the discovery result (a union of TtsModelInfo / SttModelInfo /
 *  ChatModelInfo / VisionModelInfo / ImageGenModelInfo) into the
 *  ExplorerModel shape ModelSelect renders. Pricing comes from the
 *  adapter's own fields when present (ChatModelInfo / VisionModelInfo);
 *  otherwise we fall back to OpenRouter's cached pricing via the
 *  slug-mapped lookup — that's how direct providers (Anthropic, OpenAI,
 *  xAI) whose `/v1/models` returns bare ids get pricing badges anyway. */
export function toExplorerModels(
  available: ReadonlyArray<
    TtsModelInfo | SttModelInfo | ChatModelInfo | VisionModelInfo | ImageGenModelInfo
  >,
  provider: string,
  orPricing: Record<string, { inputPricePerM?: number; outputPricePerM?: number }>,
): ExplorerModel[] {
  return available.map((m) => {
    const wider = m as {
      inputPricePer1M?: number;
      outputPricePer1M?: number;
      contextTokens?: number;
      // ChatModelInfo carries this — 'vision' / 'reasoning' / 'function_calling'
      // / 'json_mode'. We fold it into the modality string so cmdk's
      // fuzzy search picks up a query like "vision" against direct-provider
      // chat models (which otherwise have no modality field).
      capabilities?: readonly string[];
    };
    const orKey = openrouterSlugFor(provider, m.id);
    const orHit = orPricing[orKey];
    const modality = wider.capabilities?.length ? wider.capabilities.join(' · ') : undefined;
    return {
      id: m.id,
      name: m.label,
      description: m.description,
      contextTokens: wider.contextTokens,
      inputPricePerM: wider.inputPricePer1M ?? orHit?.inputPricePerM,
      outputPricePerM: wider.outputPricePer1M ?? orHit?.outputPricePerM,
      modality,
      raw: m,
    };
  });
}

// Static-catalog fallback per (kind, provider). Used to seed the
// dropdown at mount AND whenever the user changes provider before
// picking an API key (so the model list stays plausible). Once an
// api key is selected we replace this with live discovery.
export function staticCatalogFor(
  forKind: AiWorkerKind,
  forProvider: string,
): Array<TtsModelInfo | SttModelInfo | ChatModelInfo | VisionModelInfo | ImageGenModelInfo> {
  if (forKind === 'tts') return [...OPENAI_TTS_MODELS];
  if (forKind === 'stt') {
    // Each STT provider ships its own model list. Falls back to
    // OpenAI's list for providers without a wired adapter (Hugging
    // Face today — model id is free-text on the Hub).
    if (forProvider === 'xai') return [...XAI_STT_MODELS];
    if (forProvider === 'elevenlabs') return [...ELEVENLABS_STT_MODELS];
    if (forProvider === 'deepgram') return [...DEEPGRAM_STT_MODELS];
    if (forProvider === 'assemblyai') return [...ASSEMBLYAI_STT_MODELS];
    if (forProvider === 'google') return [...GOOGLE_STT_MODELS];
    return [...OPENAI_STT_MODELS];
  }
  // Documents reuse the vision model catalogs (same multimodal models);
  // native PDF works on Anthropic today (Google next), others rasterize.
  if (forKind === 'vision' || forKind === 'document') {
    // Wired vision providers; everyone else gets the OpenAI list as a
    // placeholder (the form's "not yet wired" hint will steer them anyway).
    if (forProvider === 'anthropic') return [...ANTHROPIC_VISION_MODELS];
    if (forProvider === 'google') return [...GOOGLE_VISION_MODELS];
    if (forProvider === 'xai') return [...XAI_VISION_MODELS];
    if (forProvider === 'openrouter') return [...OPENROUTER_VISION_MODELS];
    return [...OPENAI_VISION_MODELS];
  }
  if (forKind === 'image_gen') {
    if (forProvider === 'xai') return [...XAI_IMAGE_MODELS];
    if (forProvider === 'google') return [...GOOGLE_IMAGE_MODELS];
    if (forProvider === 'huggingface') return [...HUGGINGFACE_IMAGE_MODELS];
    return [...OPENAI_IMAGE_MODELS];
  }
  if (
    forKind === 'reflector' ||
    forKind === 'extractor' ||
    forKind === 'summarizer' ||
    forKind === 'narrator' ||
    forKind === 'suggester' ||
    forKind === 'translator'
  ) {
    if (forProvider === 'xai') return [...XAI_CHAT_MODELS];
    if (forProvider === 'huggingface') return [...HUGGINGFACE_CHAT_MODELS];
    if (forProvider === 'anthropic') return [...ANTHROPIC_CHAT_MODELS];
    if (forProvider === 'google') return [...GOOGLE_CHAT_MODELS];
  }
  return [];
}
