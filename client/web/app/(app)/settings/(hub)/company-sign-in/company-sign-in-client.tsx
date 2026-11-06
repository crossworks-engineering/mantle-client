'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { ApiError, apiSend } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { CopyBlock, CopyButton } from '@mantle/web-ui/ui/copy-button';
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
import { SecretInput } from '@mantle/web-ui/ui/secret-input';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { useToast } from '@mantle/web-ui/ui/toast';
import { formatDateTime } from '@mantle/web-ui/lib/format-datetime';
import {
  scimSourceText,
  secretSourceText,
  SSO_SETUP_KEY,
  SSO_SETUP_PATH,
  testOutcomeText,
  type SsoSetupOn,
  type SsoSetupSetter,
  type SsoSetupStatus,
  type SsoSetupTestOutcome,
} from '@/lib/sso-setup';
import { ssoSetupQuery } from '@/lib/use-sso-setup-shown';

function Value({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="break-all text-sm">{value || 'Not set'}</p>
      </div>
      {value && <CopyButton value={value} ariaLabel={`Copy ${label}`} />}
    </div>
  );
}

function setterText(set: SsoSetupSetter | null): string | null {
  if (!set) return null;
  return `${set.by ?? 'A login that is gone'}, ${formatDateTime(set.at)}`;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-b border-border p-4 md:p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** What to tell the person of a failed write: the brain's own words. The hold's
 *  403 carries its text in `message`, and a machine code in `error`. */
function refusalText(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) return fallback;
  const message = err.body?.message;
  return typeof message === 'string' && message ? message : err.message;
}

/** Whether a refusal says the screen on show is out of date: the box was locked,
 *  or its .env now holds the value. */
function statusIsStale(err: unknown): boolean {
  const code = err instanceof ApiError ? err.body?.code : null;
  return code === 'setup-closed' || code === 'env-wins';
}

/** Ask the password again, then run `send`. A stolen session is not stopped by
 *  this: the audit log and the who-and-when on the screen are the record. */
