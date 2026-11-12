'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, RefreshCw, Server } from 'lucide-react';
import { ApiError } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { CopyButton } from '@mantle/web-ui/ui/copy-button';
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
import { ListCard, ListCardMeta, ListCardTitle } from '@mantle/web-ui/ui/list-card';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { SecretInput } from '@mantle/web-ui/ui/secret-input';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@mantle/web-ui/ui/table';
import { useToast } from '@mantle/web-ui/ui/toast';
import { cn } from '@mantle/web-ui/lib/utils';
import { formatDateTime, timeAgo } from '@mantle/web-ui/lib/format-datetime';
import { boxName } from '@/lib/fleet';
import {
  answerText,
  askMany,
  askSso,
  FLEET_SSO_KEY,
  formRules,
  fromLabel,
  hasChange,
  linksText,
  listSso,
  modeLabel,
  readAnswer,
  secretText,
  setBody,
  settleSso,
  ssoReasonText,
  testText,
  type FleetSsoAnswers,
  type FleetSsoRow,
  type FleetSsoStatus,
  type SsoFrom,
} from '@/lib/fleet-sso';
import { isNoChannel } from '@/lib/fleet-tool';
import { boxesText } from '@/lib/fleet-view';
import {
  Callout,
  DetailPane,
  Facts,
  FleetScreen,
  ListEmpty,
  ListPane,
  Part,
  Pill,
  TONE_TEXT,
  useParam,
} from '../cc-kit';
import { refusalText } from '../fleet-section';

const ALL = 'all';

const HELP =
  'Set the box to setup mode first (scripts/sso-env.sh <box> --mode setup). Going live stays a .env step on the box (--mode optional). In optional or required mode a new secret is saved only when its Test passes.';

/** The words of a refused ask: the brain's own, or a rate limit. */
function askRefusal(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.status === 429) {
    return 'Too many asks. Wait a minute, then try again.';
  }
  return refusalText(err, fallback);
}

function ModePill({ status }: { status: FleetSsoStatus | null }) {
  if (!status) return <Pill>Not read</Pill>;
  const tone = status.mode === 'off' ? 'muted' : status.mode === 'setup' ? 'warn' : 'ok';
  return <Pill tone={tone}>{modeLabel(status.mode)}</Pill>;
}

/** A value and the small mark of where it comes from. */
function Sourced({ value, from }: { value: string | null; from: SsoFrom }) {
  const mark = fromLabel(from);
  return (
    <span className="block min-w-0">
      <span className="block break-all font-mono text-[13px]">{value || '–'}</span>
      {mark && <span className="block text-xs text-muted-foreground">{mark}</span>}
    </span>
  );
}

function LastTest({ test }: { test: { code: string; at: string; by: string } | null }) {
  if (!test) return <>–</>;
  const t = testText(test.code);
  return (
    <span className="block" title={t.text}>
      <span className={cn('block', !t.good && 'text-destructive-ink')}>{t.label}</span>
      <span className="block text-xs text-muted-foreground">
        {timeAgo(test.at) || formatDateTime(test.at)}, {test.by}
      </span>
    </span>
  );
}

// --- the answers of the boxes ---------------------------------------------------------

/** Wait for every answer, then read the list again: the Control Center has
 *  saved each answer into the box's view by then. */
function useSettle() {
  const queryClient = useQueryClient();
  return async (first: FleetSsoAnswers): Promise<FleetSsoAnswers> => {
    try {
      return await settleSso(first);
    } finally {
      void queryClient.invalidateQueries({ queryKey: FLEET_SSO_KEY });
    }
  };
}

// --- all boxes ------------------------------------------------------------------------

