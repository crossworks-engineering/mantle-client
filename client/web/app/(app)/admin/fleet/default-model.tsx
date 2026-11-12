'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Cpu } from 'lucide-react';
import { ApiError, apiFetch, apiSend } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@mantle/web-ui/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@mantle/web-ui/ui/select';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { useToast } from '@mantle/web-ui/ui/toast';
import { ModelSelect } from '@/components/ui/model-select';
import {
  catalogFromError,
  catalogFromResponse,
  catalogQueryKey,
  type CatalogResponse,
  type ModelCatalog,
} from '@/app/(app)/settings/agents/use-model-catalog';
import { FLEET_HREF } from '@/lib/fleet';
import {
  catalogPath,
  defaultModelState,
  FLEET_DEFAULT_MODEL_KEY,
  FLEET_DEFAULT_MODEL_PATH,
  keyForProvider,
  keyText,
  pickerNote,
  type DefaultModelState,
  type DefaultModelView,
} from '@/lib/fleet-default-model';
import { Callout, DetailPane, Facts, Pill } from './cc-kit';
import { refusalText } from './fleet-section';

/** The Overview card id (`?open=default-model`). */
export const DEFAULT_MODEL_CARD = 'default-model';
export const DEFAULT_MODEL_HREF = `${FLEET_HREF}?open=${DEFAULT_MODEL_CARD}`;

/** The Default Model as the brain stores it, and what the pickers can do. */
export function useDefaultModel() {
  const query = useQuery({
    queryKey: FLEET_DEFAULT_MODEL_KEY,
    queryFn: () => apiFetch<DefaultModelView>(FLEET_DEFAULT_MODEL_PATH),
    staleTime: 60_000,
    retry: (n, err) => !(err instanceof ApiError && err.status === 404) && n < 2,
  });
  const state = defaultModelState({
    loading: query.isLoading,
    notFound: query.error instanceof ApiError && query.error.status === 404,
    data: query.data,
  });
  return { query, state };
}

/** The Default Model's model list: the Models screen's catalog for that
 *  provider and key (one query per pair, shared by every picker). */
export function useDefaultModelCatalog(state: DefaultModelState): ModelCatalog {
  const set = state.kind === 'set';
  const provider = set ? state.provider : '';
  const keyId = set ? state.key.id : null;
  const query = useQuery({
    queryKey: catalogQueryKey(provider, keyId),
    queryFn: () => apiFetch<CatalogResponse>(catalogPath(provider, keyId ?? '')),
    enabled: set,
    staleTime: 5 * 60_000,
  });
  if (!set) return { models: [], loading: state.kind === 'loading', error: null };
  if (query.isLoading) return { models: [], loading: true, error: null };
  if (query.error) return catalogFromError(query.error);
  return catalogFromResponse(query.data ?? {});
}

/**
 * A model picker fed by the Default Model: a searchable list of the
 * provider's models (with the price per 1M tokens where the catalog has
 * it), and a typed id for a model not in the list. With no Default Model
 * set it says so and points to the Overview card. `routeProvider`: the
 * provider the model is for (a pool route), when it can differ from the
 * Default Model's; the list then says it is for another provider.
 *
 * Reusable on every Fleet screen that picks a model.
 */
export function FleetModelPicker({
  id,
  value,
  onValueChange,
  routeProvider,
  invalid,
  className,
}: {
  id?: string;
  value: string;
  onValueChange: (next: string) => void;
  routeProvider?: string;
  invalid?: boolean;
  className?: string;
}) {
  const { state } = useDefaultModel();
  const catalog = useDefaultModelCatalog(state);
  const other =
    state.kind === 'set' && routeProvider && routeProvider !== state.provider
      ? routeProvider
      : null;
  const note = other
    ? `The model list is for ${state.kind === 'set' ? state.providerName : ''}, not ${other}. Type the model id ${other} names.`
    : pickerNote(state);
  return (
    <ModelSelect
      id={id}
      value={value}
      onValueChange={onValueChange}
      models={other ? [] : catalog.models}
      loading={!other && catalog.loading}
      error={note ?? catalog.error}
      placeholder="Pick or type a model"
      emptyMessage="No model matches. Type the full model id to use it."
      aria-invalid={invalid}
      className={className}
    />
  );
}

/** The note under a picker when it has no list, with the way to the card. */
export function PickerHint() {
  const { state } = useDefaultModel();
  if (state.kind !== 'unset' && state.kind !== 'key-missing') return null;
  return (
    <p className="text-xs text-muted-foreground">
      {state.kind === 'unset' ? 'No Default Model is set. ' : "The Default Model's key is gone. "}
      <Link href={DEFAULT_MODEL_HREF} className="underline underline-offset-2">
        Set it on the Overview
      </Link>{' '}
      to pick from a list.
    </p>
  );
}

/** The Overview list card's line. */
export function defaultModelLine(state: DefaultModelState): string {
  switch (state.kind) {
    case 'set':
      return `${state.providerName}, ${state.key.name}`;
    case 'key-missing':
      return `${state.providerName}: its key is gone`;
    case 'unset':
      return 'Not set: model pickers have no list';
    case 'older':
      return 'Not on this brain yet';
    case 'loading':
      return 'Loading…';
    case 'error':
      return 'Could not read it';
  }
}

