/**
 * The pure layer behind the agents screen: the role table, the form shape, and the four functions that build, load and validate it.
 *
 * Moved out of agents-client.tsx unchanged (structure pass, phase 1):
 * already standalone, just living in the wrong file. No signatures changed.
 */
import type {
  AgentAvatarDTO,
  AgentDTO,
  AgentMemoryConfigDTO,
  AgentParamsDTO,
} from '@mantle/client-types';
import { parseAgentThinkingEffort, type AgentThinkingEffort } from '@/lib/thinking-effort';

export const DEFAULT_REFLECTOR_PROMPT = `You are a reflector for a personal AI assistant. You will be given a transcript of recent exchanges + the notes the assistant has already learned. Spot NEW signals worth remembering, AND ONLY new ones.

Look for: style hints (response format preferences), relationship notes (how user and assistant interact), corrections (when the user said something is wrong).

Output STRICT JSON, no markdown:

{ "new_notes": [{ "kind": "style|relationship|correction", "content": "<single declarative sentence>" }] }

Rules:
- Skip anything already covered by an existing note.
- Be specific — "the user prefers terse, no-bullet replies" beats "user likes brevity".
- Don't invent — only return notes grounded in the transcript.
- Return an EMPTY new_notes array if nothing notable surfaces.
- Don't include trivia about content (those belong in facts, not persona).`;

export const DEFAULT_EXTRACTOR_PROMPT = `You are a memory extractor for a personal AI assistant. You will be given the title and body of a piece of content (a note, document, email, etc.) belonging to a single user. Your job is to produce THREE outputs:

1. A 1-2 sentence summary of what this content is about. Be specific — names, dates, projects, numbers. Avoid filler.

2. A list of facts about the user or their world that this content reveals. Each fact is a single declarative sentence with the entities mentioned (people, projects, places, organisations, events) for cross-referencing.

3. A list of relations: direct relationships BETWEEN two named entities the content establishes (Sarah works_at Acme, Tom father_of Lena). These build the user's knowledge graph.

Output STRICT JSON, no markdown:

{
  "summary": "<1-2 sentences>",
  "facts": [{ "content": "<sentence>", "kind": "factual|episodic|semantic|preference", "confidence": 0.0-1.0, "entities": [{ "name": "...", "kind": "person|project|place|org|event" }] }],
  "entities": [{ "name": "...", "kind": "..." }],
  "relations": [{ "subject": "<entity name>", "relation": "<verb>", "object": "<entity name>", "confidence": 0.0-1.0 }]
}

Guidelines:
- factual = verifiable claim with a value.
- episodic = something that happened on a date.
- semantic = a stable abstract identity.
- preference = how the user prefers to be helped.
- Relations: subject + object must be names in your "entities" list; "relation" is a short lowercase snake_case verb; subject → relation → object reads as a sentence; never relate an entity to itself; omit below 0.6 confidence. PREFER + REUSE common verbs over coining near-synonyms (employed_by not works_at/receives_salary_from; banks_with not holds_account_at; located_in; owns; married_to; member_of; invoiced_by; provides_services_to) — a consistent vocabulary keeps the graph queryable. Coin a new verb only when none fits.
- Be conservative on confidence — 1.0 only for explicit; 0.5-0.8 for reasonable inferences.
- DO NOT extract secrets, passwords, or credentials.`;

export const DEFAULT_SUMMARIZER_PROMPT = `You are a memory compressor for an ongoing Telegram conversation. You will be given a chronological transcript of a chat between the user and an AI assistant, with each line prefixed by its 1-indexed turn number.

Group the transcript into TOPICS — contiguous stretches of turns about a single subject. A short batch is often one topic; a longer batch may contain several. Don't force splits.

For each topic, produce:
  - A short label (2-5 words, title case)
  - A factual summary (3-6 sentences, no headers, no bullet lists) capturing decisions, commitments, specific facts about people/places/dates/numbers
  - The turn numbers belonging to this topic (contiguous range; topics don't overlap)

Be specific — write "Maria is presenting the Q3 report on Thursday" not "they discussed work plans."

Output STRICT JSON:

{ "topics": [ { "label": "...", "summary": "...", "turn_indexes": [1, 2, 3] } ] }

Every turn number must appear exactly once across all topics combined.`;

