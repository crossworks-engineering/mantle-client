/**
 * Provider outages: embeddings or extraction failing (no credits, a refused
 * key, a long outage). The brain records them (mantle migration 0230,
 * docs/embeddings.md "Provider outages") and sends them to admins on
 * GET /api/embedding/recover as `{ alerts, otherAlerts }` (the "Needs you"
 * answer that also carried them went in W5c). Members and clients never get them (the
 * route refuses them).
 *
 * The `reason` is fixed text the brain picks by error code, never provider
 * text, so it is safe on a banner. Pure helpers only: no DOM here.
 */
/**
 * One open outage. Mirrors `ProviderAlert` in @mantle/client-types (mantle
 * 0.238; `model_policy` 0348, `decision` decider plan Part 3): declared here
 * until the pinned contract package carries it.
 */
export type ProviderAlert = {
  /** `model_policy`: the box policy refused a call. `decision`: the decider
   *  fails. Neither is probed: "Try again" is for the other two only. */
  subject: 'embedding' | 'extraction' | 'model_policy' | 'decision';
  code: string;
  permanent: boolean;
  reason: string;
  provider: string | null;
  model: string | null;
  /** When it started failing (ISO). */
  since: string;
  /** The extract queue waits until it works again. */
  paused: boolean;
  /** When the brain tries one tiny call again (ISO), or null. */
  nextProbeAt: string | null;
  /** Extract jobs that wait. Null when the queue has not started. */
  waiting: number | null;
};

export const PROVIDER_ALERTS_KEY = ['provider-alerts'] as const;
export const RECOVER_PATH = '/api/embedding/recover';
/** The live event the brain sends when an outage opens or closes (the old
 *  "Needs you" change type, mantle migration 0186). */
export const PROVIDER_ALERTS_REALTIME_TYPE = 'needs_you';

/** The outages in a GET /api/embedding/recover answer: `alerts`
 *  (embedding, extraction) plus `otherAlerts` (the subjects an older client
 *  does not know, so the brain keeps them out of `alerts`). An older brain
 *  sends no `otherAlerts`, and one before 0230 sends none at all. */
export function providerAlertsOf(body: unknown): ProviderAlert[] {
  const b = body as { alerts?: unknown; otherAlerts?: unknown } | null | undefined;
  const listOf = (v: unknown) => (Array.isArray(v) ? (v as ProviderAlert[]) : []);
  return [...listOf(b?.alerts), ...listOf(b?.otherAlerts)];
}

const SUBJECT: Record<ProviderAlert['subject'], { failing: string; impact: string }> = {
  embedding: {
    failing: 'Embeddings are failing',
    impact: 'New files are not indexed and search has less context.',
  },
  extraction: {
    failing: 'Extraction is failing',
    impact: 'New files get no summary, facts or index.',
  },
  model_policy: {
    failing: 'The box policy blocked a model',
    impact: 'A call to a blocked provider or model was refused before it was sent.',
  },
  decision: {
    failing: 'The decider is failing',
    impact: 'Search and chat run without the decider, so they keep weaker passages and context.',
  },
};

/** A subject this client does not know (a newer brain) reads as a plain
 *  provider problem rather than breaking the banner. */
function subjectOf(a: ProviderAlert): { failing: string; impact: string } {
  return SUBJECT[a.subject] ?? { failing: 'A model provider is failing', impact: '' };
}

/** True when "Try again" can help: the brain probes only embedding and
 *  extraction. A decision alert closes when a decision works; a policy
 *  alert when the policy or the model changes. */
export function alertProbes(a: ProviderAlert): boolean {
  return a.subject === 'embedding' || a.subject === 'extraction';
}

