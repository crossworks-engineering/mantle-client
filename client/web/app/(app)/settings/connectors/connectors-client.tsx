'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { ToolGroupIntegrationDTO } from '@mantle/client-types';
import { apiFetch, apiSend } from '@mantle/web-ui/api-fetch';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { Button } from '@mantle/web-ui/ui/button';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { Switch } from '@mantle/web-ui/ui/switch';
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
import { CopyBlock } from '@mantle/web-ui/ui/copy-button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@mantle/web-ui/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@mantle/web-ui/ui/select';
import { useToast } from '@mantle/web-ui/ui/toast';
import {
  ListCard,
  ListCardMeta,
  ListCardSnippet,
  ListCardTitle,
} from '@mantle/web-ui/ui/list-card';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import { play } from '@/lib/sounds/play';

/** Connector shapes come from the contract package (pins ≥ 0.232.73). */
type McpBinding = NonNullable<ToolGroupIntegrationDTO['mcp']>;
type McpOAuthInfo = NonNullable<McpBinding['oauth']>;
type ConnectorRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  toolSlugs: string[];
  integration: ToolGroupIntegrationDTO | null;
  enabled: boolean;
  grantedTo: string[];
};
type CatalogEntry = {
  slug: string;
  label: string;
  description: string;
  url: string;
  oauthUrl?: string;
  secretService?: string;
  docsUrl: string;
  whenToUse: string;
  /** Set when the server's sign-in needs a pre-registered app. */
  oauthClient?: 'microsoft';
  /** Steps outside Mantle the owner or their IT admin must do first. */
  setup?: string[];
  connected: boolean;
};
type MicrosoftApp = { configured: false } | { configured: true; clientId: string; tenant: string };
type ListResponse = {
  connectors: ConnectorRow[];
  catalog: CatalogEntry[];
  /** The callback an OAuth app must list as a (Web) redirect URI. Absent on
   *  brains older than the pre-registered-app release. */
  oauthRedirectUri?: string;
  microsoftApp?: MicrosoftApp;
};
type SyncResult = {
  added: number;
  updated: number;
  disabled: number;
  toolSlugs: string[];
};
type KeyRow = { id: string; service: string; label: string; masked: string };

type AuthMode = 'none' | 'key' | 'oauth';
/** Where an OAuth connector's app comes from (mantle docs/mcp-connectors.md). */
type OAuthApp = 'dynamic' | 'microsoft' | 'manual';

type FormState = {
  slug: string;
  name: string;
  url: string;
  auth: AuthMode;
  secretRef: string;
  oauthApp: OAuthApp;
  clientId: string;
  /** Write-only: a manual app's secret is sealed server-side, never read back. */
  clientSecret: string;
  authorizationServer: string;
  scope: string;
};

const noOAuthApp = {
  oauthApp: 'dynamic' as OAuthApp,
  clientId: '',
  clientSecret: '',
  authorizationServer: '',
  scope: '',
};

const emptyForm = (): FormState => ({
  slug: '',
  name: '',
  url: '',
  auth: 'none',
  secretRef: '',
  ...noOAuthApp,
});

function formFromCatalog(c: CatalogEntry): FormState {
  const auth: AuthMode = c.secretService ? 'key' : c.oauthUrl ? 'oauth' : 'none';
  return {
    slug: c.slug,
    name: c.label,
    url: auth === 'oauth' && c.oauthUrl ? c.oauthUrl : c.url,
    auth,
    secretRef: '',
    ...noOAuthApp,
    oauthApp: c.oauthClient === 'microsoft' ? 'microsoft' : 'dynamic',
  };
}

function formFromConnector(c: ConnectorRow): FormState {
  const mcp = c.integration?.mcp;
  const app = mcp?.oauth?.client;
  return {
    slug: c.slug,
    name: c.name,
    url: mcp?.url ?? '',
    auth: mcp?.oauth ? 'oauth' : mcp?.secretRef ? 'key' : 'none',
    secretRef: mcp?.secretRef ?? '',
    oauthApp: app?.source ?? 'dynamic',
    clientId: app?.source === 'manual' ? (mcp?.oauth?.clientId ?? '') : '',
    clientSecret: '',
    authorizationServer: app?.source === 'manual' ? (app.authorizationServer ?? '') : '',
    scope: mcp?.oauth?.scope ?? '',
  };
}