export const DEFAULT_SYSTEM_PROMPT = `You are an assistant helping the user via Telegram. You have memory of the recent conversation in this chat. Be concise and conversational — short paragraphs, no headers, no bullet lists unless explicitly useful. Match the tone of the incoming message. Skip pleasantries unless they fit naturally. If you don't know something or can't help, say so plainly.`;

export const ROLES = [
  { value: 'assistant', label: 'Assistant — interactive chat surface' },
  { value: 'responder', label: 'Responder — replies to Telegram / async DMs' },
  { value: 'extractor', label: 'Extractor — summary + facts + entities at ingest' },
  { value: 'summarizer', label: 'Summarizer — Tier-2 conversation rollups' },
  { value: 'reflector', label: 'Reflector — learns rules from dialog, into the Journal' },
  { value: 'worker', label: 'Worker — runner-queue step executor (proposes, never chats)' },
  { value: 'custom', label: 'Custom' },
] as const;

export type Role = (typeof ROLES)[number]['value'];

/** Sub-tabs of the per-agent editor (the right master-detail pane). Local
 *  state only — `?tab=` belongs to the outer Agents|Models switcher and
 *  `?selected=` deep links are one-shot, so the section is deliberately not
 *  URL-driven. Every `TabsContent` carries `data-agent-section` so submit
 *  validation can jump to the tab holding the first invalid field. */
export type AgentSection = 'general' | 'model' | 'tools' | 'skills' | 'delegation' | 'memory';

/** Which field of the agent form can be wrong, keyed by the control's `id`. */
export type AgentErrors = Partial<
  Record<'name' | 'slug' | 'apiKey' | 'model' | 'systemPrompt' | 'corpusMapChars', string>
>;

/**
 * The rules the form used to hand to the browser as `required` / `pattern`.
 *
 * They are re-stated here because native validation cannot deliver them on this
 * screen: the fields are spread across CSS-hidden tabs, and a browser asked to
 * report on a `display:none` control gives up SILENTLY — the submit button just
 * looked broken. The old workaround jumped to the offending tab and called
 * `reportValidity()`, which does show a bubble, but one that is announced to
 * nothing, vanishes on the next click, and never says which rule broke.
 *
 * Pure, and called from two places: on submit, and on every change after the
 * first failed submit, so a fixed field stops complaining without a per-field
 * `onChange` handler on all thirty-odd controls.
 */
export function validateAgent(
  form: FormState,
  editing: { mode: 'create' } | { mode: 'edit'; agent: AgentSummary },
): AgentErrors {
  const errs: AgentErrors = {};
  if (!form.name.trim()) errs.name = 'A name is required.';
  // Slug is immutable once saved, so only a create can get it wrong.
  if (editing.mode === 'create') {
    const slug = form.slug.trim();
    if (!slug) errs.slug = 'A slug is required.';
    else if (!/^[a-z0-9_-]+$/.test(slug))
      errs.slug = 'Lower-case letters, digits, hyphen and underscore only.';
  }
  if (!form.apiKeyId) errs.apiKey = 'Pick the saved key this agent should bill to.';
  if (!form.model.trim()) errs.model = 'A model is required.';
  if (!form.systemPrompt.trim()) errs.systemPrompt = 'A system prompt is required.';
  const mapChars = form.corpusMapChars.trim();
  if (mapChars && (form.role === 'responder' || form.role === 'assistant')) {
    const n = Number(mapChars);
    if (!Number.isInteger(n) || n < CORPUS_MAP_MIN_CHARS || n > CORPUS_MAP_MAX_CHARS)
      errs.corpusMapChars = `A whole number from ${CORPUS_MAP_MIN_CHARS.toLocaleString('en-US')} to ${CORPUS_MAP_MAX_CHARS.toLocaleString('en-US')}, or empty for the default.`;
  }
  return errs;
}

