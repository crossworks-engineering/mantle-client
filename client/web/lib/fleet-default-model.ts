/**
 * The Control Center's Default Model (docs/control-center.md in the mantle
 * repo, "Default Model"): a chat provider and one of the CC brain's keys
 * for it, stored on the brain. GET /api/fleet/default-model answers it and
 * what can be picked; PUT { provider, keyId } sets it; DELETE clears it.
 * Every model picker on the Fleet screen lists that provider's models with
 * that key (GET /api/models?provider&keyId, the Models screen's catalog).
 * A key is named by id, name, label and the masked hint only. Pure, so it
 * is unit-tested.
 */
import { FLEET_KEY, FLEET_PATH } from './fleet';

export const FLEET_DEFAULT_MODEL_PATH = `${FLEET_PATH}/default-model`;
/** Under the Fleet key: the Fleet's refresh reads it again too. */
export const FLEET_DEFAULT_MODEL_KEY = [...FLEET_KEY, 'default-model'] as const;

export type DefaultModelKey = { id: string; name: string; label: string; masked: string };

export type DefaultModelChoice = {
  provider: string;
  providerName: string;
  keys: DefaultModelKey[];
};

export type DefaultModelView = {
  provider: string | null;
  providerName: string | null;
  key: DefaultModelKey | null;
  problem: 'key-missing' | null;
  choices: DefaultModelChoice[];
};

/** What the pickers can list with: a provider and its key, or why not.
 *  `older`: the brain has no Default Model yet (a release behind). */
export type DefaultModelState =
  | { kind: 'loading' }
  | { kind: 'older' }
  | { kind: 'error' }
  | { kind: 'unset' }
  | { kind: 'key-missing'; provider: string; providerName: string }
  | { kind: 'set'; provider: string; providerName: string; key: DefaultModelKey };

/** The state of the read (pure). `notFound` is a 404: a brain before the
 *  Default Model. */
export function defaultModelState(input: {
  loading: boolean;
  notFound: boolean;
  data: DefaultModelView | undefined;
}): DefaultModelState {
  if (input.loading) return { kind: 'loading' };
  if (input.notFound) return { kind: 'older' };
  const d = input.data;
  if (!d) return { kind: 'error' };
  if (!d.provider) return { kind: 'unset' };
  const providerName = d.providerName ?? d.provider;
  if (!d.key) return { kind: 'key-missing', provider: d.provider, providerName };
  return { kind: 'set', provider: d.provider, providerName, key: d.key };
}

/** The line a picker shows when it has no list to offer, or null when it
 *  has one (pure). Each says the model can still be typed. */
export function pickerNote(state: DefaultModelState): string | null {
  switch (state.kind) {
    case 'set':
    case 'loading':
      return null;
    case 'unset':
      return 'No Default Model is set, so there is no model list. Set one on the Overview, under Default Model. You can still type a model id.';
    case 'key-missing':
      return `The Default Model's key for ${state.providerName} is gone. Pick another on the Overview, under Default Model. You can still type a model id.`;
    case 'older':
      return 'This brain is a release behind: it has no Default Model yet. Type the model id.';
    case 'error':
      return 'Could not read the Default Model. Type the model id.';
  }
}

/** A key as the card names it: its name and the masked hint, never the key
 *  (pure). */
export function keyText(k: DefaultModelKey): string {
  return `${k.name} (${k.masked})`;
}

/** The key a provider change keeps: the one picked when it belongs to the
 *  new provider, else the new provider's only key, else none (pure). */
export function keyForProvider(
  choices: readonly DefaultModelChoice[],
  provider: string,
  keyId: string,
): string {
  const keys = choices.find((c) => c.provider === provider)?.keys ?? [];
  if (keys.some((k) => k.id === keyId)) return keyId;
  return keys.length === 1 ? keys[0]!.id : '';
}

/** The /api/models query for the Default Model (the Models screen's
 *  catalog, one query per provider and key). */
export function catalogPath(provider: string, keyId: string): string {
  return `/api/models?provider=${encodeURIComponent(provider)}&keyId=${encodeURIComponent(keyId)}`;
}