/** The Overview's Default Model pane: a provider and one of this brain's
 *  keys for it. Saved on the brain, for every admin and browser. */
export function DefaultModelPane() {
  const { query, state } = useDefaultModel();
  const view = query.data;
  const catalog = useDefaultModelCatalog(state);

  const pill =
    state.kind === 'set' ? (
      <Pill tone="ok">Set</Pill>
    ) : state.kind === 'key-missing' ? (
      <Pill tone="bad">Key gone</Pill>
    ) : state.kind === 'unset' ? (
      <Pill tone="warn">Not set</Pill>
    ) : undefined;

  return (
    <DetailPane icon={<Cpu />} title="Default Model" pill={pill}>
      <Callout>
        Pick a model provider and one of this brain&apos;s keys for it. Every model picker in the
        Control Center (Agent models, Pool entries) then lists that provider&apos;s models, with
        their prices. It changes no box.
      </Callout>
      {state.kind === 'loading' ? (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Spinner size={20} /> Loading…
        </div>
      ) : state.kind === 'older' ? (
        <p className="text-sm text-muted-foreground">
          This brain is a release behind: it does not have the Default Model yet. Model pickers take
          a typed model id until it is updated.
        </p>
      ) : state.kind === 'error' ? (
        <p className="text-sm text-destructive-ink">Could not read the Default Model.</p>
      ) : (
        <>
          {state.kind === 'key-missing' && (
            <Callout tone="bad" title="The saved key is gone">
              The key saved for {state.providerName} was deleted or changed. Pick another key.
            </Callout>
          )}
          {view && (
            // Keyed on what is stored: the form starts from it, and again
            // after each save.
            <DefaultModelForm key={`${view.provider}:${view.key?.id ?? ''}`} view={view} />
          )}
          {state.kind === 'set' && (
            <Facts
              rows={[
                { label: 'Provider', value: state.providerName },
                { label: 'Key', value: <span className="break-all">{keyText(state.key)}</span> },
                {
                  label: 'Models listed',
                  value: catalog.loading ? (
                    'Loading…'
                  ) : catalog.error ? (
                    <span className="text-warning-ink">{catalog.error}</span>
                  ) : (
                    catalog.models.length
                  ),
                },
              ]}
            />
          )}
        </>
      )}
    </DetailPane>
  );
}

/** The two pickers and Save: starts from what is stored. */
function DefaultModelForm({ view }: { view: DefaultModelView }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const choices = view.choices;
  const [provider, setProvider] = useState(view.provider ?? '');
  const [keyId, setKeyId] = useState(view.key?.id ?? '');
  const [pending, setPending] = useState(false);
  const keys = choices.find((c) => c.provider === provider)?.keys ?? [];
  const changed = provider !== (view.provider ?? '') || keyId !== (view.key?.id ?? '');
  const valid = provider !== '' && keys.some((k) => k.id === keyId);

  const send = async (body: { provider: string; keyId: string } | null) => {
    setPending(true);
    try {
      const next = body
        ? await apiSend<DefaultModelView>(FLEET_DEFAULT_MODEL_PATH, 'PUT', body)
        : await apiSend<DefaultModelView>(FLEET_DEFAULT_MODEL_PATH, 'DELETE');
      queryClient.setQueryData(FLEET_DEFAULT_MODEL_KEY, next);
      toast.success(body ? 'Default Model saved.' : 'Default Model cleared.');
    } catch (err) {
      toast.error(refusalText(err, 'Could not save the Default Model.'));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      {choices.length === 0 ? (
        <Callout tone="warn" title="This brain has no model provider key">
          Add a key for a model provider (for example openrouter) under Settings, Keys. It then
          shows here.
        </Callout>
      ) : (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && changed) void send({ provider, keyId });
          }}
        >
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="fleet-default-provider">Provider</FieldLabel>
                <Select
                  value={provider}
                  onValueChange={(p) => {
                    setProvider(p);
                    setKeyId(keyForProvider(choices, p, keyId));
                  }}
                >
                  <SelectTrigger id="fleet-default-provider">
                    <SelectValue placeholder="Pick a provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {choices.map((c) => (
                      <SelectItem key={c.provider} value={c.provider}>
                        {c.providerName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="fleet-default-key">API key</FieldLabel>
                <Select value={keyId} onValueChange={setKeyId} disabled={provider === ''}>
                  <SelectTrigger id="fleet-default-key">
                    <SelectValue placeholder="Pick a key" />
                  </SelectTrigger>
                  <SelectContent>
                    {keys.map((k) => (
                      <SelectItem key={k.id} value={k.id}>
                        {keyText(k)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <FieldDescription>
              The providers this brain holds a key for. A key shows by its name and the hint the
              Keys screen shows, never the key.
            </FieldDescription>
            <div className="flex flex-wrap items-center gap-2">
              <SubmitButton pending={pending} disabled={!valid || !changed}>
                Save Default Model
              </SubmitButton>
              {view.provider && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => void send(null)}
                >
                  Clear
                </Button>
              )}
            </div>
          </FieldGroup>
        </form>
      )}
    </>
  );
}