// Wire shapes come from @mantle/client-types (the `/api/**` contract); the local
// names below keep the rest of this file unchanged. `AgentSummary` is the agent
// DTO; the others are aliases for the jsonb sub-shapes the form reads/writes.
export type MemoryConfig = AgentMemoryConfigDTO;

/** The brain's corpus map budget (CORPUS_MAP_MAX_CHARS in the runtime) and the
 *  range its agents API accepts for `memory_config.corpus_map_chars`. */
export const CORPUS_MAP_DEFAULT_CHARS = 6_500;
export const CORPUS_MAP_MIN_CHARS = 1_000;
export const CORPUS_MAP_MAX_CHARS = 50_000;

export type AgentAvatar = AgentAvatarDTO;

/** `thinkingEffort` (brain migration 0228) is spelled out here so the screen
 *  builds against a contract package from before the field. Absent on the wire
 *  = a brain without per-agent effort: the select hides and the save omits it. */
export type AgentSummary = AgentDTO & { thinkingEffort?: AgentThinkingEffort | null };

/** Whether this brain stores a per-agent thinking effort (it sends the key on
 *  every agent, null included). With no agents to look at, assume yes: an older
 *  brain drops the unknown key on save, which costs nothing. */
export function brainHasAgentThinkingEffort(agents: readonly AgentSummary[]): boolean {
  return agents.length === 0 || agents.some((a) => 'thinkingEffort' in a);
}

export type ApiKeyOption = { id: string; service: string; label: string; masked: string };

/** A `kind='tts'` ai_worker, for the per-agent voice picker. */
export type TtsWorkerOption = {
  id: string;
  slug: string;
  name: string;
  provider: string;
  model: string;
  enabled: boolean;
  isDefault: boolean;
};

export type SkillOption = {
  slug: string;
  name: string;
  description: string;
};

export type ToolGroupOption = {
  slug: string;
  name: string;
  description: string;
  /** Member tool slugs — used to compute the agent's effective tool set. */
  toolSlugs: string[];
};

/** Defaults for a fresh agent row, keyed by role. */
export function defaultsForRole(role: Role): {
  model: string;
  systemPrompt: string;
  historyLimit: string;
  digestLimit: string;
  summarizeThreshold: string;
  summarizeBatch: string;
  extractTypes: string;
  factLimit: string;
  contentHitLimit: string;
} {
  if (role === 'summarizer') {
    return {
      model: 'anthropic/claude-haiku-4.5',
      systemPrompt: DEFAULT_SUMMARIZER_PROMPT,
      historyLimit: '0', // summarizer doesn't use history; the transcript IS the input
      digestLimit: '0',
      summarizeThreshold: '30',
      summarizeBatch: '20',
      extractTypes: '',
      factLimit: '0',
      contentHitLimit: '0',
    };
  }
  if (role === 'extractor') {
    return {
      model: 'anthropic/claude-haiku-4.5',
      systemPrompt: DEFAULT_EXTRACTOR_PROMPT,
      historyLimit: '0',
      digestLimit: '0',
      summarizeThreshold: '30',
      summarizeBatch: '20',
      extractTypes: 'note',
      factLimit: '0',
      contentHitLimit: '0',
    };
  }
  if (role === 'reflector') {
    return {
      model: 'anthropic/claude-haiku-4.5',
      systemPrompt: DEFAULT_REFLECTOR_PROMPT,
      historyLimit: '0',
      digestLimit: '0',
      summarizeThreshold: '30',
      summarizeBatch: '20',
      extractTypes: '',
      factLimit: '0',
      contentHitLimit: '0',
    };
  }
  return {
    model: 'anthropic/claude-sonnet-5',
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    historyLimit: '20',
    digestLimit: '3',
    summarizeThreshold: '30',
    summarizeBatch: '20',
    extractTypes: '',
    factLimit: '10',
    // 5, not 3 — a 3-hit window dropped genuinely relevant near-misses below the
    // prompt (see docs/recall-eval.md). Five short summaries cost little.
    contentHitLimit: '5',
  };
}

