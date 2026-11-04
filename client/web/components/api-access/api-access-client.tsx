'use client';

/**
 * Settings > API access (brain migration 0232): API keys for scripts and
 * MCP clients. A key acts as the login that made it and can only narrow
 * it: read only or read and write, all areas or some. It works as a
 * Bearer on the public API (/api/v1) and on /api/mcp. The secret is shown
 * once, right after it is made.
 *
 * Every login makes and revokes its own keys. An admin also sees, and may
 * revoke, every key on the brain. Not the outbound "API keys" screen
 * (/settings/keys): those are keys this brain uses to call other services.
 */
import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import type {
  AccessKeyCreated,
  AccessKeyList,
  AccessKeyView,
  OidcFreshProof,
} from '@mantle/client-types';
import { apiFetch, apiSend, apiUrl, ApiError } from '@mantle/web-ui/api-fetch';
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
import { Badge } from '@mantle/web-ui/ui/badge';
import { Button } from '@mantle/web-ui/ui/button';
import { Checkbox } from '@mantle/web-ui/ui/checkbox';
import { CopyBlock } from '@mantle/web-ui/ui/copy-button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@mantle/web-ui/ui/dialog';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@mantle/web-ui/ui/field';
import { Input } from '@mantle/web-ui/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@mantle/web-ui/ui/select';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { Switch } from '@mantle/web-ui/ui/switch';
import { useToast } from '@mantle/web-ui/ui/toast';
import { formatDateTime } from '@mantle/web-ui/lib/format-datetime';
import {
  ACCESS_LABEL,
  AREA_LABEL,
  createBody,
  defaultExpiryChoice,
  exampleCommands,
  expiryChoicesFor,
  expiryLabel,
  offersRiskyTools,
  saveKeyDraft,
  scopeLine,
  sortKeys,
  takeKeyDraft,
  type CreateForm,
  type CreateRules,
} from './api-access-model';
import { useReturnReset } from '@/components/oidc/use-return-reset';
import { startFresh } from '@/lib/oidc/actions';
import { flowStoppedMessage, takeOutcome } from '@/lib/oidc/flow';
import { useOidcStatus } from '@/lib/oidc/use-oidc';
import { signInErrorMessage } from '@/lib/sign-in-error';

const QUERY_KEY = ['access-keys'];

/** A form back from a fresh company sign-in: its proof, or why there is none. */
type KeyResume = { form: CreateForm; proof?: OidcFreshProof; problem?: string };

/**
 * Outside the screen, for this page load: the settings pane remounts its
 * children once it knows the window's width, and what comes back from the
 * sign-in can be read only once. So can its proof be spent, and a new key's
 * secret is shown once: the one request is made here, and whichever mount is
 * alive when it answers shows the answer.
 */
let resumed: KeyResume | null | undefined;
let resumedSend: Promise<AccessKeyCreated> | null = null;

function keyResumeOnce(): KeyResume | null {
  if (resumed !== undefined) return resumed;
  const form = takeKeyDraft();
  const outcome = takeOutcome('fresh');
  resumed = form && {
    form,
    ...(outcome && 'proof' in outcome ? { proof: outcome.proof } : {}),
    ...(outcome && 'result' in outcome ? { problem: flowStoppedMessage(outcome.result) } : {}),
  };
  return resumed;
}

function endKeyResume(): void {
  resumed = null;
  resumedSend = null;
}

/** The brain's origin, for the example commands: the API base in the split
 *  topology, this page's origin otherwise. */
function brainOrigin(): string {
  return new URL(apiUrl('/'), window.location.href).origin;
}