/** The `oauthClient` request field for the form's app choice. */
function oauthClientBody(f: FormState): Record<string, unknown> {
  if (f.oauthApp !== 'manual') return { source: f.oauthApp };
  return {
    source: 'manual',
    clientId: f.clientId.trim(),
    ...(f.clientSecret ? { clientSecret: f.clientSecret } : {}),
    ...(f.authorizationServer.trim() ? { authorizationServer: f.authorizationServer.trim() } : {}),
  };
}

/** Did the owner change the connector's app? The server no-ops an unchanged
 *  one, but a secret should not travel for nothing. */
function oauthAppChanged(f: FormState, was: FormState): boolean {
  return (
    f.oauthApp !== was.oauthApp ||
    (f.oauthApp === 'manual' &&
      (f.clientId.trim() !== was.clientId ||
        f.authorizationServer.trim() !== was.authorizationServer ||
        f.clientSecret !== ''))
  );
}

function OAuthStatusPill({ oauth }: { oauth: McpOAuthInfo }) {
  const cls =
    oauth.status === 'connected'
      ? 'bg-success/15 text-success-ink'
      : oauth.status === 'pending'
        ? 'bg-warning/15 text-warning-ink'
        : 'bg-destructive/10 text-destructive-ink';
  const label =
    oauth.status === 'connected'
      ? 'connected'
      : oauth.status === 'pending'
        ? 'authorization pending'
        : 'needs reconnect';
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${cls}`} title={oauth.lastError}>
      {label}
    </span>
  );
}

/** Popup-blocker-safe external open: the tab is created synchronously in the
 *  click handler, the URL set once the API answers (see team-forum's
 *  attachment-ui for the precedent).
 *
 *  It cannot pass `noopener` like the two direct opens beside it do — that
 *  makes `window.open` return `null`, and the whole point here is to keep the
 *  handle so the URL can be set later. Severing `opener` by hand is the
 *  equivalent: it is done while the tab is still `about:blank`, and it stays
 *  null across the navigation, so the authorize page never gets a reference
 *  back into this window.
 *
 *  Every caller must close the tab on any path that does NOT navigate it —
 *  otherwise a blank tab is left behind. */
function openTab(): Window | null {
  const tab = window.open('', '_blank');
  if (tab) tab.opener = null;
  return tab;
}

export function ConnectorsClient() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const connectorsQuery = useQuery({
    queryKey: ['mcp-connectors'],
    queryFn: () => apiFetch<ListResponse>('/api/mcp-connectors'),
  });
  const keysQuery = useQuery({
    queryKey: ['keys'],
    queryFn: () => apiFetch<{ keys: KeyRow[] }>('/api/keys').then((r) => r.keys),
  });
  const connectors = useMemo(() => connectorsQuery.data?.connectors ?? [], [connectorsQuery.data]);
  const catalog = connectorsQuery.data?.catalog ?? [];
  const oauthRedirectUri = connectorsQuery.data?.oauthRedirectUri;
  const microsoftApp = connectorsQuery.data?.microsoftApp;
  // Derived from the LIVE list so create/delete flips the placeholder rows
  // immediately (same rule as /settings/keys).
  const availableCatalog = catalog.filter(
    (c) => !connectors.some((k) => k.slug === `mcp-${c.slug}`),
  );
  const secretRefs = (keysQuery.data ?? []).map((k) => ({
    ref: `${k.service}/${k.label}`,
    masked: k.masked,
  }));

  const [sel, setSel] = useState<{ mode: 'create' } | { mode: 'view'; slug: string } | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [errors, setErrors] = useState<{
    slug?: string;
    url?: string;
    secretRef?: string;
    clientId?: string;
  }>({});
  const [deleteTarget, setDeleteTarget] = useState<ConnectorRow | null>(null);
  const selected =
    sel?.mode === 'view' ? (connectors.find((c) => c.slug === sel.slug) ?? null) : null;
  // The catalogue's customer-side steps (e.g. Power BI's Azure setup), shown
  // while creating from it and until the connector first connects.
  const setupEntry =
    sel?.mode === 'create'
      ? catalog.find((c) => c.slug === form.slug)
      : sel?.mode === 'view'
        ? catalog.find((c) => `mcp-${c.slug}` === sel.slug)
        : undefined;
  const showSetup =
    !!setupEntry?.setup?.length && selected?.integration?.mcp?.oauth?.status !== 'connected';

  // While an authorization tab is open, poll until the connector reports
  // `connected` (the callback runs on the brain origin — this screen only
  // sees the result via the list).
  const [oauthWatch, setOauthWatch] = useState<string | null>(null);
  const watchDeadline = useRef(0);
  useEffect(() => {
    if (!oauthWatch) return;
    const watched = connectors.find((c) => c.slug === oauthWatch);
    if (watched?.integration?.mcp?.oauth?.status === 'connected') {
      setOauthWatch(null);
      toast.success(`${watched.name} authorized — ${watched.toolSlugs.length} tools synced.`);
      return;
    }
    if (Date.now() > watchDeadline.current) {
      setOauthWatch(null);
      return;
    }
    const t = setInterval(
      () => queryClient.invalidateQueries({ queryKey: ['mcp-connectors'] }),
      3000,
    );
    return () => clearInterval(t);
  }, [oauthWatch, connectors, queryClient, toast]);
  const startOAuthWatch = (slug: string) => {
    watchDeadline.current = Date.now() + 3 * 60_000;
    setOauthWatch(slug);
  };

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['mcp-connectors'] });

  const createMutation = useMutation({
    mutationFn: (vars: { body: Record<string, unknown>; tab: Window | null }) =>
      apiSend<{
        groupSlug: string;
        sync?: SyncResult;
        syncError?: string;
        authorizeUrl?: string;
        /** The connector exists, but its authorization could not start. */
        oauthError?: string;
      }>('/api/mcp-connectors', 'POST', vars.body),
    onSuccess: (res, vars) => {
      play('success');
      invalidate();
      setSel({ mode: 'view', slug: res.groupSlug });
      if (res.authorizeUrl) {
        if (vars.tab) vars.tab.location.href = res.authorizeUrl;
        else window.open(res.authorizeUrl, '_blank', 'noopener');
        startOAuthWatch(res.groupSlug);
        toast.success('Approve the connection in the tab that just opened.');
      } else {
        // No authorization needed after all — nothing will navigate the tab we
        // opened ahead of the answer, so it would sit there blank.
        vars.tab?.close();
        if (res.oauthError) {
          toast.error(`Connector created, but authorization could not start: ${res.oauthError}`);
        } else if (res.syncError) {
          toast.error(`Connector created, but the first sync failed: ${res.syncError}`);
        } else if (res.sync) {
          toast.success(`Connected — ${res.sync.toolSlugs.length} tools synced.`);
        }
      }
    },
    onError: (e, vars) => {
      play('danger');
      vars.tab?.close();
      toast.error(e instanceof Error ? e.message : 'Create failed.');
    },
  });

  /** `form`: the form's Save, which sounds; the Enabled switch stays quiet. */
  const saveMutation = useMutation({
    mutationFn: (vars: { slug: string; body: Record<string, unknown>; form?: boolean }) =>
      apiSend(`/api/mcp-connectors/${vars.slug}`, 'PATCH', vars.body),
    onSuccess: (_res, vars) => {
      invalidate();
      if (vars.form) play('success');
      toast.success(
        vars.body.oauthClient
          ? 'Connector saved. Authorize it again to sign in with the new app.'
          : 'Connector saved.',
      );
    },
    onError: (e, vars) => {
      if (vars.form) play('danger');
      toast.error(e instanceof Error ? e.message : 'Save failed.');
    },
  });

  const syncMutation = useMutation({
    mutationFn: (slug: string) =>
      apiSend<{ sync: SyncResult }>(`/api/mcp-connectors/${slug}/sync`, 'POST'),
    onSuccess: ({ sync }) => {
      invalidate();
      toast.success(
        `Synced — ${sync.toolSlugs.length} tools (${sync.added} added, ${sync.updated} updated, ${sync.disabled} disabled).`,
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Sync failed.'),
  });

  const reconnectMutation = useMutation({
    mutationFn: (vars: { slug: string; tab: Window | null }) =>
      apiSend<{ authorizeUrl?: string; alreadyAuthorized?: boolean }>(
        `/api/mcp-connectors/${vars.slug}/oauth/start`,
        'POST',
      ),
    onSuccess: (res, vars) => {
      if (res.authorizeUrl) {
        if (vars.tab) vars.tab.location.href = res.authorizeUrl;
        else window.open(res.authorizeUrl, '_blank', 'noopener');
        startOAuthWatch(vars.slug);
        toast.success('Approve the connection in the tab that just opened.');
      } else {
        vars.tab?.close();
        invalidate();
        toast.success('Already authorized.');
      }
    },
    onError: (e, vars) => {
      vars.tab?.close();
      toast.error(e instanceof Error ? e.message : 'Could not start the authorization.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (slug: string) => apiSend(`/api/mcp-connectors/${slug}`, 'DELETE'),
    onSuccess: (_d, slug) => {
      invalidate();
      if (sel?.mode === 'view' && sel.slug === slug) setSel(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Delete failed.'),
  });

  const openCreate = (prefill?: CatalogEntry) => {
    setForm(prefill ? formFromCatalog(prefill) : emptyForm());
    setErrors({});
    setSel({ mode: 'create' });
  };
  const openView = (c: ConnectorRow) => {
    setForm(formFromConnector(c));
    setErrors({});
    setSel({ mode: 'view', slug: c.slug });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sel) return;
    const next: typeof errors = {};
    if (sel.mode === 'create') {
      const slug = form.slug.trim().toLowerCase();
      if (!slug) next.slug = 'A slug is required.';
      else if (!/^[a-z0-9_-]+$/.test(slug))
        next.slug = 'Lower-case letters, digits, hyphen and underscore only.';
    }
    if (!/^https?:\/\/\S+$/i.test(form.url.trim()))
      next.url = 'The server’s streamable-HTTP endpoint, starting with https://.';
    if (form.auth === 'key' && !form.secretRef)
      next.secretRef = 'Pick the vault key this server authenticates with.';
    if (form.auth === 'oauth' && form.oauthApp === 'manual' && !form.clientId.trim())
      next.clientId = 'The client id of the app you registered.';
    if (next.slug || next.url || next.secretRef || next.clientId) {
      setErrors(next);
      const first = next.slug
        ? 'connector-slug'
        : next.url
          ? 'connector-url'
          : next.secretRef
            ? 'connector-secret'
            : 'connector-client-id';
      document.getElementById(first)?.focus();
      return;
    }
    setErrors({});

    if (sel.mode === 'create') {
      // The tab must exist before the request returns or popup blockers eat it.
      const tab = form.auth === 'oauth' ? openTab() : null;
      createMutation.mutate({
        tab,
        body: {
          slug: form.slug.trim().toLowerCase(),
          ...(form.name.trim() ? { name: form.name.trim() } : {}),
          url: form.url.trim(),
          ...(form.auth === 'key' ? { secretRef: form.secretRef } : {}),
          ...(form.auth === 'oauth' ? { oauth: true } : {}),
          ...(form.auth === 'oauth' && form.oauthApp !== 'dynamic'
            ? { oauthClient: oauthClientBody(form) }
            : {}),
          ...(form.auth === 'oauth' && form.scope.trim() ? { scope: form.scope.trim() } : {}),
        },
      });
    } else {
      saveMutation.mutate({
        slug: sel.slug,
        form: true,
        body: {
          name: form.name.trim() || undefined,
          url: form.url.trim(),
          // '' clears the credential (switching to OAuth/none leaves tokens alone).
          secretRef: form.auth === 'key' ? form.secretRef : '',
          ...(form.auth === 'oauth' &&
          selected &&
          oauthAppChanged(form, formFromConnector(selected))
            ? { oauthClient: oauthClientBody(form) }
            : {}),
          ...(form.auth === 'oauth' &&
          selected &&
          form.scope.trim() !== formFromConnector(selected).scope
            ? { scope: form.scope.trim() }
            : {}),
        },
      });
    }
  };

  if (connectorsQuery.isPending) {
    return (
      <div className="flex h-full items-center justify-center py-16">
        <Spinner />
      </div>
    );
  }

  return (
    <>
      <MasterDetail
        id="settings-connectors"
        defaultListSize="360px"
        // No `detailFills`: the detail is a form; the 672px measure is deliberate (§8).
        list={
          <>
            <div className="flex items-center justify-between gap-2 border-b border-border p-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                MCP connectors
              </h2>
              <Button type="button" size="sm" onClick={() => openCreate()}>
                <Plus /> New
              </Button>
            </div>
            <div className="space-y-2 p-3 md:flex-1 md:overflow-y-auto md:scrollbar-thin">
              {connectorsQuery.isError ? (
                <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-6 text-center text-sm text-destructive-ink">
                  <p>Couldn’t load connectors: {connectorsQuery.error.message}</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => connectorsQuery.refetch()}
                  >
                    Retry
                  </Button>
                </div>
              ) : connectors.length === 0 && availableCatalog.length === 0 ? (
                <p className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
                  No connectors yet. Click <strong>New</strong> to point MantleOS at an external MCP
                  server.
                </p>
              ) : (
                <>
                  {connectors.map((c) => {
                    const mcp = c.integration?.mcp;
                    let host = mcp?.url ?? '';
                    try {
                      host = new URL(host).host;
                    } catch {
                      /* keep raw */
                    }
                    return (
                      <ListCard
                        key={c.id}
                        onClick={() => openView(c)}
                        selected={sel?.mode === 'view' && sel.slug === c.slug}
                        dimmed={!c.enabled}
                      >
                        <div className="flex items-center gap-2">
                          <ListCardTitle>{c.name}</ListCardTitle>
                          <span className="shrink-0 rounded-sm bg-muted px-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                            {c.toolSlugs.length} tool{c.toolSlugs.length === 1 ? '' : 's'}
                          </span>
                          {mcp?.oauth && <OAuthStatusPill oauth={mcp.oauth} />}
                          {!c.enabled && (
                            <span className="shrink-0 rounded-sm bg-muted px-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                              off
                            </span>
                          )}
                        </div>
                        <ListCardMeta className="font-mono">{host}</ListCardMeta>
                        {c.grantedTo.length > 0 && (
                          <div
                            className="mt-1 text-xs text-info-ink"
                            title={c.grantedTo.join('\n')}
                          >
                            ↳ granted to {c.grantedTo.length} agent
                            {c.grantedTo.length === 1 ? '' : 's'}
                          </div>
                        )}
                      </ListCard>
                    );
                  })}
                  {availableCatalog.length > 0 && (
                    <>
                      <p className="pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Known servers
                      </p>
                      {availableCatalog.map((c) => (
                        <ListCard
                          key={c.slug}
                          className="border-dashed"
                          onClick={() => openCreate(c)}
                          selected={sel?.mode === 'create' && form.slug === c.slug}
                        >
                          <div className="flex items-baseline gap-2">
                            <ListCardTitle>{c.label}</ListCardTitle>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              not connected
                            </span>
                          </div>
                          <ListCardSnippet>{c.description}</ListCardSnippet>
                        </ListCard>
                      ))}
                    </>
                  )}
                </>
              )}
            </div>
          </>
        }
        detail={
          sel ? (
            <div className="space-y-4 p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold">
                    {sel.mode === 'create' ? 'New connector' : (selected?.name ?? 'Connector')}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {sel.mode === 'create'
                      ? 'Point MantleOS at an external MCP server. Its tools become a tool group you grant to an agent.'
                      : 'Tool results from this server arrive fenced as untrusted content. Grant its group to a no-write specialist, not the persona.'}
                  </p>
                </div>
                {sel.mode === 'view' && selected && (
                  <div className="flex shrink-0 items-center gap-3">
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <Switch
                        checked={selected.enabled}
                        onCheckedChange={(v) =>
                          saveMutation.mutate({ slug: selected.slug, body: { enabled: v } })
                        }
                      />
                      Enabled
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive-ink"
                      onClick={() => setDeleteTarget(selected)}
                      aria-label={`Delete ${selected.name}`}
                      title="Delete connector"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                )}
              </div>

              {sel.mode === 'view' && selected?.integration?.mcp && (
                <div className="space-y-2 rounded-lg border border-border bg-card/40 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground">
                      {selected.integration.mcp.serverInfo?.name ?? 'Server'}
                      {selected.integration.mcp.serverInfo?.version
                        ? ` v${selected.integration.mcp.serverInfo.version}`
                        : ''}
                    </span>
                    {selected.integration.mcp.oauth && (
                      <OAuthStatusPill oauth={selected.integration.mcp.oauth} />
                    )}
                    <span className="text-xs text-muted-foreground">
                      {selected.integration.mcp.lastSyncAt
                        ? `Last synced ${new Date(selected.integration.mcp.lastSyncAt).toLocaleString()}`
                        : 'Never synced'}
                    </span>
                  </div>
                  {selected.integration.mcp.oauth?.lastError && (
                    <p className="text-xs text-destructive-ink">
                      {selected.integration.mcp.oauth.lastError}
                    </p>
                  )}
                  {selected.toolSlugs.length > 0 && (
                    <p className="font-mono text-xs text-muted-foreground">
                      {selected.toolSlugs.join(' · ')}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={syncMutation.isPending}
                      onClick={() => syncMutation.mutate(selected.slug)}
                    >
                      <RefreshCw className={syncMutation.isPending ? 'animate-spin' : ''} />
                      Sync tools
                    </Button>
                    {selected.integration.mcp.oauth && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={reconnectMutation.isPending}
                        onClick={() => {
                          const tab = openTab();
                          reconnectMutation.mutate({ slug: selected.slug, tab });
                        }}
                      >
                        {selected.integration.mcp.oauth.status === 'connected'
                          ? 'Re-authorize'
                          : 'Authorize'}
                      </Button>
                    )}
                    {selected.grantedTo.length === 0 ? (
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/settings/agents`}>Grant to an agent</Link>
                      </Button>
                    ) : (
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/settings/tool-groups?selected=${selected.slug}`}>
                          View tool group
                        </Link>
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {showSetup && setupEntry?.setup && (
                <div className="space-y-2 rounded-lg border border-info/30 bg-info/10 p-3 text-sm">
                  <p className="font-medium text-info-ink">Before you connect {setupEntry.label}</p>
                  <ol className="list-decimal space-y-1 pl-5">
                    {setupEntry.setup.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                  <a
                    href={setupEntry.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-info-ink underline underline-offset-2"
                  >
                    The provider’s setup guide
                  </a>
                </div>
              )}

              <form onSubmit={submit} noValidate>
                <FieldGroup>
                  {sel.mode === 'create' && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field data-invalid={!!errors.slug || undefined}>
                        <FieldLabel htmlFor="connector-slug">Slug</FieldLabel>
                        <Input
                          id="connector-slug"
                          value={form.slug}
                          onChange={(e) => {
                            setForm((f) => ({ ...f, slug: e.target.value }));
                            setErrors((c) => ({ ...c, slug: undefined }));
                          }}
                          placeholder="firecrawl"
                          className="font-mono"
                          autoFocus
                          aria-invalid={!!errors.slug || undefined}
                          aria-describedby={errors.slug ? 'slug-error slug-hint' : 'slug-hint'}
                        />
                        <FieldDescription id="slug-hint">
                          The tool group becomes <code className="font-mono">mcp-&lt;slug&gt;</code>
                          . Fixed once created.
                        </FieldDescription>
                        <FieldError id="slug-error">{errors.slug}</FieldError>
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="connector-name">Name</FieldLabel>
                        <Input
                          id="connector-name"
                          value={form.name}
                          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                          placeholder="Firecrawl MCP"
                        />
                        <FieldDescription>Optional — defaults from the catalog.</FieldDescription>
                      </Field>
                    </div>
                  )}
                  {sel.mode === 'view' && (
                    <Field>
                      <FieldLabel htmlFor="connector-name">Name</FieldLabel>
                      <Input
                        id="connector-name"
                        value={form.name}
                        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      />
                    </Field>
                  )}

                  <Field data-invalid={!!errors.url || undefined}>
                    <FieldLabel htmlFor="connector-url">Server URL</FieldLabel>
                    <Input
                      id="connector-url"
                      value={form.url}
                      onChange={(e) => {
                        setForm((f) => ({ ...f, url: e.target.value }));
                        setErrors((c) => ({ ...c, url: undefined }));
                      }}
                      placeholder="https://mcp.firecrawl.dev/v2/mcp"
                      className="font-mono"
                      aria-invalid={!!errors.url || undefined}
                      aria-describedby={errors.url ? 'url-error url-hint' : 'url-hint'}
                    />
                    <FieldDescription id="url-hint">
                      The server’s streamable-HTTP endpoint. Private and local addresses are
                      refused.
                    </FieldDescription>
                    <FieldError id="url-error">{errors.url}</FieldError>
                  </Field>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="connector-auth">Authentication</FieldLabel>
                      <Select
                        value={form.auth}
                        onValueChange={(v) => setForm((f) => ({ ...f, auth: v as AuthMode }))}
                        disabled={sel.mode === 'view' && form.auth === 'oauth'}
                      >
                        <SelectTrigger id="connector-auth">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None (public server)</SelectItem>
                          <SelectItem value="key">API key from the vault</SelectItem>
                          <SelectItem value="oauth">OAuth (sign in via browser)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FieldDescription>
                        {form.auth === 'oauth'
                          ? 'You approve the connection in a browser tab; tokens are sealed in the vault and refresh silently.'
                          : form.auth === 'key'
                            ? 'Sent as a bearer header; only the vault pointer is stored.'
                            : 'No credential is sent.'}
                      </FieldDescription>
                    </Field>
                    {form.auth === 'key' && (
                      <Field data-invalid={!!errors.secretRef || undefined}>
                        <FieldLabel htmlFor="connector-secret">Credential</FieldLabel>
                        <Select
                          value={form.secretRef || 'none'}
                          onValueChange={(v) => {
                            setForm((f) => ({ ...f, secretRef: v === 'none' ? '' : v }));
                            setErrors((c) => ({ ...c, secretRef: undefined }));
                          }}
                        >
                          <SelectTrigger id="connector-secret">
                            <SelectValue placeholder="Pick a vault key" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Pick a vault key…</SelectItem>
                            {secretRefs.map((r) => (
                              <SelectItem key={r.ref} value={r.ref} className="font-mono">
                                {r.ref} · {r.masked}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FieldDescription>
                          From{' '}
                          <Link href="/settings/keys" className="underline underline-offset-2">
                            Settings → API keys
                          </Link>
                          .
                        </FieldDescription>
                        <FieldError>{errors.secretRef}</FieldError>
                      </Field>
                    )}
                  </div>

                  {form.auth === 'oauth' && (
                    <>
                      <Field>
                        <FieldLabel htmlFor="connector-oauth-app">Sign-in app</FieldLabel>
                        <Select
                          value={form.oauthApp}
                          onValueChange={(v) => {
                            setForm((f) => ({ ...f, oauthApp: v as OAuthApp }));
                            setErrors((c) => ({ ...c, clientId: undefined }));
                          }}
                        >
                          <SelectTrigger id="connector-oauth-app">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="dynamic">Registers itself (most servers)</SelectItem>
                            <SelectItem
                              value="microsoft"
                              disabled={microsoftApp?.configured === false}
                            >
                              Microsoft app (Settings → Microsoft)
                            </SelectItem>
                            <SelectItem value="manual">An app I registered myself</SelectItem>
                          </SelectContent>
                        </Select>
                        <FieldDescription>
                          {form.oauthApp === 'microsoft' ? (
                            microsoftApp?.configured ? (
                              <>
                                Signs in with app{' '}
                                <code className="font-mono">{microsoftApp.clientId}</code> in tenant{' '}
                                <code className="font-mono">{microsoftApp.tenant}</code>, from{' '}
                                <Link
                                  href="/settings/microsoft"
                                  className="underline underline-offset-2"
                                >
                                  Settings → Microsoft
                                </Link>
                                . For servers behind Microsoft sign-in, like Power BI.
                              </>
                            ) : (
                              <>
                                Set up the app under{' '}
                                <Link
                                  href="/settings/microsoft"
                                  className="underline underline-offset-2"
                                >
                                  Settings → Microsoft
                                </Link>{' '}
                                first.
                              </>
                            )
                          ) : form.oauthApp === 'manual' ? (
                            'An app you registered with the server’s sign-in provider. Its secret is sealed in the vault.'
                          ) : (
                            'MantleOS registers itself with the server’s sign-in. Microsoft servers do not allow that: pick the Microsoft app for those.'
                          )}
                        </FieldDescription>
                      </Field>

                      {form.oauthApp === 'manual' && (
                        <>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <Field data-invalid={!!errors.clientId || undefined}>
                              <FieldLabel htmlFor="connector-client-id">Client id</FieldLabel>
                              <Input
                                id="connector-client-id"
                                value={form.clientId}
                                onChange={(e) => {
                                  setForm((f) => ({ ...f, clientId: e.target.value }));
                                  setErrors((c) => ({ ...c, clientId: undefined }));
                                }}
                                className="font-mono"
                                aria-invalid={!!errors.clientId || undefined}
                                aria-describedby={errors.clientId ? 'client-id-error' : undefined}
                              />
                              <FieldError id="client-id-error">{errors.clientId}</FieldError>
                            </Field>
                            <Field>
                              <FieldLabel htmlFor="connector-client-secret">
                                Client secret
                              </FieldLabel>
                              <SecretInput
                                id="connector-client-secret"
                                noun="secret"
                                autoComplete="off"
                                value={form.clientSecret}
                                onChange={(e) =>
                                  setForm((f) => ({ ...f, clientSecret: e.target.value }))
                                }
                                placeholder={sel.mode === 'view' ? 'Unchanged' : 'Optional'}
                                aria-describedby="client-secret-hint"
                              />
                              <FieldDescription id="client-secret-hint">
                                Sealed in the vault; never shown again.
                              </FieldDescription>
                            </Field>
                          </div>
                          <Field>
                            <FieldLabel htmlFor="connector-auth-server">Sign-in server</FieldLabel>
                            <Input
                              id="connector-auth-server"
                              value={form.authorizationServer}
                              onChange={(e) =>
                                setForm((f) => ({ ...f, authorizationServer: e.target.value }))
                              }
                              placeholder="https://login.example.com/tenant/v2.0"
                              className="font-mono"
                              aria-describedby="auth-server-hint"
                            />
                            <FieldDescription id="auth-server-hint">
                              Optional. Only when the app must sign in somewhere other than where
                              the server points, such as a single-tenant app’s own tenant.
                            </FieldDescription>
                          </Field>
                        </>
                      )}

                      {form.oauthApp !== 'dynamic' && oauthRedirectUri && (
                        <Field>
                          <FieldLabel asChild>
                            <span>Callback URL</span>
                          </FieldLabel>
                          <CopyBlock code={oauthRedirectUri} />
                          <FieldDescription>
                            Register this exact URL with the app.
                            {form.oauthApp === 'microsoft'
                              ? ' In Azure: the app → Authentication → add it under the Web platform, not “Mobile and desktop”. MantleOS sends the app’s secret, and Entra refuses a secret there.'
                              : ''}
                          </FieldDescription>
                        </Field>
                      )}

                      <Field>
                        <FieldLabel htmlFor="connector-scope">Scope</FieldLabel>
                        <Input
                          id="connector-scope"
                          value={form.scope}
                          onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value }))}
                          placeholder="Server default"
                          className="font-mono"
                          aria-describedby="scope-hint"
                        />
                        <FieldDescription id="scope-hint">
                          Optional, space-separated. Leave empty to ask for what the server
                          advertises.
                          {form.oauthApp === 'microsoft'
                            ? ' The Microsoft app always adds offline_access, so the connection can refresh.'
                            : ''}
                        </FieldDescription>
                      </Field>
                    </>
                  )}

                  <div className="flex justify-end gap-2 border-t border-border pt-3">
                    <Button type="button" variant="outline" onClick={() => setSel(null)}>
                      Cancel
                    </Button>
                    <SubmitButton pending={createMutation.isPending || saveMutation.isPending}>
                      {sel.mode === 'create'
                        ? form.auth === 'oauth'
                          ? 'Connect and authorize'
                          : 'Connect server'
                        : 'Save connector'}
                    </SubmitButton>
                  </div>
                </FieldGroup>
              </form>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-10 text-center text-sm text-muted-foreground">
              Select a connector, or connect a known server from the list.
            </div>
          )
        }
      />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                const refs = deleteTarget?.grantedTo ?? [];
                const base =
                  'Its tool group, mirrored tools, and any sealed OAuth tokens are removed.';
                if (refs.length === 0) return `${base} This cannot be undone.`;
                return `${base} Granted to ${refs.length} agent${refs.length === 1 ? '' : 's'} (${refs.join(', ')}) — the grant will be removed. This cannot be undone.`;
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const c = deleteTarget;
                if (!c) return;
                setDeleteTarget(null);
                deleteMutation.mutate(c.slug, {
                  onSuccess: () => toast.success(`Deleted ${c.name}`),
                });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