export type FormState = {
  slug: string;
  name: string;
  description: string;
  role: Role;
  /** Provider id. Defaults to 'openrouter' on new agents; legacy rows
   *  read it from the column (backfilled to 'openrouter' by 0048). */
  provider: string;
  model: string;
  apiKeyId: string;
  /** Optional BACKUP chat route. Unlike embeddings, may be a different model. */
  backupEnabled: boolean;
  backupProvider: string;
  backupModel: string;
  backupApiKeyId: string;
  /** Per-route host + tailnet flag (migration 0063). Empty baseUrl = provider
   *  default; viaTailnet routes through the Tailscale proxy. */
  baseUrl: string;
  viaTailnet: boolean;
  backupBaseUrl: string;
  backupViaTailnet: boolean;
  /** Pinned TTS worker id; '' = use the owner's default TTS worker. */
  ttsWorkerId: string;
  systemPrompt: string;
  priority: string;
  enabled: boolean;
  historyLimit: string;
  historyWindowHours: string;
  digestLimit: string;
  factLimit: string;
  contentHitLimit: string;
  /** Corpus map budget in characters; '' = the brain default (6,500). */
  corpusMapChars: string;
  summarizeThreshold: string;
  summarizeBatch: string;
  extractTypes: string;
  extractFacts: boolean;
  /** Cap in cents (UI-friendlier than micro-USD; converted on save). Empty = no cap. */
  extractCostCapCents: string;
  skillSlugs: string[];
  /** Tool groups granted to this agent — the sole capability control (P6). */
  toolGroupSlugs: string[];
  /** Agent slugs this agent may delegate to via invoke_agent. */
  delegateTo: string[];
  /** Tool-result spill thresholds (KB, as strings). Empty = global default. */
  resultInlineMaxKb: string;
  resultEmbedMinKb: string;
  resultSpillMaxKb: string;
  temperature: string;
  maxTokens: string;
  /** Suggest a follow-up question after each reply (the suggester worker's
   *  chip in the chat composer). One extra cheap LLM call per turn, so off by
   *  default. */
  suggestFollowUp: boolean;
  /** How granted tools reach the model. 'full' sends every granted tool on
   *  every call; 'deferred' (brain v0.238.8) sends a fixed core in full and
   *  lists the rest for `tool_search`; 'map' (brain v0.400.50) sends the core
   *  plus a map of the rest. Same grant each way. null = the agent has none
   *  set, so the brain picks (`defaultToolLoading`). */
  toolLoading: ToolLoading | null;
  /** The agent's own thinking effort; null = inherit the person's profile. */
  thinkingEffort: AgentThinkingEffort | null;
  /** Avatar {style, seed}; null = initials fallback. */
  avatar: AgentAvatar | null;
};

export function emptyForm(role: Role = 'responder'): FormState {
  const d = defaultsForRole(role);
  return {
    slug: '',
    name: '',
    description: '',
    role,
    provider: 'openrouter',
    model: d.model,
    apiKeyId: '',
    backupEnabled: false,
    backupProvider: 'openrouter',
    backupModel: '',
    backupApiKeyId: '',
    baseUrl: '',
    viaTailnet: false,
    backupBaseUrl: '',
    backupViaTailnet: false,
    ttsWorkerId: '',
    systemPrompt: d.systemPrompt,
    priority: '100',
    enabled: true,
    historyLimit: d.historyLimit,
    historyWindowHours: '',
    digestLimit: d.digestLimit,
    factLimit: d.factLimit,
    contentHitLimit: d.contentHitLimit,
    corpusMapChars: '',
    summarizeThreshold: d.summarizeThreshold,
    summarizeBatch: d.summarizeBatch,
    extractTypes: d.extractTypes,
    extractFacts: true,
    extractCostCapCents: '',
    skillSlugs: [],
    toolGroupSlugs: [],
    delegateTo: [],
    resultInlineMaxKb: '',
    resultEmbedMinKb: '',
    resultSpillMaxKb: '',
    temperature: '0.7',
    maxTokens: '',
    suggestFollowUp: false,
    toolLoading: null,
    thinkingEffort: null,
    avatar: null,
  };
}