/** "08:14", or "3 Oct, 08:14" when not today. */
export function sinceText(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return time;
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${time}`;
}

/** The short rail label: "Embeddings are failing". */
export function alertTitle(a: ProviderAlert): string {
  return subjectOf(a).failing;
}

/** The rail label for every open outage: one subject's own title, the
 *  pair "Embeddings and extraction are failing", or a generic one when the
 *  subjects differ otherwise. */
export function alertsTitle(alerts: ProviderAlert[]): string {
  const first = alerts[0];
  if (!first) return '';
  const subjects = new Set(alerts.map((a) => a.subject));
  if (subjects.size === 1) return alertTitle(first);
  if (subjects.size === 2 && subjects.has('embedding') && subjects.has('extraction')) {
    return 'Embeddings and extraction are failing';
  }
  return 'Several model calls are failing';
}

/** "Embeddings are failing since 08:14: <reason>" */
export function alertHeadline(a: ProviderAlert, now?: Date): string {
  const since = sinceText(a.since, now);
  return `${subjectOf(a).failing}${since ? ` since ${since}` : ''}: ${a.reason}`;
}

/** What it does to the brain, with the count waiting. */
export function alertImpact(a: ProviderAlert): string {
  const waiting =
    a.waiting && a.waiting > 0 ? ` ${a.waiting} item${a.waiting === 1 ? ' waits' : 's wait'}.` : '';
  return `${subjectOf(a).impact}${waiting}`.trim();
}

/** What the admin can do, by error code. */
export function alertFix(a: ProviderAlert): string {
  const where = a.subject === 'embedding' ? 'Settings, Embedding' : 'Settings, AI workers';
  if (a.subject === 'model_policy') {
    return `Pick a provider and model the box policy allows in ${where}.`;
  }
  if (a.subject === 'decision') return deciderFix(a);
  switch (a.code) {
    case 'quota':
      return `Add credits to the ${providerName(a.provider)} account, or switch provider in ${where}. A backup route keeps it working next time.`;
    case 'auth':
      return `Check the API key in Settings, Keys, or switch provider in ${where}.`;
    case 'no_key':
      return `Add an API key in Settings, Keys, or switch provider in ${where}.`;
    case 'model':
      return `Pick a model the provider offers in ${where}.`;
    case 'workspace':
      return 'Add or check the Anthropic workspace id on the key in Settings, Keys.';
    default:
      return `The brain retries by itself. If it lasts, switch provider or add a backup route in ${where}.`;
  }
}

/** The decider's fix, by its code. It is never probed: the alert closes
 *  when a decision works, and the worker's Test button checks a fix. */
function deciderFix(a: ProviderAlert): string {
  const test = 'Then press Test on the decider worker in Settings, AI workers.';
  switch (a.code) {
    case 'privacy_route':
      return `Choose another decider model, or lower its privacy level (untick "Request zero data retention"). The brain never lowers it by itself. ${test}`;
    case 'quota':
      return `Add credits to the ${providerName(a.provider)} account. ${test}`;
    case 'auth':
    case 'no_key':
      return `Check the API key in Settings, Keys. ${test}`;
    case 'model':
    case 'answer':
    case 'cut':
      return `Choose another decider model. ${test}`;
    case 'timeout':
      return `Raise the decider's timeout (up to 5 s) or choose a faster model. ${test}`;
    default:
      return `It closes by itself when a decision works. If it lasts, choose another decider model. ${test}`;
  }
}

/** Where to fix it. */
export function alertHref(a: ProviderAlert): string {
  return a.subject === 'embedding' ? '/settings/embedding' : '/settings/ai-workers';
}

/** When the brain tries again by itself, or null. */
export function nextTryText(a: ProviderAlert, now: Date = new Date()): string | null {
  if (!a.nextProbeAt) return null;
  const ms = Date.parse(a.nextProbeAt) - now.getTime();
  if (!Number.isFinite(ms)) return null;
  if (ms <= 60_000) return 'The brain tries again within a minute.';
  return `The brain tries again in ${Math.round(ms / 60_000)} min.`;
}

function providerName(p: string | null): string {
  if (!p) return 'provider';
  const names: Record<string, string> = {
    openai: 'OpenAI',
    openrouter: 'OpenRouter',
    google: 'Google',
    mistral: 'Mistral',
    cohere: 'Cohere',
    local: 'local',
  };
  return names[p] ?? p;
}