function PasswordDialog({
  open,
  title,
  description,
  action,
  send,
  onDone,
  onOpenChange,
}: {
  open: boolean;
  title: string;
  description: string;
  action: string;
  send: (password: string) => Promise<void>;
  onDone: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const change = (next: boolean) => {
    // The request lands anyway: its answer belongs on this dialog.
    if (!next && pending) return;
    if (!next) {
      setPassword('');
      setError(null);
    }
    onOpenChange(next);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await send(password);
      setPassword('');
      onDone();
    } catch (err) {
      setError(refusalText(err, 'Could not save. Try again.'));
      // Not awaited: the dialog must not wait on a read nothing here needs.
      if (statusIsStale(err)) void queryClient.invalidateQueries({ queryKey: SSO_SETUP_KEY });
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <FieldGroup>
            <Field data-invalid={error ? true : undefined}>
              <FieldLabel htmlFor="sso-setup-password">Your password</FieldLabel>
              <SecretInput
                id="sso-setup-password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'sso-setup-password-error' : undefined}
              />
              <FieldError id="sso-setup-password-error">{error}</FieldError>
            </Field>
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => change(false)}
              >
                Cancel
              </Button>
              <SubmitButton pending={pending} disabled={!password}>
                {action}
              </SubmitButton>
            </div>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SecretSection({ status }: { status: SsoSetupOn }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [secret, setSecret] = useState('');
  // Bumped by a save: the next secret starts hidden again.
  const [fieldKey, setFieldKey] = useState(0);
  const [asking, setAsking] = useState(false);
  const [testing, setTesting] = useState(false);
  const [outcome, setOutcome] = useState<SsoSetupTestOutcome | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const open = status.mode === 'setup';
  const who = setterText(status.secretSet);
  const result = outcome ? testOutcomeText(outcome) : null;

  // A typed secret does not outlive its form.
  const formShown = open && status.secret !== 'env';
  useEffect(() => {
    if (!formShown) setSecret('');
  }, [formShown]);

  const test = async () => {
    setTesting(true);
    setOutcome(null);
    setTestError(null);
    try {
      const res = await apiSend<{ outcome: SsoSetupTestOutcome }>(`${SSO_SETUP_PATH}/test`, 'POST');
      setOutcome(res.outcome);
    } catch (err) {
      setTestError(refusalText(err, 'The Test did not run. Try again.'));
      if (statusIsStale(err)) void queryClient.invalidateQueries({ queryKey: SSO_SETUP_KEY });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Section title="Client secret">
      <p className="text-sm">{secretSourceText(status)}</p>
      {who && status.secret === 'row' && (
        <p className="text-xs text-muted-foreground">Set by {who}.</p>
      )}
      {formShown && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (secret.trim()) setAsking(true);
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="sso-setup-secret">
                {status.secret === 'row' ? 'Replace the secret' : 'Enter the secret'}
              </FieldLabel>
              <SecretInput
                id="sso-setup-secret"
                noun="secret"
                // Not `off`: a browser may ignore that on a password field and
                // fill the admin's own password here. The two data marks ask
                // the common password managers to leave it alone.
                autoComplete="new-password"
                data-1p-ignore
                data-lpignore="true"
                data-bwignore
                key={fieldKey}
                value={secret}
                maxLength={1024}
                aria-describedby="sso-setup-secret-help"
                onChange={(e) => setSecret(e.target.value)}
              />
              <FieldDescription id="sso-setup-secret-help">
                The value from Certificates &amp; secrets in Entra. It is sealed and never shown
                again. There is no way to clear it: replace it. Note its expiry date: nothing warns
                before it ends.
              </FieldDescription>
            </Field>
            <div className="flex justify-end">
              <SubmitButton pending={false} disabled={!secret.trim()}>
                Save secret
              </SubmitButton>
            </div>
          </FieldGroup>
        </form>
      )}
      {open && (
        <div className="space-y-2">
          <Button variant="outline" onClick={test} disabled={testing}>
            Test
          </Button>
          <p className="text-xs text-muted-foreground">Test uses the secret that is saved.</p>
          {result && (
            <p
              role="status"
              className={`flex items-start gap-1.5 text-sm ${result.good ? '' : 'text-destructive-ink'}`}
            >
              {result.good ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
              ) : (
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              )}
              <span>{result.text}</span>
            </p>
          )}
          {testError && (
            <p role="alert" className="text-sm text-destructive-ink">
              {testError}
            </p>
          )}
        </div>
      )}
      <PasswordDialog
        open={asking}
        onOpenChange={setAsking}
        title="Save the client secret"
        description="Type your password to save it."
        action="Save secret"
        send={async (password) => {
          const next = await apiSend<SsoSetupStatus>(SSO_SETUP_PATH, 'PUT', { secret, password });
          queryClient.setQueryData(SSO_SETUP_KEY, next);
        }}
        onDone={() => {
          setSecret('');
          setFieldKey((k) => k + 1);
          setAsking(false);
          setOutcome(null);
          setTestError(null);
          toast.success('The client secret is saved. Press Test to check it.');
        }}
      />
    </Section>
  );
}

/** The token this answer alone holds. Kept by the screen, above anything a
 *  status read can take away. */
function TokenPanel({ token, onDone }: { token: string; onDone: () => void }) {
  return (
    <Section title="New SCIM token">
      <div className="space-y-3 rounded-md border border-border bg-primary/5 p-3">
        <p role="status" className="text-sm">
          Copy the token now: it is shown only once, and leaving this screen loses it. Paste it into
          Entra as the secret token. It works at once.
        </p>
        <CopyBlock code={token} />
        <div className="flex justify-end">
          <Button size="sm" onClick={onDone}>
            I copied it
          </Button>
        </div>
      </div>
    </Section>
  );
}

function ScimSection({
  status,
  tokenShown,
  madeHere,
  onMade,
}: {
  status: SsoSetupOn;
  tokenShown: boolean;
  madeHere: boolean;
  onMade: (token: string) => void;
}) {
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);
  const open = status.mode === 'setup';
  const who = setterText(status.scimSet);
  // A token made here counts, also when the read after it failed.
  const replacing = status.scim === 'row' || madeHere;
  const mayMake = open && (status.scim === 'none' || status.scim === 'row');

  return (
    <Section title="SCIM token">
      <p className="text-sm">{scimSourceText(status)}</p>
      {who && status.scim === 'row' && (
        <p className="text-xs text-muted-foreground">Made by {who}.</p>
      )}
      {mayMake && !tokenShown && (
        <Button variant="outline" onClick={() => setAsking(true)}>
          {replacing ? 'Make a new token' : 'Make SCIM token'}
        </Button>
      )}
      <PasswordDialog
        open={asking}
        onOpenChange={setAsking}
        title={replacing ? 'Make a new SCIM token' : 'Make a SCIM token'}
        description={
          replacing
            ? 'The token in use stops working at once. Sync stops until the new token is in Entra. Type your password to go on.'
            : 'Type your password to make it. It is shown only once.'
        }
        action="Make token"
        send={async (password) => {
          const res = await apiSend<{ token: string }>(`${SSO_SETUP_PATH}/scim-token`, 'POST', {
            password,
          });
          onMade(res.token);
          // Not awaited: a slow read must not hold the dialog over the token.
          void queryClient.invalidateQueries({ queryKey: SSO_SETUP_KEY });
        }}
        onDone={() => setAsking(false)}
      />
    </Section>
  );
}