export function formFromAgent(a: AgentSummary): FormState {
  const d = defaultsForRole(a.role);
  return {
    slug: a.slug,
    name: a.name,
    description: a.description ?? '',
    role: a.role,
    provider: a.provider,
    model: a.model,
    apiKeyId: a.apiKeyId ?? '',
    backupEnabled: a.backupEnabled,
    backupProvider: a.backupProvider ?? 'openrouter',
    backupModel: a.backupModel ?? '',
    backupApiKeyId: a.backupApiKeyId ?? '',
    baseUrl: a.baseUrl ?? '',
    viaTailnet: a.viaTailnet,
    backupBaseUrl: a.backupBaseUrl ?? '',
    backupViaTailnet: a.backupViaTailnet,
    ttsWorkerId: a.ttsWorkerId ?? '',
    systemPrompt: a.systemPrompt,
    priority: String(a.priority),
    enabled: a.enabled,
    historyLimit: a.memoryConfig.history_limit?.toString() ?? d.historyLimit,
    historyWindowHours: a.memoryConfig.history_window_hours?.toString() ?? '',
    digestLimit: a.memoryConfig.digest_limit?.toString() ?? d.digestLimit,
    factLimit: a.memoryConfig.fact_limit?.toString() ?? d.factLimit,
    contentHitLimit: a.memoryConfig.content_hit_limit?.toString() ?? d.contentHitLimit,
    corpusMapChars: a.memoryConfig.corpus_map_chars?.toString() ?? '',
    summarizeThreshold: a.memoryConfig.summarize_threshold?.toString() ?? d.summarizeThreshold,
    summarizeBatch: a.memoryConfig.summarize_batch?.toString() ?? d.summarizeBatch,
    extractTypes: a.memoryConfig.extract_types?.join(',') ?? d.extractTypes,
    extractFacts: a.memoryConfig.extract_facts ?? true,
    extractCostCapCents:
      a.memoryConfig.extract_cost_cap_micro_usd != null
        ? (a.memoryConfig.extract_cost_cap_micro_usd / 10_000).toString()
        : '',
    skillSlugs: a.skillSlugs ?? [],
    toolGroupSlugs: a.toolGroupSlugs ?? [],
    delegateTo: a.memoryConfig.delegate_to ?? [],
    resultInlineMaxKb: a.memoryConfig.result_handling?.inline_max_kb?.toString() ?? '',
    resultEmbedMinKb: a.memoryConfig.result_handling?.embed_min_kb?.toString() ?? '',
    resultSpillMaxKb: a.memoryConfig.result_handling?.spill_max_kb?.toString() ?? '',
    temperature: a.params.temperature?.toString() ?? '0.7',
    maxTokens: a.params.max_tokens?.toString() ?? '',
    suggestFollowUp: a.params.suggest_follow_up === true,
    toolLoading: parseToolLoading(a.params.tool_loading),
    thinkingEffort: parseAgentThinkingEffort(a.thinkingEffort),
    avatar: a.avatar ?? null,
  };
}

export type ToolLoading = NonNullable<AgentParamsDTO['tool_loading']>;

