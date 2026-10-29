'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Plus, RefreshCw, ShieldCheck, Trash2, X } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { formatDateTime } from '@mantle/web-ui/lib/format-datetime';
import { apiFetch, apiSend, ApiError } from '@mantle/web-ui/api-fetch';
import type { TestApiKeyResult } from '@mantle/client-types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@mantle/web-ui/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@mantle/web-ui/ui/alert-dialog';
import { Input } from '@mantle/web-ui/ui/input';
import { SecretInput } from '@mantle/web-ui/ui/secret-input';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@mantle/web-ui/ui/field';
import { FieldHint } from '@mantle/web-ui/ui/field-hint';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@mantle/web-ui/ui/select';
import { useToast } from '@mantle/web-ui/ui/toast';
import { ListCard, ListCardTitle } from '@mantle/web-ui/ui/list-card';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import { cn } from '@mantle/web-ui/lib/utils';
import { SUPPORTED_PROVIDERS, wiredCapabilitiesFor } from '@mantle/voice-client';
import { copyText } from '@mantle/web-ui/lib/secure-context-fallbacks';
import { play } from '@/lib/sounds/play';

type KeyRow = {
  id: string;
  service: string;
  label: string;
  masked: string;
  /** Anthropic keys: the workspace id sent with every call. Absent from an
   *  older brain. */
  anthropicWorkspaceId?: string | null;
  lastUsed: string | null;
  updatedAt: string;
};

/** What the brain's key store can carry. An older brain sends none, and the
 *  form then shows no field it would drop. */
type KeyFeatures = { anthropicWorkspaceId?: boolean };

/** As the brain checks it (and its table): ASCII letters, digits, _ and -,
 *  at most 128 of them, so the id is always a legal header value. */
function workspaceIdProblem(value: string): string | undefined {
  const v = value.trim();
  if (!v) return undefined;
  if (v.length > 128) return 'At most 128 characters.';
  if (!/^[A-Za-z0-9_-]+$/.test(v)) return 'Only letters A to Z, digits, _ and -.';
  return undefined;
}

/** A non-LLM service the brain's runtime can consume a key for (firecrawl,
 *  mapbox, …). Served by GET /api/keys so the list is brain-versioned — no
 *  contract-package release needed to add one. Older brains omit the field. */
type KnownService = {
  service: string;
  label: string;
  description: string;
  signupUrl: string;
  usedFor: string;
  configured: boolean;
};

// Note: per-capability wired/unwired status comes from
// `wiredCapabilitiesFor(provider)` (see @mantle/voice/adapters/registry).
// The dropdown surfaces this inline so operators see exactly what their
// key will be usable for — pre-fix, the dropdown only flagged providers
// with zero wired capabilities, so partially-wired providers (Mistral +
// Cohere — chat declared but only embedding wired) looked fully working.

// Sentinel for the "not an LLM/voice provider" path — lets the operator store a
// key for an arbitrary HTTP API (mapbox, locationiq, …) that their API-console
// tools reference via {{secret:service/label}}. The backend already accepts any
// service matching ^[a-z0-9_-]+$; the dropdown just needs an escape hatch.
const CUSTOM_SERVICE = '__custom__';
const SERVICE_RE = /^[a-z0-9_-]+$/;

/** Which create-form controls are at fault. Keys are the control ids. */
type KeyErrors = { 'custom-service'?: string; plaintext?: string; 'anthropic-workspace'?: string };

type Selection = { mode: 'create' } | { mode: 'view'; id: string } | null;