function EntraSteps() {
  return (
    <Section title="Steps in Entra">
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        <li>Copy the redirect URI above into the app registration, with platform Web.</li>
        <li>Make a client secret in Certificates &amp; secrets, and save it here.</li>
        <li>Press Test.</li>
        <li>Make the SCIM token. In the enterprise application, open Provisioning.</li>
        <li>Paste the SCIM URL and the token, and pass Test connection.</li>
        <li>Tell the box operator to lock this screen.</li>
      </ol>
    </Section>
  );
}

/**
 * The screen. The live mode comes from the brain: a plain restart keeps the old
 * value, so it may differ from what the box's .env says now.
 */
export function CompanySignInClient() {
  const query = useQuery(ssoSetupQuery);
  const [token, setToken] = useState<string | null>(null);
  const [madeHere, setMadeHere] = useState(false);
  const panel = token && <TokenPanel token={token} onDone={() => setToken(null)} />;

  if (query.isLoading) {
    return <div className="p-4 text-sm text-muted-foreground md:p-5">Loading…</div>;
  }
  // Only with nothing to show: a failed refetch keeps the data. A screen that
  // holds a token shown once must not go away because a read failed.
  if (!query.data) {
    return (
      <div className="p-4 text-sm text-destructive-ink md:p-5">Could not load company sign-in.</div>
    );
  }
  const status = query.data;
  if (status.mode === 'off') {
    return (
      <div>
        {panel}
        <div className="p-4 text-sm text-muted-foreground md:p-5">
          Company sign-in is off on this box.
        </div>
      </div>
    );
  }
  const open = status.mode === 'setup';

  return (
    <div>
      {query.isError && (
        <p role="status" className="px-4 pt-4 text-sm text-destructive-ink md:px-5">
          Could not read the latest status. This may be out of date.
        </p>
      )}
      <Section title="This box">
        {open ? (
          <p role="status" className="flex items-start gap-1.5 text-sm text-warning-ink">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Setup is open, and company sign-in is off for everybody. Passwords work. Keep this
              window short.
            </span>
          </p>
        ) : (
          <p className="text-sm">Locked by the box operator.</p>
        )}
        {status.envMissing.length > 0 && (
          <p className="text-sm text-destructive-ink">
            Missing from the box .env: {status.envMissing.join(', ')}.
          </p>
        )}
        <div className="divide-y divide-border">
          <Value label="Mode" value={status.mode} />
          <Value label="Issuer" value={status.issuer} />
          <Value label="Client id" value={status.clientId} />
          <Value label="Redirect URI" value={status.redirectUri} />
          <Value label="SCIM URL" value={status.scimUrl} />
        </div>
      </Section>
      <SecretSection status={status} />
      {panel}
      <ScimSection
        status={status}
        tokenShown={!!token}
        madeHere={madeHere}
        onMade={(made) => {
          setToken(made);
          setMadeHere(true);
        }}
      />
      {open && <EntraSteps />}
    </div>
  );
}