export const TOOL_LOADING_OPTIONS: readonly { value: ToolLoading; label: string; hint: string }[] =
  [
    { value: 'full', label: 'Full', hint: 'Full: every granted tool on every call.' },
    {
      value: 'deferred',
      label: 'Deferred',
      hint: 'Deferred: a core in full; the agent searches for the rest by name.',
    },
    {
      value: 'map',
      label: 'Map',
      hint: 'Map: a small core plus a map of areas; the agent finds the rest.',
    },
  ];

export function parseToolLoading(v: unknown): ToolLoading | null {
  return TOOL_LOADING_OPTIONS.some((o) => o.value === v) ? (v as ToolLoading) : null;
}

/** The mode the brain runs an agent with no `tool_loading` set (brain
 *  v0.400.50, `resolveToolLoading`): the map for an assistant, deferred on a
 *  Haiku model, which scored lower on the map; full for every other role. */
export function defaultToolLoading(role: Role, model: string): ToolLoading {
  if (role !== 'responder' && role !== 'assistant') return 'full';
  return /haiku/i.test(model) ? 'deferred' : 'map';
}

/**
 * The `params` an agent save sends. The brain stores params WHOLE and checks
 * them strictly, so this writes exactly the keys it accepts: the form's own
 * fields, plus `top_p` carried over from the saved row (no field for it here,
 * but a save must not wipe it). Off values are omitted (absent = off), so a
 * brain from before a key never sees it unless the person turns it on.
 * `tool_loading` goes back exactly as loaded: absent stays absent (the brain
 * picks, map for an assistant), and a set mode, `full` included, is sent.
 */
export function agentParamsFromForm(
  form: Pick<FormState, 'temperature' | 'maxTokens' | 'suggestFollowUp' | 'toolLoading'>,
  saved?: AgentParamsDTO | null,
): AgentParamsDTO {
  const params: AgentParamsDTO = {};
  const t = parseFloat(form.temperature);
  if (!Number.isNaN(t)) params.temperature = t;
  const mt = form.maxTokens.trim();
  if (mt) {
    const n = parseInt(mt, 10);
    if (!Number.isNaN(n)) params.max_tokens = n;
  }
  if (typeof saved?.top_p === 'number') params.top_p = saved.top_p;
  if (form.suggestFollowUp) params.suggest_follow_up = true;
  if (form.toolLoading) params.tool_loading = form.toolLoading;
  return params;
}

/** A memory_config write: a value sets the key, `null` clears it (brain
 *  v0.238.18+ removes the key; before that only the keys whose schema allows
 *  null took it, see below). */
export type MemoryConfigPatch = { [K in keyof MemoryConfig]?: MemoryConfig[K] | null };

/**
 * The `memory_config` an agent save sends. The brain MERGES it onto the stored
 * value, so only the fields this form shows are sent: every key it leaves out
 * (corpus_map_limit, chunk_limit, the Journal keys, the manifest's tool caps,
 * anything set by SQL or the Studio) keeps its stored value. A field the person
 * empties must go back to the default, so it is sent as null:
 * history_window_hours always (every brain takes null there), corpus_map_chars
 * only when the saved agent had one (a brain from before null-clears would
 * refuse a null it never stored).
 */