export function ApiAccessClient() {
  const toast = useToast();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => apiFetch<AccessKeyList>('/api/access-keys'),
  });
  const [creating, setCreating] = useState(false);
  const [minted, setMinted] = useState<(AccessKeyCreated & { name: string }) | null>(null);
  const [revoking, setRevoking] = useState<AccessKeyView | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: QUERY_KEY });

  const oidc = useOidcStatus();
  // Back from a fresh company sign-in: the form that waited opens again. After
  // mount: this tab's storage is not there in the first render.
  const [resume, setResume] = useState<KeyResume | null>(null);
  useEffect(() => {
    const back = keyResumeOnce();
    if (!back) return;
    setResume(back);
    setCreating(true);
  }, []);

  const revoke = async (key: AccessKeyView) => {
    try {
      await apiSend(`/api/access-keys/${key.id}`, 'DELETE');
      toast.success(`Revoked ${key.name}`);
      if (minted?.id === key.id) setMinted(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not revoke the key');
    } finally {
      setRevoking(null);
    }
  };

  const data = query.data;
  const isAdmin = data?.role === 'admin';
  const keys = data ? sortKeys(data.keys) : [];

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-card">
        <div className="flex items-start justify-between gap-3 border-b border-border p-4 md:p-5">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-accent p-2 text-accent-foreground">
              <KeyRound className="size-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Keys for scripts and MCP</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                A key lets a script or an MCP client use this brain as you, with fewer rights if you
                choose: read only, or only some areas. It works on the public API (
                <code>/api/v1</code>) and on MCP. A plain sign-out does not end a key; a password
                change or Sign out everywhere ends all of them. Revoke a key here.
              </p>
            </div>
          </div>
          <Button size="sm" onClick={() => setCreating(true)} disabled={!data}>
            <Plus /> Make key
          </Button>
        </div>

        {minted && (
          <NewKeyPanel minted={minted} origin={brainOrigin()} onDone={() => setMinted(null)} />
        )}

        {query.isLoading ? (
          <div className="p-4 text-sm text-muted-foreground md:p-5">Loading…</div>
        ) : query.isError ? (
          <div className="p-4 text-sm text-destructive-ink md:p-5">Could not load the keys.</div>
        ) : keys.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground md:p-5">No keys yet.</div>
        ) : (
          <ul className="divide-y divide-border">
            {keys.map((k) => (
              <KeyRow key={k.id} k={k} showOwner={isAdmin} onRevoke={() => setRevoking(k)} />
            ))}
          </ul>
        )}
      </section>

      {data && (
        <CreateKeyDialog
          key={resume ? 'resumed' : 'new'}
          open={creating}
          onOpenChange={setCreating}
          resume={resume}
          // A linked login confirms with a fresh company sign-in; the brain says
          // whether its password may stand in (GET /api/auth/oidc/status).
          company={
            oidc.mode !== 'off' && oidc.linked
              ? { label: oidc.label, passwordToo: oidc.passwordConfirms }
              : null
          }
          // Every login re-types its password (W8); the longest expiry
          // follows the brain's maxExpiryDays (its keys area).
          rules={{ maxExpiryDays: data.maxExpiryDays }}
          areas={data.areas}
          defaultExpiryDays={data.defaultExpiryDays}
          onCreated={async (made) => {
            setMinted(made);
            setCreating(false);
            await refresh();
          }}
        />
      )}

      <AlertDialog open={!!revoking} onOpenChange={(o) => !o && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke {revoking?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The key stops working on its next request. Scripts and MCP clients that use it get
              401. You cannot undo this; make a new key instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => revoking && revoke(revoking)}
            >
              Revoke key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function KeyRow({
  k,
  showOwner,
  onRevoke,
}: {
  k: AccessKeyView;
  showOwner: boolean;
  onRevoke: () => void;
}) {
  const ended = k.status !== 'active';
  return (
    <li
      className={`flex items-start justify-between gap-3 p-4 md:px-5 ${ended ? 'opacity-60' : ''}`}
    >
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{k.name}</span>
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{k.prefix}</code>
          {k.status === 'revoked' && <Badge variant="outline">Revoked</Badge>}
          {k.status === 'expired' && <Badge variant="outline">Expired</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">
          {scopeLine(k)}
          {k.riskyTools.length > 0 ? ` · risky tools: ${k.riskyTools.join(', ')}` : ''}
        </p>
        <p className="text-xs text-muted-foreground">
          {showOwner ? `${k.login.displayName || k.login.email || 'Unknown login'} · ` : ''}
          Made {formatDateTime(k.createdAt)}
          {' · '}
          {k.lastUsedAt
            ? `last used ${formatDateTime(k.lastUsedAt)}${showOwner && k.lastUsedIp ? ` from ${k.lastUsedIp}` : ''}`
            : 'not used yet'}
          {' · '}
          {k.expiresAt
            ? `${k.status === 'expired' ? 'expired' : 'expires'} ${formatDateTime(k.expiresAt)}`
            : 'never expires'}
        </p>
      </div>
      {!ended && (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive-ink"
          onClick={onRevoke}
          aria-label={`Revoke ${k.name}`}
        >
          <Trash2 />
        </Button>
      )}
    </li>
  );
}

function NewKeyPanel({
  minted,
  origin,
  onDone,
}: {
  minted: AccessKeyCreated & { name: string };
  origin: string;
  onDone: () => void;
}) {
  const ex = exampleCommands(origin, minted.secret);
  return (
    <div className="space-y-3 border-b border-border bg-primary/5 p-4 md:p-5">
      <p className="text-sm">
        <span className="font-medium">{minted.name}</span> is ready. Copy the key now: it is shown
        only once. Keep it like a password.
      </p>
      <CopyBlock code={minted.secret} />
      <p className="text-xs text-muted-foreground">
        Keep it in a variable, so it stays out of each command:
      </p>
      <CopyBlock code={ex.env} />
      <p className="text-xs text-muted-foreground">Try it:</p>
      <CopyBlock code={ex.http} />
      <p className="text-xs text-muted-foreground">Or add this brain to Claude Code over MCP:</p>
      <CopyBlock code={ex.mcp} />
      <div className="flex justify-end">
        <Button size="sm" onClick={onDone}>
          I copied it
        </Button>
      </div>
    </div>
  );
}

function CreateKeyDialog({
  open,
  onOpenChange,
  rules,
  areas,
  defaultExpiryDays,
  onCreated,
  resume,
  company,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rules: CreateRules;
  areas: AccessKeyList['areas'];
  defaultExpiryDays: number;
  onCreated: (made: AccessKeyCreated & { name: string }) => Promise<void>;
  resume: KeyResume | null;
  company: { label: string; passwordToo: boolean } | null;
}) {
  const toast = useToast();
  const risky = offersRiskyTools(rules);
  const blank = (): CreateForm => ({
    name: '',
    access: 'read',
    allAreas: true,
    areas: [],
    expiry: defaultExpiryChoice(defaultExpiryDays, rules.maxExpiryDays),
    riskyTools: '',
    password: '',
  });
  const [form, setForm] = useState<CreateForm>(() => resume?.form ?? blank());
  const [error, setError] = useState<{ field: string; message: string } | null>(
    resume?.problem ? { field: 'company', message: resume.problem } : null,
  );
  const [pending, setPending] = useState(false);
  const [inBrowser, setInBrowser] = useState(false);
  // A linked login may type its password instead where the brain allows it.
  const [usePassword, setUsePassword] = useState(false);
  const viaCompany = usePassword ? null : company;
  const set = (patch: Partial<CreateForm>) => setForm((f) => ({ ...f, ...patch }));
  useReturnReset(useCallback(() => setPending(false), []));

  /** What a refused create means. One proof buys one request, so a failure
   *  asks again. */
  const refused = (err: unknown) => {
    // The password is never kept after a try, whatever the answer.
    set({ password: '' });
    // A wrong password is the field's problem, not a toast.
    if (err instanceof ApiError && err.status === 403 && err.body?.reason === 'password') {
      setError({ field: 'password', message: err.message });
      return;
    }
    if (err instanceof ApiError && err.status === 403 && err.body?.reason === 'fresh-sign-in') {
      setError({ field: 'company', message: err.message });
      return;
    }
    toast.error(err instanceof ApiError ? err.message : 'Could not make the key');
  };

  const send = async () => {
    const built = createBody(form, rules, 'password');
    if ('error' in built) {
      setError({ field: built.field, message: built.error });
      return;
    }
    setError(null);
    setPending(true);
    try {
      const made = await apiSend<AccessKeyCreated>('/api/access-keys', 'POST', built.body);
      await onCreated({ ...made, name: built.body.name });
      setForm(blank());
    } catch (err) {
      refused(err);
    } finally {
      setPending(false);
    }
  };

  // Back with a proof: the person already pressed the button, so it goes now.
  useEffect(() => {
    const proof = resume?.proof;
    if (!resume || !proof) return;
    const built = createBody(resume.form, rules, 'company');
    if ('error' in built) return;
    let live = true;
    setPending(true);
    resumedSend ??= apiSend<AccessKeyCreated>('/api/access-keys', 'POST', {
      ...built.body,
      fresh: proof,
    });
    resumedSend
      .then(
        async (made) => {
          if (!live) return;
          endKeyResume();
          await onCreated({ ...made, name: built.body.name });
        },
        (err: unknown) => {
          if (!live) return;
          endKeyResume();
          refused(err);
        },
      )
      .finally(() => {
        if (live) setPending(false);
      });
    return () => {
      live = false;
    };
    // Once, for the form it came back with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume]);

  const confirmWithCompany = async () => {
    const built = createBody(form, rules, 'company');
    if ('error' in built) {
      setError({ field: built.field, message: built.error });
      return;
    }
    setError(null);
    setPending(true);
    setInBrowser(false);
    saveKeyDraft(form);
    try {
      const how = await startFresh(window.location.pathname);
      if (how === 'in-browser') {
        setInBrowser(true);
        setPending(false);
      }
    } catch (err) {
      setError({ field: 'company', message: signInErrorMessage(err) });
      setPending(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (viaCompany) await confirmWithCompany();
    else await send();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // Closing forgets the whole form, the password above all.
        if (!o) {
          setError(null);
          setForm(blank());
          endKeyResume();
        }
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Make an API key</DialogTitle>
          <DialogDescription>The key acts as you, with the limits you set here.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          {/* For a password manager: the login the password field is for, so it
              does not fill the key's Name instead. Hidden and never focused,
              so the kit's styling has nothing to do here. */}
          {/* eslint-disable-next-line house/no-raw-form-control -- a hidden autofill hint, not a control */}
          <input type="text" autoComplete="username" hidden readOnly value="" />
          <FieldGroup>
            <Field data-invalid={error?.field === 'name' || undefined}>
              <FieldLabel htmlFor="key-name">Name</FieldLabel>
              <Input
                id="key-name"
                autoComplete="off"
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="Backup script"
                aria-invalid={error?.field === 'name' || undefined}
                aria-describedby={error?.field === 'name' ? 'key-name-error' : undefined}
              />
              <FieldError id="key-name-error">
                {error?.field === 'name' ? error.message : null}
              </FieldError>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="key-access">Access</FieldLabel>
                <Select
                  value={form.access}
                  onValueChange={(v) => set({ access: v as CreateForm['access'] })}
                >
                  <SelectTrigger id="key-access">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="read">{ACCESS_LABEL.read}</SelectItem>
                    <SelectItem value="read_write">{ACCESS_LABEL.read_write}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="key-expiry">Expires</FieldLabel>
                <Select value={form.expiry} onValueChange={(v) => set({ expiry: v })}>
                  <SelectTrigger id="key-expiry">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {expiryChoicesFor(rules.maxExpiryDays).map((c) => (
                      <SelectItem key={c} value={c}>
                        {expiryLabel(c)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field data-invalid={error?.field === 'areas' || undefined}>
              <div className="flex items-center justify-between gap-2">
                <FieldLabel htmlFor="key-all-areas">All areas</FieldLabel>
                <Switch
                  id="key-all-areas"
                  checked={form.allAreas}
                  onCheckedChange={(v) => set({ allAreas: v })}
                />
              </div>
              {!form.allAreas && (
                <div className="grid grid-cols-2 gap-2 pt-1" role="group" aria-label="Areas">
                  {areas.map((a) => (
                    <label key={a} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={form.areas.includes(a)}
                        onCheckedChange={(v) =>
                          set({
                            areas: v ? [...form.areas, a] : form.areas.filter((x) => x !== a),
                          })
                        }
                      />
                      {AREA_LABEL[a]}
                    </label>
                  ))}
                </div>
              )}
              <FieldDescription>
                Off: the key reaches only the areas you tick. Search finds every kind of item, email
                and journal included. Some routes and tools belong to no area; they need All areas.
              </FieldDescription>
              <FieldError>{error?.field === 'areas' ? error.message : null}</FieldError>
            </Field>

            {risky && (
              <Field data-invalid={error?.field === 'riskyTools' || undefined}>
                <FieldLabel htmlFor="key-risky">Risky MCP tools allowed</FieldLabel>
                <Input
                  id="key-risky"
                  value={form.riskyTools}
                  onChange={(e) => set({ riskyTools: e.target.value })}
                  placeholder="web_search, email_send"
                  aria-invalid={error?.field === 'riskyTools' || undefined}
                  aria-describedby="key-risky-description"
                />
                <FieldDescription id="key-risky-description">
                  Tools that send, spend or publish stay blocked for a key until you name them here.
                  Leave it empty if you are not sure.
                </FieldDescription>
                <FieldError>{error?.field === 'riskyTools' ? error.message : null}</FieldError>
              </Field>
            )}

            {viaCompany ? (
              <Field data-invalid={error?.field === 'company' || undefined}>
                <FieldDescription>
                  To make a key, sign in with {viaCompany.label} again. Then the key is made.
                </FieldDescription>
                {inBrowser && (
                  <FieldDescription>
                    Finish signing in in your browser. This window comes back when you are done.
                  </FieldDescription>
                )}
                <FieldError>{error?.field === 'company' ? error.message : null}</FieldError>
                {viaCompany.passwordToo && (
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto justify-start p-0 text-xs"
                    onClick={() => {
                      setUsePassword(true);
                      setError(null);
                    }}
                  >
                    Use my password instead
                  </Button>
                )}
              </Field>
            ) : (
              <Field data-invalid={error?.field === 'password' || undefined}>
                <FieldLabel htmlFor="key-password">Your password</FieldLabel>
                <Input
                  id="key-password"
                  type="password"
                  autoComplete="current-password"
                  value={form.password}
                  onChange={(e) => set({ password: e.target.value })}
                  aria-invalid={error?.field === 'password' || undefined}
                  aria-describedby={error?.field === 'password' ? 'key-password-error' : undefined}
                />
                <FieldError id="key-password-error">
                  {error?.field === 'password' ? error.message : null}
                </FieldError>
              </Field>
            )}

            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <SubmitButton pending={pending}>
                {viaCompany ? `Sign in with ${viaCompany.label}` : 'Make key'}
              </SubmitButton>
            </div>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
