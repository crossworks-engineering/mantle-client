/**
 * Client-side FormData → JSON for the worker form. The form is uncontrolled
 * (builds a FormData at submit); these helpers turn that into the body the
 * `/api/ai-workers` create/patch endpoints expect — the same field mapping the
 * old server actions did with parseParamsFromForm / parseBackupFromForm, moved
 * to the client now that the screen fetches.
 */
import type { AiWorkerKind } from '@mantle/client-types';
import { deciderPrivacyParams } from './decider';

function str(v: FormDataEntryValue | null): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length > 0 ? s : undefined;
}
function num(v: FormDataEntryValue | null): number | undefined {
  // A blank input is "not set", not 0 (Number('') is 0).
  const s = str(v);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** Kind-specific params (the jsonb `params` column). Mirrors the server's switch. */
export function paramsFromForm(kind: AiWorkerKind, fd: FormData): Record<string, unknown> {
  switch (kind) {
    case 'tts':
      return {
        voice: str(fd.get('voice')),
        speed: num(fd.get('speed')),
        format: str(fd.get('format')),
        instructions: str(fd.get('instructions')),
        language: str(fd.get('language')),
      };
    case 'stt':
      return {
        language: str(fd.get('language')),
        max_duration_seconds: num(fd.get('max_duration_seconds')),
      };
    case 'vision':
      return {
        extraction_prompt: str(fd.get('extraction_prompt')),
        max_tokens: num(fd.get('max_tokens')),
      };
    case 'document':
      return {
        extraction_prompt: str(fd.get('extraction_prompt')),
        max_tokens: num(fd.get('max_tokens')),
        prefer_native: fd.get('prefer_native') === 'on',
      };
    case 'image_gen':
      return {
        size: str(fd.get('size')),
        style: str(fd.get('style')),
        quality: str(fd.get('quality')),
      };
    case 'reflector':
      return {
        temperature: num(fd.get('temperature')),
        max_tokens: num(fd.get('max_tokens')),
        window_size: num(fd.get('window_size')),
        max_notes_per_run: num(fd.get('max_notes_per_run')),
        huggingface_routing: str(fd.get('huggingface_routing')),
      };
    case 'extractor': {
      const targetTypes = str(fd.get('target_types'));
      return {
        temperature: num(fd.get('temperature')),
        max_tokens: num(fd.get('max_tokens')),
        target_types: targetTypes
          ? targetTypes
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
        extract_facts: fd.get('extract_facts') === 'on',
        extract_cost_cap_micro_usd: num(fd.get('extract_cost_cap_micro_usd')),
        max_embedded_images_per_doc: num(fd.get('max_embedded_images_per_doc')),
        huggingface_routing: str(fd.get('huggingface_routing')),
      };
    }
    case 'summarizer':
      return {
        temperature: num(fd.get('temperature')),
        max_tokens: num(fd.get('max_tokens')),
        summarize_threshold: num(fd.get('summarize_threshold')),
        summarize_batch: num(fd.get('summarize_batch')),
        huggingface_routing: str(fd.get('huggingface_routing')),
      };
    case 'narrator':
    case 'suggester':
      // Plain chat knobs. The behaviour dial is the systemPrompt (handled by
      // buildWorkerBody) + max_tokens; no kind-specific params.
      return {
        temperature: num(fd.get('temperature')),
        max_tokens: num(fd.get('max_tokens')),
        huggingface_routing: str(fd.get('huggingface_routing')),
      };
    case 'decider': {
      // Experimental per-use switches (see worker-fields-decider.tsx). A use
      // whose checkbox is off is written as enabled:false so the operator's
      // mode/threshold choice survives the round trip. A field the form shows
      // is always written (undefined when blank, so mergeParams clears it);
      // keys the form does not show are kept by mergeParams on edit.
      const uses: Record<string, Record<string, unknown>> = {};
      for (const [k] of fd.entries()) {
        const m = /^use_([a-z_]+)_(enabled|mode|threshold|pool)$/.exec(k);
        if (!m) continue;
        const [, use] = m;
        if (uses[use!]) continue;
        const cfg: Record<string, unknown> = {
          enabled: fd.get(`use_${use}_enabled`) === 'on',
          mode: str(fd.get(`use_${use}_mode`)) === 'live' ? 'live' : 'shadow',
        };
        if (fd.has(`use_${use}_threshold`)) cfg.threshold = num(fd.get(`use_${use}_threshold`));
        if (fd.has(`use_${use}_pool`)) cfg.pool = poolOf(fd.get(`use_${use}_pool`));
        uses[use!] = cfg;
      }
      return {
        uses,
        // Both privacy keys, in step: the brain reads the stricter of the
        // two, so writing only `zdr` would let an older `privacy: 'zdr'`
        // keep an untick from taking effect.
        ...deciderPrivacyParams(fd.get('zdr') === 'on'),
        timeout_ms: num(fd.get('timeout_ms')),
        defer_below: num(fd.get('defer_below')),
        act_alone_at: num(fd.get('act_alone_at')),
      };
    }
    default:
      return {};
  }
}

/** passage_scoring's pool: a whole number 1..100, or undefined (blank or
 *  out of range = the server default). The server caps it too. */
function poolOf(v: FormDataEntryValue | null): number | undefined {
  const n = num(v);
  if (n === undefined) return undefined;
  const whole = Math.floor(n);
  return whole >= 1 ? Math.min(whole, 100) : undefined;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Lay the form's params over the params the worker already has. The form
 * only knows the fields it shows, and the server stores `params` whole, so a
 * save built from the form alone drops every key the form has no field for
 * (a new server setting, a value set through the API). Rules:
 * - a key the form wrote wins, even when undefined (blank = cleared);
 * - a key only `prev` has is kept;
 * - when both sides hold a plain object (`uses`, one use's config), merge
 *   one level down by the same rules.
 */
export function mergeParams(
  prev: Record<string, unknown> | null | undefined,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(prev ?? {}) };
  for (const [k, v] of Object.entries(next)) {
    const old = out[k];
    out[k] = isPlainObject(old) && isPlainObject(v) ? mergeParams(old, v) : v;
  }
  return out;
}

function backupFromForm(fd: FormData) {
  return {
    backupEnabled: fd.get('backup_enabled') === 'on',
    backupProvider: str(fd.get('backup_provider')) ?? null,
    backupModel: str(fd.get('backup_model')) ?? null,
    backupApiKeyId: (fd.get('backup_api_key_id') as string) || null,
    baseUrl: str(fd.get('base_url')) ?? null,
    viaTailnet: fd.get('via_tailnet') === 'on',
    backupBaseUrl: str(fd.get('backup_base_url')) ?? null,
    backupViaTailnet: fd.get('backup_via_tailnet') === 'on',
  };
}

export interface WorkerBody {
  kind: AiWorkerKind;
  name: string;
  provider: string;
  model: string;
  apiKeyId: string | null;
  systemPrompt: string | null;
  params: Record<string, unknown>;
  enabled: boolean;
  isDefault: boolean;
  priority?: number;
  backupEnabled: boolean;
  backupProvider: string | null;
  backupModel: string | null;
  backupApiKeyId: string | null;
  baseUrl: string | null;
  viaTailnet: boolean;
  backupBaseUrl: string | null;
  backupViaTailnet: boolean;
}

/**
 * Build the create/patch body from the form's FormData. The PATCH endpoint
 * ignores the fields it doesn't accept (kind, isDefault) — Zod strips them — so
 * one builder serves both; the caller handles isDefault via the default endpoint
 * on edit.
 */
export function buildWorkerBody(fd: FormData): WorkerBody {
  const kind = String(fd.get('kind') ?? '') as AiWorkerKind;
  return {
    kind,
    name: String(fd.get('name') ?? '').trim(),
    provider: String(fd.get('provider') ?? '').trim(),
    model: String(fd.get('model') ?? '').trim(),
    apiKeyId: (fd.get('apiKeyId') as string) || null,
    systemPrompt: (fd.get('systemPrompt') as string) || null,
    params: paramsFromForm(kind, fd),
    enabled: fd.get('enabled') === 'on',
    isDefault: fd.get('isDefault') === 'on',
    ...(num(fd.get('priority')) !== undefined ? { priority: num(fd.get('priority')) } : {}),
    ...backupFromForm(fd),
  };
}