function AllBoxes({ rows, onOpen }: { rows: FleetSsoRow[]; onOpen: (id: string) => void }) {
  return (
    <DetailPane icon={<Building2 />} title="All boxes" pill={<Pill>{boxesText(rows.length)}</Pill>}>
      <Callout>{HELP}</Callout>
      <div className="overflow-x-auto rounded-lg border border-border scrollbar-thin">
        <Table aria-label="Fleet sign-in">
          <TableHeader>
            <TableRow className="whitespace-nowrap hover:bg-transparent">
              <TableHead className="pl-3">Box</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Tenant ID</TableHead>
              <TableHead>Client ID</TableHead>
              <TableHead>Secret</TableHead>
              <TableHead>Last Test</TableHead>
              <TableHead className="pr-3">Links</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const view = r.ssoView;
              const s = view?.status ?? null;
              return (
                <TableRow key={r.id}>
                  <TableCell className="pl-3 align-top">
                    <RowButton
                      className="rounded-sm font-medium underline-offset-2 hover:underline"
                      onClick={() => onOpen(r.id)}
                    >
                      {boxName(r)}
                    </RowButton>
                    {r.version && (
                      <span className="block font-mono text-xs text-muted-foreground">
                        v{r.version}
                      </span>
                    )}
                    {view?.reason && (
                      <span className="block text-xs text-destructive-ink">
                        {ssoReasonText(view.reason)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap align-top">
                    <ModePill status={s} />
                  </TableCell>
                  <TableCell className="align-top">
                    {s ? <Sourced value={s.tenant} from={s.issuerFrom} /> : '–'}
                  </TableCell>
                  <TableCell className="align-top">
                    {s ? <Sourced value={s.clientId} from={s.clientIdFrom} /> : '–'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap align-top">
                    {s ? secretText(s, formatDateTime) : '–'}
                  </TableCell>
                  <TableCell className="align-top">
                    <LastTest test={view?.test ?? null} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap pr-3 align-top tabular-nums">
                    {s ? linksText(s) : '–'}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </DetailPane>
  );
}

// --- the password, asked on every save -------------------------------------------------

function PasswordDialog({
  open,
  onOpenChange,
  send,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  send: (password: string) => Promise<FleetSsoAnswers>;
  onDone: (first: FleetSsoAnswers) => void;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const change = (next: boolean) => {
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
      const first = await send(password);
      setPassword('');
      onDone(first);
    } catch (err) {
      setError(askRefusal(err, 'Could not save. Try again.'));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save company sign-in</DialogTitle>
          <DialogDescription>Type your password to send it to the box.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <FieldGroup>
            <Field data-invalid={error ? true : undefined}>
              <FieldLabel htmlFor="fleet-sso-password">Your password</FieldLabel>
              <SecretInput
                id="fleet-sso-password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'fleet-sso-password-error' : undefined}
              />
              <FieldError id="fleet-sso-password-error">{error}</FieldError>
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
              <SubmitButton pending={pending} disabled={!password} data-agent-risk="person">
                Save sign-in
              </SubmitButton>
            </div>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- one box --------------------------------------------------------------------------

type Notice = { tone: 'ok' | 'warn' | 'bad'; text: string };

/** The answer of this box among `all`, in words. */
function noticeOf(all: FleetSsoAnswers, boxId: string): Notice {
  const mine = all.answers.filter((a) => a.boxId === boxId).at(-1);
  if (mine) return answerText(mine);
  if (all.pending.length > 0) return { tone: 'warn', text: ssoReasonText('pending') };
  return { tone: 'bad', text: ssoReasonText('gone') };
}

function OneBox({ row }: { row: FleetSsoRow }) {
  const toast = useToast();
  const settle = useSettle();
  const view = row.ssoView;
  const status = view?.status ?? null;
  const rules = formRules(status);
  const [tenant, setTenant] = useState('');
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  // Bumped by a save: the next secret starts hidden again.
  const [fieldKey, setFieldKey] = useState(0);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState<null | 'status' | 'test' | 'set'>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const form = { tenant, clientId, secret };

  // A typed secret does not outlive a field the box no longer takes.
  useEffect(() => {
    if (!rules.secret) setSecret('');
  }, [rules.secret]);

  const run = async (what: 'status' | 'test') => {
    setBusy(what);
    setNotice(null);
    try {
      const all = await settle(await askSso({ do: what, boxIds: [row.id] }));
      setNotice(noticeOf(all, row.id));
    } catch (err) {
      setNotice({
        tone: 'bad',
        text: askRefusal(err, what === 'test' ? 'The Test did not run.' : 'Could not ask the box.'),
      });
    } finally {
      setBusy(null);
    }
  };

  const saved = async (first: FleetSsoAnswers) => {
    setAsking(false);
    setSecret('');
    setTenant('');
    setClientId('');
    setFieldKey((k) => k + 1);
    setBusy('set');
    setNotice(null);
    try {
      const said = noticeOf(await settle(first), row.id);
      setNotice(said);
      if (said.tone === 'bad') toast.error('The box did not save it.');
      else toast.success('Saved on the box.');
    } catch (err) {
      setNotice({ tone: 'bad', text: askRefusal(err, 'Could not read the answer of the box.') });
    } finally {
      setBusy(null);
    }
  };

  const set = view?.set ?? null;
  const facts: { label: string; value: ReactNode }[] = status
    ? [
        { label: 'Mode', value: <ModePill status={status} /> },
        { label: 'Tenant ID', value: <Sourced value={status.tenant} from={status.issuerFrom} /> },
        {
          label: 'Client ID',
          value: <Sourced value={status.clientId} from={status.clientIdFrom} />,
        },
        { label: 'Client secret', value: secretText(status, formatDateTime) },
        {
          label: 'Redirect URI',
          value: status.redirectUri ? (
            <span className="flex items-center gap-2">
              <span className="min-w-0 break-all font-mono text-[13px]">{status.redirectUri}</span>
              <CopyButton value={status.redirectUri} ariaLabel="Copy the redirect URI" />
            </span>
          ) : (
            '–'
          ),
        },
        { label: 'Last Test', value: <LastTest test={view?.test ?? null} /> },
        { label: 'Links', value: linksText(status) },
      ]
    : [];

  return (
    <DetailPane
      icon={<Server />}
      title={boxName(row)}
      pill={
        <>
          <ModePill status={status} />
          {row.version && (
            <span className="font-mono text-xs text-muted-foreground">v{row.version}</span>
          )}
        </>
      }
      actions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() => void run('status')}
        >
          {busy === 'status' ? <Spinner size={16} /> : <RefreshCw aria-hidden />}
          Read status
        </Button>
      }
    >
      <Callout>{HELP}</Callout>
      {notice && (
        <Callout tone={notice.tone} title={notice.tone === 'bad' ? 'Not done' : undefined}>
          {notice.text}
        </Callout>
      )}
      {view?.reason && !notice && (
        <Callout tone="bad" title="The last call failed">
          {ssoReasonText(view.reason)}
        </Callout>
      )}

      <Part title="This box">
        {status ? (
          <>
            <Facts rows={facts} />
            {status.missing.length > 0 && (
              <p className="text-sm text-destructive-ink">
                Missing from the box .env: {status.missing.join(', ')}.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Read {formatDateTime(view!.at)}. Register the redirect URI in the Microsoft app as a
              Web redirect URI.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No status yet. Press Read status to ask the box.
          </p>
        )}
        {set && (
          <p className={cn('text-xs', set.ok ? 'text-muted-foreground' : TONE_TEXT.bad)}>
            Last save ({set.fields.join(', ') || 'nothing'}) by {set.by}, {formatDateTime(set.at)}:{' '}
            {set.ok ? 'saved.' : ssoReasonText(set.reason)}
          </p>
        )}
      </Part>

      <Part title="Stage the sign-in">
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (hasChange(form, rules)) setAsking(true);
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="fleet-sso-tenant">Tenant ID</FieldLabel>
              <Input
                id="fleet-sso-tenant"
                value={tenant}
                disabled={!rules.tenant || busy !== null}
                placeholder={status?.tenant ?? undefined}
                autoComplete="off"
                spellCheck={false}
                maxLength={64}
                onChange={(e) => setTenant(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="fleet-sso-client">Client ID</FieldLabel>
              <Input
                id="fleet-sso-client"
                value={clientId}
                disabled={!rules.clientId || busy !== null}
                placeholder={status?.clientId || undefined}
                autoComplete="off"
                spellCheck={false}
                maxLength={64}
                onChange={(e) => setClientId(e.target.value)}
              />
              <FieldDescription>
                Both are GUIDs from the Microsoft app. They change only in setup mode, and not while
                the box .env holds them.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="fleet-sso-secret">Client secret</FieldLabel>
              <SecretInput
                id="fleet-sso-secret"
                noun="secret"
                // Not `off`: a browser may fill the Admin's own password here.
                autoComplete="new-password"
                data-1p-ignore
                data-lpignore="true"
                data-bwignore
                key={fieldKey}
                value={secret}
                maxLength={1024}
                disabled={!rules.secret || busy !== null}
                aria-describedby="fleet-sso-secret-help"
                onChange={(e) => setSecret(e.target.value)}
              />
              <FieldDescription id="fleet-sso-secret-help">
                Typed once. It is never shown again, here or on the box. Test uses the secret that
                is saved.
              </FieldDescription>
            </Field>
            <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
              {busy === 'set' || busy === 'test' ? (
                <span className="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
                  <Spinner size={16} /> Waiting for the box…
                </span>
              ) : null}
              <Button
                type="button"
                variant="outline"
                disabled={!rules.test || busy !== null}
                onClick={() => void run('test')}
              >
                Test
              </Button>
              <SubmitButton
                pending={false}
                disabled={!hasChange(form, rules) || busy !== null}
                data-agent-risk="person"
              >
                Save
              </SubmitButton>
            </div>
          </FieldGroup>
        </form>
      </Part>

      <PasswordDialog
        open={asking}
        onOpenChange={setAsking}
        send={(password) => askSso(setBody(row.id, form, rules, password))}
        onDone={(first) => void saved(first)}
      />
    </DetailPane>
  );
}

// --- the screen -----------------------------------------------------------------------

function BoxCard({
  row,
  selected,
  onOpen,
}: {
  row: FleetSsoRow;
  selected: boolean;
  onOpen: () => void;
}) {
  const view = row.ssoView;
  const failed = !!view?.reason;
  return (
    <ListCard selected={selected} accent={failed ? 'warning' : undefined} onClick={onOpen}>
      <div className="flex items-center gap-2">
        <ListCardTitle className="min-w-0 flex-1">{boxName(row)}</ListCardTitle>
        <ModePill status={view?.status ?? null} />
      </div>
      <ListCardMeta className={failed ? 'text-destructive-ink' : undefined}>
        {failed ? ssoReasonText(view!.reason) : row.version ? `v${row.version}` : 'No version yet'}
      </ListCardMeta>
    </ListCard>
  );
}

function FleetSso() {
  const toast = useToast();
  const settle = useSettle();
  const [param, setParam] = useParam('box');
  const query = useQuery({
    queryKey: FLEET_SSO_KEY,
    queryFn: () => listSso(),
    staleTime: 30_000,
    retry: 1,
  });
  const [refreshing, setRefreshing] = useState(false);
  const rows = query.data ?? [];
  const selected = rows.find((r) => r.id === param) ?? null;

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      const all = await settle(
        await askMany(
          'status',
          rows.map((r) => r.id),
        ),
      );
      const failed = all.answers.filter((a) => !readAnswer(a).ok).length;
      const late = all.pending.length + all.gone.length;
      if (failed + late === 0) toast.success(`Status read on ${boxesText(all.answers.length)}.`);
      else toast.error(`${boxesText(failed + late)} did not answer with a status.`);
    } catch (err) {
      toast.error(askRefusal(err, 'Could not ask the boxes.'));
    } finally {
      setRefreshing(false);
    }
  };

  if (query.isError && !query.data && isNoChannel(query.error)) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        This Control Center runs a release before Fleet sign-in.
      </div>
    );
  }

  return (
    <MasterDetail
      id="cc-sso"
      detailFills
      list={
        <ListPane
          title="Fleet sign-in"
          action={
            rows.length > 0 ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={refreshing}
                onClick={() => void refreshAll()}
              >
                {refreshing ? <Spinner size={16} /> : <RefreshCw aria-hidden />}
                Refresh
              </Button>
            ) : undefined
          }
        >
          {query.isLoading ? (
            <div className="flex items-center gap-3 px-1 py-6 text-sm text-muted-foreground">
              <Spinner size={20} /> Loading…
            </div>
          ) : query.isError && !query.data ? (
            <p className="text-sm text-destructive-ink">
              {askRefusal(query.error, 'Could not load the boxes.')}
            </p>
          ) : rows.length === 0 ? (
            <ListEmpty>No box is linked.</ListEmpty>
          ) : (
            <>
              <ListCard selected={!selected} onClick={() => setParam(ALL)}>
                <div className="flex items-center gap-2">
                  <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <ListCardTitle>All boxes</ListCardTitle>
                </div>
                <ListCardMeta>Every box side by side</ListCardMeta>
              </ListCard>
              {rows.map((r) => (
                <BoxCard
                  key={r.id}
                  row={r}
                  selected={selected?.id === r.id}
                  onOpen={() => setParam(r.id)}
                />
              ))}
            </>
          )}
        </ListPane>
      }
      detail={
        selected ? (
          <OneBox key={selected.id} row={selected} />
        ) : rows.length > 0 ? (
          <AllBoxes rows={rows} onOpen={setParam} />
        ) : null
      }
    />
  );
}

export function SsoClient() {
  return <FleetScreen>{() => <FleetSso />}</FleetScreen>;
}