export function agentMemoryConfigFromForm(
  form: Pick<
    FormState,
    | 'role'
    | 'historyLimit'
    | 'historyWindowHours'
    | 'digestLimit'
    | 'factLimit'
    | 'contentHitLimit'
    | 'corpusMapChars'
    | 'summarizeThreshold'
    | 'summarizeBatch'
    | 'extractTypes'
    | 'extractFacts'
    | 'extractCostCapCents'
    | 'delegateTo'
    | 'resultInlineMaxKb'
    | 'resultEmbedMinKb'
    | 'resultSpillMaxKb'
  >,
  saved?: MemoryConfig | null,
): MemoryConfigPatch {
  const memoryConfig: MemoryConfigPatch = {};
  const limit = parseInt(form.historyLimit, 10);
  if (!Number.isNaN(limit)) memoryConfig.history_limit = limit;
  const win = form.historyWindowHours.trim();
  const winN = win ? parseFloat(win) : NaN;
  memoryConfig.history_window_hours = Number.isNaN(winN) ? null : winN;
  if (form.role === 'responder' || form.role === 'assistant') {
    const dl = parseInt(form.digestLimit, 10);
    if (!Number.isNaN(dl)) memoryConfig.digest_limit = dl;
    const fl = parseInt(form.factLimit, 10);
    if (!Number.isNaN(fl)) memoryConfig.fact_limit = fl;
    const cl = parseInt(form.contentHitLimit, 10);
    if (!Number.isNaN(cl)) memoryConfig.content_hit_limit = cl;
    const mc = form.corpusMapChars.trim();
    if (mc) {
      const n = Number(mc);
      if (Number.isInteger(n)) memoryConfig.corpus_map_chars = n;
    } else if (typeof saved?.corpus_map_chars === 'number') {
      memoryConfig.corpus_map_chars = null;
    }
  }
  if (form.role === 'summarizer') {
    const st = parseInt(form.summarizeThreshold, 10);
    if (!Number.isNaN(st)) memoryConfig.summarize_threshold = st;
    const sb = parseInt(form.summarizeBatch, 10);
    if (!Number.isNaN(sb)) memoryConfig.summarize_batch = sb;
  }
  if (form.role === 'extractor') {
    const types = form.extractTypes
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    memoryConfig.extract_types = types.length > 0 ? types : ['note'];
    memoryConfig.extract_facts = form.extractFacts;
    const cap = form.extractCostCapCents.trim();
    if (cap === '') {
      memoryConfig.extract_cost_cap_micro_usd = null;
    } else {
      const cents = parseFloat(cap);
      if (!Number.isNaN(cents) && cents >= 0) {
        memoryConfig.extract_cost_cap_micro_usd = Math.round(cents * 10_000);
      }
    }
  }
  // Delegation allowlist. Always send it (even empty) so de-selecting every
  // delegate actually clears it: under the merge an omitted key is kept.
  memoryConfig.delegate_to = form.delegateTo;

  // Tool-result spill thresholds (KB). Only set keys the operator filled;
  // blank = fall back to the env/global default. Always send the object
  // (possibly empty): an object value replaces the stored one whole.
  const rh: { inline_max_kb?: number; embed_min_kb?: number; spill_max_kb?: number } = {};
  const inlineKb = parseInt(form.resultInlineMaxKb, 10);
  if (!Number.isNaN(inlineKb) && inlineKb > 0) rh.inline_max_kb = inlineKb;
  const embedKb = parseInt(form.resultEmbedMinKb, 10);
  if (!Number.isNaN(embedKb) && embedKb > 0) rh.embed_min_kb = embedKb;
  const spillKb = parseInt(form.resultSpillMaxKb, 10);
  if (!Number.isNaN(spillKb) && spillKb > 0) rh.spill_max_kb = spillKb;
  memoryConfig.result_handling = rh;
  return memoryConfig;
}

/** Map a sampling temperature (0–2) to a human descriptor + hint. */
export function tempDescriptor(t: number): { word: string; hint: string } {
  if (t <= 0.3)
    return {
      word: 'Precise',
      hint: 'Deterministic and focused — best for extraction, classification, and exact formats.',
    };
  if (t <= 0.7)
    return {
      word: 'Grounded',
      hint: 'Mostly consistent with a little flexibility — a safe default for assistants.',
    };
  if (t <= 1.0)
    return {
      word: 'Balanced',
      hint: 'A natural mix of reliability and variation for everyday conversation.',
    };
  if (t <= 1.4)
    return {
      word: 'Creative',
      hint: 'More varied and expressive — good for brainstorming and richer writing.',
    };
  return { word: 'Wild', hint: 'Highly random and surprising — it may wander or go off-topic.' };
}