export function KeysClient() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const keysQuery = useQuery({
    queryKey: ['keys'],
    queryFn: () =>
      apiFetch<{ keys: KeyRow[]; knownServices?: KnownService[]; features?: KeyFeatures }>(
        '/api/keys',
      ),
  });
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [pending, startTransition] = useTransition();
  const [sel, setSel] = useState<Selection>(null);
  // Deep link: /settings/keys?selected=<id | service | label> preselects that
  // key on first load (one-shot; selection stays client-state after).
  const searchParams = useSearchParams();
  const deepLinkRef = useRef(searchParams.get('selected'));

  // Seed the optimistic local list from the query (re-seeds on invalidate) and
  // auto-select the deep-linked key (else the first) once loaded.
  useEffect(() => {
    if (!keysQuery.data) return;
    const rows = keysQuery.data.keys;
    setKeys(rows);
    const want = deepLinkRef.current?.trim();
    deepLinkRef.current = null;
    const hit = want
      ? rows.find((k) => k.id === want || k.label === want || k.service === want)
      : undefined;
    setSel(
      (prev) =>
        prev ??
        (hit
          ? { mode: 'view', id: hit.id }
          : rows[0]
            ? { mode: 'view', id: rows[0].id }
            : { mode: 'create' }),
    );
  }, [keysQuery.data]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['keys'] });

  // Create form.
  const [service, setService] = useState('openrouter');
  const [customService, setCustomService] = useState('');
  const [label, setLabel] = useState('default');
  const [plaintext, setPlaintext] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');

  // After a successful create or rotate, show the plaintext exactly once.
  const [revealed, setRevealed] = useState<{ key: string; service: string; label: string }>();

  // Rotate + delete flows.
  const [rotating, setRotating] = useState<KeyRow>();
  const [rotateValue, setRotateValue] = useState('');
  const [createErrors, setCreateErrors] = useState<KeyErrors>({});
  const [rotateError, setRotateError] = useState<string>();
  const clearCreateError = (k: keyof KeyErrors) =>
    setCreateErrors((cur) => {
      if (!cur[k]) return cur;
      const next = { ...cur };
      delete next[k];
      return next;
    });
  const [deleteTarget, setDeleteTarget] = useState<KeyRow>();

  // Test-key flow, keyed by id.
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, TestApiKeyResult>>({});

  const selectedKey = sel?.mode === 'view' ? (keys.find((k) => k.id === sel.id) ?? null) : null;

  async function onTest(row: KeyRow) {
    setTesting((s) => ({ ...s, [row.id]: true }));
    try {
      const result = await apiSend<TestApiKeyResult>('/api/keys/test', 'POST', {
        keyId: row.id,
        service: row.service,
      });
      setTestResults((s) => ({ ...s, [row.id]: result }));
    } catch (err) {
      setTestResults((s) => ({
        ...s,
        [row.id]: {
          ok: false,
          message: err instanceof Error ? err.message : String(err),
          provider: row.service,
          adapter: '',
        },
      }));
    } finally {
      setTesting((s) => ({ ...s, [row.id]: false }));
    }
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    // §6b. Both of these were toasts: a message about a specific control,
    // shown in a corner, gone before you can look back at the field. The rules
    // are unchanged — `plaintext` was `required` too, which added the browser's
    // bubble on top.
    const next: KeyErrors = {};
    if (!plaintext.trim()) next.plaintext = 'Paste the key value.';
    if (isCustom && !SERVICE_RE.test(effectiveService))
      next['custom-service'] = 'Lower-case letters, numbers and dashes only.';
    const wsProblem = showWorkspaceField ? workspaceIdProblem(workspaceId) : undefined;
    if (wsProblem) next['anthropic-workspace'] = wsProblem;
    if (Object.keys(next).length > 0) {
      setCreateErrors(next);
      const first = next['custom-service']
        ? 'custom-service'
        : next.plaintext
          ? 'plaintext'
          : 'anthropic-workspace';
      document.getElementById(first)?.focus();
      return;
    }
    setCreateErrors({});
    const finalLabel = label.trim() || 'default';
    try {
      await apiSend('/api/keys', 'POST', {
        service: effectiveService,
        label: finalLabel,
        plaintext,
        // Only where the brain stores it, and only when given: an older
        // brain never sees the field.
        ...(showWorkspaceField && workspaceId.trim()
          ? { anthropicWorkspaceId: workspaceId.trim() }
          : {}),
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      toast.error(e instanceof Error ? e.message : 'Failed to save key.');
      return;
    }
    setRevealed({ key: plaintext, service: effectiveService, label: finalLabel });
    setPlaintext('');
    setWorkspaceId('');
    setLabel('default');
    setCustomService('');
    startTransition(() => {
      refresh();
    });
  }

  async function onRotate(e: React.FormEvent) {
    e.preventDefault();
    if (!rotating) return;
    // Was a silent `return` on an empty value — the dialog just sat there and
    // the button appeared broken. `required` added a bubble on top of that.
    if (!rotateValue.trim()) {
      setRotateError('Paste the new key value.');
      document.getElementById('rotate-value')?.focus();
      return;
    }
    setRotateError(undefined);
    try {
      await apiSend(`/api/keys/${rotating.id}/rotate`, 'POST', { plaintext: rotateValue });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      toast.error(e instanceof Error ? e.message : 'Failed to rotate.');
      return;
    }
    setRevealed({ key: rotateValue, service: rotating.service, label: rotating.label });
    setRotating(undefined);
    setRotateValue('');
    startTransition(() => {
      refresh();
    });
  }

  async function confirmDelete() {
    const row = deleteTarget;
    if (!row) return;
    setDeleteTarget(undefined);
    try {
      await apiSend(`/api/keys/${row.id}`, 'DELETE');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      toast.error(e instanceof Error ? e.message : 'Failed to delete.');
      return;
    }
    toast.success(`Deleted ${row.service}/${row.label}`);
    if (sel?.mode === 'view' && sel.id === row.id) setSel({ mode: 'create' });
    setKeys((prev) => prev.filter((k) => k.id !== row.id));
    startTransition(() => {
      refresh();
    });
  }

  const isCustom = service === CUSTOM_SERVICE;
  const supportsWorkspaceId = keysQuery.data?.features?.anthropicWorkspaceId === true;
  const showWorkspaceField = supportsWorkspaceId && service === 'anthropic';
  const effectiveService = (isCustom ? customService : service).trim().toLowerCase();
  const provider = SUPPORTED_PROVIDERS.find((p) => p.id === service);
  const knownServices = keysQuery.data?.knownServices ?? [];
  // Configured-ness is derived from the LIVE local list (not the server flag)
  // so a just-created or just-deleted key flips the placeholder immediately.
  const unconfiguredServices = knownServices.filter(
    (s) => !keys.some((k) => k.service === s.service),
  );
  const knownService =
    !provider && !isCustom ? knownServices.find((s) => s.service === service) : undefined;

  if (keysQuery.isPending) {
    return (
      <div className="flex h-full items-center justify-center py-16">
        <Spinner />
      </div>
    );
  }

  return (
    <>
      <MasterDetail
        id="settings-keys"
        // The 340px this screen has always had.
        defaultListSize="340px"
        // No `detailFills`: the detail is a form, and the 672px default measure
        // is what keeps it off 1200px line lengths (§8).
        list={
          <>
            <div className="flex items-center justify-between gap-2 border-b border-border p-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                API keys
              </h2>
              <Button type="button" size="sm" onClick={() => setSel({ mode: 'create' })}>
                <Plus /> New
              </Button>
            </div>
            <div className="space-y-2 p-3 md:flex-1 md:overflow-y-auto md:scrollbar-thin">
              {keys.length === 0 ? (
                <p className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
                  No keys yet. Click <strong>New</strong> to add one.
                </p>
              ) : (
                keys.map((k) => {
                  const selected = sel?.mode === 'view' && sel.id === k.id;
                  return (
                    <ListCard
                      key={k.id}
                      onClick={() => setSel({ mode: 'view', id: k.id })}
                      selected={selected}
                    >
                      <div className="flex items-baseline gap-2">
                        <ListCardTitle>{k.service}</ListCardTitle>
                        <span className="shrink-0 text-xs text-muted-foreground">/ {k.label}</span>
                      </div>
                      <code className="font-mono text-xs text-muted-foreground">{k.masked}</code>
                    </ListCard>
                  );
                })
              )}
              {unconfiguredServices.length > 0 && (
                <>
                  <p className="pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Available integrations
                  </p>
                  {unconfiguredServices.map((s) => (
                    <ListCard
                      key={s.service}
                      className="border-dashed"
                      onClick={() => {
                        setSel({ mode: 'create' });
                        setService(s.service);
                      }}
                      selected={sel?.mode === 'create' && service === s.service}
                    >
                      <div className="flex items-baseline gap-2">
                        <ListCardTitle>{s.label}</ListCardTitle>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          not configured
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground">{s.usedFor}</span>
                    </ListCard>
                  ))}
                </>
              )}
            </div>
          </>
        }
        detail={
          sel?.mode === 'create' ? (
            <div className="space-y-4 p-6">
              <div>
                <h2 className="text-lg font-semibold">Add a new key</h2>
                <p className="text-xs text-muted-foreground">
                  Stored as AES-256-GCM ciphertext. The plaintext is shown once after save, then
                  never again.
                </p>
              </div>
              <form onSubmit={onCreate} noValidate>
                <FieldGroup>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="service">Provider</FieldLabel>
                      {/* Was a raw `<select>` carrying hand-copied input classes:
                      no focus ring, no invalid state, and it drifts from every
                      other control the moment a token changes (§6d). */}
                      <Select value={service} onValueChange={setService}>
                        <SelectTrigger id="service">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SUPPORTED_PROVIDERS.map((p) => {
                            const { wired } = wiredCapabilitiesFor(p);
                            // Inline summary of what this provider's key can
                            // actually be used for. Empty wired list → the
                            // provider is catalogued but no adapter is
                            // registered (rare; means a planned integration
                            // hasn't landed). Partial list → operator sees
                            // upfront that this provider's chat/whatever
                            // isn't wired yet, even if the embedding is.
                            const suffix =
                              wired.length === 0 ? ' — not yet wired' : ` · ${wired.join(' · ')}`;
                            return (
                              <SelectItem key={p.id} value={p.id}>
                                {p.label}
                                {p.isAggregator ? ' (aggregator)' : ''}
                                {suffix}
                              </SelectItem>
                            );
                          })}
                          {knownServices.map((s) => (
                            <SelectItem key={s.service} value={s.service}>
                              {s.label} · {s.usedFor}
                            </SelectItem>
                          ))}
                          <SelectItem value={CUSTOM_SERVICE}>Custom / other API…</SelectItem>
                        </SelectContent>
                      </Select>
                      {isCustom && (
                        <Field data-invalid={!!createErrors['custom-service'] || undefined}>
                          <Input
                            id="custom-service"
                            value={customService}
                            onChange={(e) => {
                              setCustomService(e.target.value.toLowerCase());
                              clearCreateError('custom-service');
                            }}
                            placeholder="e.g. mapbox"
                            autoFocus
                            aria-invalid={!!createErrors['custom-service'] || undefined}
                            aria-describedby={
                              createErrors['custom-service']
                                ? 'custom-service-error custom-service-hint'
                                : 'custom-service-hint'
                            }
                          />
                          <FieldHint id="custom-service">
                            Service name for a non-LLM API your API-console tools call (lowercase
                            letters, numbers, dashes). Reference it in a tool as{' '}
                            <code>{`{{secret:${effectiveService || 'service'}/${label.trim() || 'default'}}}`}</code>
                            .
                          </FieldHint>
                          <FieldError id="custom-service-error">
                            {createErrors['custom-service']}
                          </FieldError>
                        </Field>
                      )}
                      {knownService && (
                        <p className="text-xs text-muted-foreground">
                          {knownService.description}{' '}
                          <a
                            href={knownService.signupUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="underline"
                          >
                            Get a key →
                          </a>
                          <br />
                          <span className="font-medium">Used by:</span> {knownService.usedFor}
                        </p>
                      )}
                      {provider &&
                        (() => {
                          const { wired, unwired } = wiredCapabilitiesFor(provider);
                          return (
                            <>
                              <p className="text-xs text-muted-foreground">
                                {provider.description}{' '}
                                <a
                                  href={provider.signupUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="underline"
                                >
                                  Get a key →
                                </a>
                              </p>
                              {wired.length > 0 && (
                                <p className="text-xs text-muted-foreground">
                                  <span className="font-medium">Use for:</span> {wired.join(', ')}
                                  {wired.length > 1 ? ' workers.' : ' workers.'}
                                </p>
                              )}
                              {unwired.length > 0 && (
                                <p className="text-xs text-warning-ink">
                                  <span className="font-medium">Also supports</span>{' '}
                                  {unwired.join(', ')}, but MantleOS doesn&apos;t dispatch through
                                  this provider for{' '}
                                  {unwired.length > 1 ? 'those capabilities' : 'that'} yet — a key
                                  still works for the wired capabilities above.
                                </p>
                              )}
                            </>
                          );
                        })()}
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="label">Label</FieldLabel>
                      <Input
                        id="label"
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        placeholder="default"
                        aria-describedby="label-hint"
                      />
                      <FieldDescription id="label-hint">
                        Disambiguates multiple keys for one service (e.g. <code>personal</code>,{' '}
                        <code>agent</code>).
                      </FieldDescription>
                    </Field>
                  </div>

                  <Field data-invalid={!!createErrors.plaintext || undefined}>
                    <FieldLabel htmlFor="plaintext">Key value</FieldLabel>
                    <SecretInput
                      id="plaintext"
                      noun="key"
                      autoComplete="off"
                      value={plaintext}
                      onChange={(e) => {
                        setPlaintext(e.target.value);
                        clearCreateError('plaintext');
                      }}
                      placeholder="sk-…"
                      autoFocus
                      aria-invalid={!!createErrors.plaintext || undefined}
                      aria-describedby={
                        createErrors.plaintext ? 'plaintext-error plaintext-hint' : 'plaintext-hint'
                      }
                    />
                    <FieldHint
                      id="plaintext"
                      warn="Shown only now — after saving you'll see the masked form."
                    >
                      Pasted straight from the provider. Stored encrypted.
                    </FieldHint>
                    <FieldError id="plaintext-error">{createErrors.plaintext}</FieldError>
                  </Field>

                  {showWorkspaceField && (
                    <Field data-invalid={!!createErrors['anthropic-workspace'] || undefined}>
                      <FieldLabel htmlFor="anthropic-workspace">
                        Anthropic workspace id (optional)
                      </FieldLabel>
                      <Input
                        id="anthropic-workspace"
                        value={workspaceId}
                        onChange={(e) => {
                          setWorkspaceId(e.target.value);
                          clearCreateError('anthropic-workspace');
                        }}
                        autoComplete="off"
                        spellCheck={false}
                        aria-invalid={!!createErrors['anthropic-workspace'] || undefined}
                        aria-describedby={
                          createErrors['anthropic-workspace']
                            ? 'anthropic-workspace-error anthropic-workspace-hint'
                            : 'anthropic-workspace-hint'
                        }
                      />
                      <FieldHint id="anthropic-workspace">
                        Only for a key made outside an Anthropic workspace: Anthropic then needs the
                        workspace id on every call. A key made inside a workspace needs nothing
                        here.
                      </FieldHint>
                      <FieldError id="anthropic-workspace-error">
                        {createErrors['anthropic-workspace']}
                      </FieldError>
                    </Field>
                  )}

                  <div className="flex justify-end gap-2 border-t border-border pt-3">
                    {keys.length > 0 && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setSel({ mode: 'view', id: keys[0]!.id })}
                      >
                        Cancel
                      </Button>
                    )}
                    <SubmitButton pending={pending}>Save key</SubmitButton>
                  </div>
                </FieldGroup>
              </form>
            </div>
          ) : selectedKey ? (
            <KeyDetail
              row={selectedKey}
              testing={!!testing[selectedKey.id]}
              testResult={testResults[selectedKey.id]}
              onTest={() => onTest(selectedKey)}
              onRotate={() => {
                setRotating(selectedKey);
                setRotateValue('');
              }}
              onDelete={() => setDeleteTarget(selectedKey)}
              supportsWorkspaceId={supportsWorkspaceId}
              onWorkspaceSaved={(id, value) => {
                setKeys((prev) =>
                  prev.map((k) => (k.id === id ? { ...k, anthropicWorkspaceId: value } : k)),
                );
                startTransition(() => {
                  refresh();
                });
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-10 text-center text-sm text-muted-foreground">
              Select a key, or add a new one.
            </div>
          )
        }
      />

      {/* Reveal-once modal */}
      <Dialog open={!!revealed} onOpenChange={(open) => !open && setRevealed(undefined)}>
        <DialogContent className="!h-auto !max-h-[60vh] !max-w-md">
          <DialogHeader>
            <DialogTitle>Save this key now</DialogTitle>
            <DialogDescription>
              You won&apos;t be able to see <code>{revealed?.service}</code> /{' '}
              <code>{revealed?.label}</code> again after closing this dialog.
            </DialogDescription>
          </DialogHeader>
          <pre className="overflow-x-auto scrollbar-thin rounded-md border border-border bg-muted/40 p-3 text-sm">
            {revealed?.key}
          </pre>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (revealed) copyText(revealed.key);
              }}
            >
              Copy
            </Button>
            <Button type="button" onClick={() => setRevealed(undefined)}>
              I&apos;ve saved it
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Rotate modal */}
      <Dialog open={!!rotating} onOpenChange={(open) => !open && setRotating(undefined)}>
        <DialogContent className="!h-auto !max-h-[60vh] !max-w-md">
          <DialogHeader>
            <DialogTitle>
              Rotate {rotating?.service} / {rotating?.label}
            </DialogTitle>
            <DialogDescription>
              Paste the new key value. The previous ciphertext is overwritten — there&apos;s no
              undo.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onRotate} noValidate>
            <Field data-invalid={!!rotateError || undefined} className="mb-3">
              <FieldLabel htmlFor="rotate-value">New key value</FieldLabel>
              <SecretInput
                id="rotate-value"
                noun="key"
                autoComplete="off"
                value={rotateValue}
                onChange={(e) => {
                  setRotateValue(e.target.value);
                  if (rotateError) setRotateError(undefined);
                }}
                placeholder="sk-…"
                autoFocus
                aria-invalid={!!rotateError || undefined}
                aria-describedby={rotateError ? 'rotate-value-error' : undefined}
              />
              <FieldError id="rotate-value-error">{rotateError}</FieldError>
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setRotating(undefined)}>
                Cancel
              </Button>
              <Button type="submit">Rotate</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deleteTarget?.service} / {deleteTarget?.label}?
            </AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function KeyDetail({
  row,
  testing,
  testResult,
  onTest,
  onRotate,
  onDelete,
  supportsWorkspaceId,
  onWorkspaceSaved,
}: {
  row: KeyRow;
  testing: boolean;
  testResult: TestApiKeyResult | undefined;
  onTest: () => void;
  onRotate: () => void;
  onDelete: () => void;
  supportsWorkspaceId: boolean;
  onWorkspaceSaved: (id: string, value: string | null) => void;
}) {
  const provider = SUPPORTED_PROVIDERS.find((p) => p.id === row.service);
  return (
    <div className="space-y-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">
            {row.service} <span className="text-muted-foreground">/ {row.label}</span>
          </h2>
          <p className="text-xs text-muted-foreground">
            last used {formatDateTime(row.lastUsed)} · updated {formatDateTime(row.updatedAt)}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0 text-muted-foreground hover:text-destructive-ink"
          onClick={onDelete}
          aria-label={`Delete ${row.service} / ${row.label}`}
          title="Delete key"
        >
          <Trash2 />
        </Button>
      </div>

      <Field>
        {/* Labels a read-only `<code>`, not a control, so there is no `htmlFor`
            to give — `asChild` keeps the type without minting a label that
            names nothing. */}
        <FieldLabel asChild>
          <span>Stored key</span>
        </FieldLabel>
        <code className="block rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-sm">
          {row.masked}
        </code>
        <FieldDescription>
          AES-256-GCM ciphertext — the plaintext is never shown again. Rotate to replace it.
        </FieldDescription>
      </Field>

      {provider && (
        <p className="text-sm text-muted-foreground">
          {provider.description}{' '}
          <a href={provider.signupUrl} target="_blank" rel="noreferrer" className="underline">
            Provider console →
          </a>
        </p>
      )}

      {supportsWorkspaceId && row.service === 'anthropic' && (
        // Keyed by row and stored value, so another key or a saved change
        // starts the field from what the brain holds.
        <WorkspaceIdField
          key={`${row.id}:${row.anthropicWorkspaceId ?? ''}`}
          row={row}
          onSaved={onWorkspaceSaved}
        />
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={testing}
          onClick={onTest}
          title="Make a no-cost API call to verify this key is accepted"
        >
          {testing ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Test
        </Button>
        <Button type="button" variant="outline" onClick={onRotate}>
          <RefreshCw /> Rotate
        </Button>
      </div>

      {testResult && (
        <div
          className={cn(
            'flex items-start gap-2 rounded-md px-3 py-2 text-sm',
            testResult.ok
              ? 'bg-success/10 text-success-ink'
              : 'bg-destructive/10 text-destructive-ink',
          )}
        >
          {testResult.ok ? (
            <Check className="size-4 shrink-0 translate-y-0.5" aria-hidden />
          ) : (
            <X className="size-4 shrink-0 translate-y-0.5" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <div className="font-medium">{testResult.message}</div>
            {testResult.adapter && (
              <div className="text-xs uppercase tracking-wide opacity-70">
                probed via {testResult.adapter}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** The Anthropic workspace id on a saved key: set, change or clear it
 *  without re-entering the key (PATCH /api/keys/:id). */
function WorkspaceIdField({
  row,
  onSaved,
}: {
  row: KeyRow;
  onSaved: (id: string, value: string | null) => void;
}) {
  const toast = useToast();
  const stored = row.anthropicWorkspaceId ?? '';
  const [value, setValue] = useState(stored);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const dirty = value.trim() !== stored;

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    const problem = workspaceIdProblem(value);
    if (problem) {
      setError(problem);
      document.getElementById('key-anthropic-workspace')?.focus();
      return;
    }
    setError(undefined);
    setSaving(true);
    try {
      const res = await apiSend<{ anthropicWorkspaceId: string | null }>(
        `/api/keys/${row.id}`,
        'PATCH',
        { anthropicWorkspaceId: value.trim() || null },
      );
      onSaved(row.id, res.anthropicWorkspaceId ?? null);
      play('success');
      toast.success(res.anthropicWorkspaceId ? 'Workspace id saved.' : 'Workspace id cleared.');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      play('danger');
      setError(err instanceof Error ? err.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSave} noValidate>
      <Field data-invalid={!!error || undefined}>
        <FieldLabel htmlFor="key-anthropic-workspace">Anthropic workspace id</FieldLabel>
        <div className="flex gap-2">
          <Input
            id="key-anthropic-workspace"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(undefined);
            }}
            placeholder="none"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!!error || undefined}
            aria-describedby={
              error
                ? 'key-anthropic-workspace-error key-anthropic-workspace-hint'
                : 'key-anthropic-workspace-hint'
            }
          />
          <Button type="submit" variant="outline" disabled={!dirty || saving}>
            {saving ? <Loader2 className="animate-spin" /> : null} Save
          </Button>
        </div>
        <FieldHint id="key-anthropic-workspace">
          Sent with every call made with this key. Needed only for a key made outside an Anthropic
          workspace; leave empty for a key made inside one.
        </FieldHint>
        <FieldError id="key-anthropic-workspace-error">{error}</FieldError>
      </Field>
    </form>
  );
}
