'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Link2,
  Network,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { apiFetch, apiSend, ApiError } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { CopyButton } from '@mantle/web-ui/ui/copy-button';
import { Input } from '@mantle/web-ui/ui/input';
import { Label } from '@mantle/web-ui/ui/label';
import { SecretInput } from '@mantle/web-ui/ui/secret-input';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@mantle/web-ui/ui/field';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import { Switch } from '@mantle/web-ui/ui/switch';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
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
import { useToast } from '@mantle/web-ui/ui/toast';
import { ListCard, ListCardTitle } from '@mantle/web-ui/ui/list-card';
import { formatDateTime, timeAgo } from '@mantle/web-ui/lib/format-datetime';
import { HeaderIconButton, HeaderInfoButton, ItemHeader } from '@/components/layout/item-header';
import { PeerToolAccess, usePeerLogins, type PeerAccess } from './peer-access';
import { FlagRow, PeerColumnHeading, PeerSection, PeerStatePill } from './peer-section';
import { peerHost, peerState, peerStateText } from './peer-status';
import { PeerTokens, ThisBrainAddress, type Reveal } from './peer-tokens';

type Peer = {
  id: string;
  displayName: string;
  baseUrl: string;
  status: string;
  enabled: boolean;
  hasOutboundToken: boolean;
  lastContactedAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
} & PeerAccess;
type Share = { id: string; nodeId: string; nodeType: string; title: string; createdAt: string };
type TypeShare = { id: string; nodeType: string; createdAt: string };
type NodeHit = { id: string; title: string; type: string };
type Selection = { mode: 'create' } | { mode: 'view'; id: string };

/** The categories a peer can subscribe to — mirrors PEER_SHAREABLE_TYPES
 *  (@mantle/content); the server enforces the allowlist. */
const CATEGORIES = [
  { type: 'page', label: 'Pages', one: 'page' },
  { type: 'note', label: 'Notes', one: 'note' },
  { type: 'file', label: 'Files', one: 'file' },
  { type: 'contact', label: 'Contacts', one: 'contact' },
  { type: 'table', label: 'Tables', one: 'table' },
  { type: 'draw', label: 'Drawings', one: 'drawing' },
  { type: 'event', label: 'Events', one: 'event' },
  { type: 'task', label: 'Tasks', one: 'task' },
] as const;

/** A time as "3 hours ago", the full date on hover; "never" when unset. */
function When({ iso }: { iso: string | null }) {
  if (!iso) return <span className="text-muted-foreground">never</span>;
  return <time title={formatDateTime(iso)}>{timeAgo(iso)}</time>;
}

/** Outer query-gate so the page stays data-free. */
export function PeersClient() {
  const peersQuery = useQuery({
    queryKey: ['peers'],
    queryFn: () => apiFetch<{ peers: Peer[] }>('/api/peers'),
  });
  if (peersQuery.isPending) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }
  if (peersQuery.isError && !peersQuery.data) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-sm text-muted-foreground">
        <p>Couldn&apos;t load peers.</p>
        <Button variant="outline" size="sm" onClick={() => peersQuery.refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  return <PeersView initialPeers={peersQuery.data.peers} />;
}

/** Once peers are loaded, this owns the working list (seeds from the fetch,
 *  then mutates locally as peers are added/edited/removed). */
function PeersView({ initialPeers }: { initialPeers: Peer[] }) {
  const [peers, setPeers] = useState<Peer[]>(initialPeers);
  // Deep link: /settings/peers?selected=<id-or-display-name> preselects that
  // peer (initial state only — selection stays client-state after).
  const searchParams = useSearchParams();
  const [sel, setSel] = useState<Selection>(() => {
    const want = searchParams.get('selected')?.trim();
    const hit = want
      ? initialPeers.find((p) => p.id === want || p.displayName === want)
      : undefined;
    if (hit) return { mode: 'view', id: hit.id };
    return initialPeers[0] ? { mode: 'view', id: initialPeers[0].id } : { mode: 'create' };
  });
  const [reveal, setReveal] = useState<Reveal | null>(null);

  const selected = sel.mode === 'view' ? (peers.find((p) => p.id === sel.id) ?? null) : null;

  return (
    <MasterDetail
      id="settings-peers"
      // The 340px this screen has always had.
      defaultListSize="340px"
      // No `detailFills`: the detail is a form. It opens wider than the 672px
      // default because its permissions sit in two columns (categories |
      // tools); below ~640px of pane they stack (@container, @xl).
      defaultDetailSize="800px"
      list={
        <>
          <div className="flex items-center justify-between gap-2 border-b border-border p-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">Linked brains</h2>
              <p className="text-xs text-muted-foreground">
                {peers.length === 0
                  ? 'None yet'
                  : `${peers.length} ${peers.length === 1 ? 'brain' : 'brains'}`}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setReveal(null);
                setSel({ mode: 'create' });
              }}
            >
              <Plus /> Link a brain
            </Button>
          </div>
          <div className="space-y-2 p-3 md:flex-1 md:overflow-y-auto md:scrollbar-thin">
            {peers.length === 0 ? (
              <p className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
                No linked brains yet. Link another MantleOS brain to share content with it, or to
                let it call this brain&apos;s tools.
              </p>
            ) : (
              peers.map((p) => {
                const state = peerState(p);
                return (
                  <ListCard
                    key={p.id}
                    onClick={() => {
                      setReveal(null);
                      setSel({ mode: 'view', id: p.id });
                    }}
                    selected={sel.mode === 'view' && sel.id === p.id}
                    dimmed={state === 'off'}
                  >
                    <div className="flex items-center gap-2">
                      <Network className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <ListCardTitle>{p.displayName}</ListCardTitle>
                      <PeerStatePill state={state} className="ml-auto" />
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="min-w-0 flex-1 truncate">{peerHost(p.baseUrl)}</span>
                      {p.lastContactedAt || p.lastSeenAt ? (
                        <span className="shrink-0">
                          <When
                            iso={
                              [p.lastContactedAt, p.lastSeenAt]
                                .filter((x): x is string => !!x)
                                .sort()
                                .at(-1) ?? null
                            }
                          />
                        </span>
                      ) : null}
                    </div>
                  </ListCard>
                );
              })
            )}
          </div>
        </>
      }
      detail={
        sel.mode === 'create' ? (
          <CreatePeer
            onCreated={(peer, inboundToken) => {
              setPeers((p) => [peer, ...p]);
              setReveal({ token: inboundToken, replaced: false });
              setSel({ mode: 'view', id: peer.id });
            }}
          />
        ) : selected ? (
          <PeerDetail
            key={selected.id}
            peer={selected}
            reveal={reveal}
            onClearReveal={() => setReveal(null)}
            onChanged={(patch) =>
              setPeers((list) => list.map((p) => (p.id === selected.id ? { ...p, ...patch } : p)))
            }
            // A rotate or an owner bind: either way the old inbound token is gone.
            onRevealNew={(t) => setReveal({ token: t, replaced: true })}
            onDeleted={() => {
              const next = peers.filter((p) => p.id !== selected.id);
              setPeers(next);
              setReveal(null);
              setSel(next[0] ? { mode: 'view', id: next[0].id } : { mode: 'create' });
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-10 text-center text-sm text-muted-foreground">
            Select a brain, or link a new one.
          </div>
        )
      }
    />
  );
}

/** The three steps of a link, in order, for the create screen. */
const LINK_STEPS = [
  {
    title: 'Add their brain here',
    body: 'Give it a name and its address. This brain makes a token for them and shows it once.',
  },
  {
    title: 'Swap tokens',
    body: 'Send them that token. Their owner links this brain on their side (with the address below) and pastes it there; their brain then shows a token for you.',
  },
  {
    title: 'Paste their token',
    body: 'Paste it here now or later, on this brain’s page. Then both brains can call each other. Neither side has to go first.',
  },
] as const;

function CreatePeer({ onCreated }: { onCreated: (peer: Peer, inboundToken: string) => void }) {
  const toast = useToast();
  const [displayName, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [outboundToken, setOutbound] = useState('');
  const [pending, setPending] = useState(false);
  /**
   * §6b. One toast said "Name and base URL are required" — a single message for
   * two controls, in a corner, naming neither one on screen. Each field says so
   * itself now. The rule is unchanged.
   */
  const [errors, setErrors] = useState<{ name?: string; url?: string }>({});

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: { name?: string; url?: string } = {};
    if (!displayName.trim()) next.name = 'A name is required.';
    if (!baseUrl.trim()) next.url = 'An address is required.';
    if (next.name || next.url) {
      setErrors(next);
      document.getElementById(next.name ? 'peer-name' : 'peer-url')?.focus();
      return;
    }
    setErrors({});
    setPending(true);
    try {
      const { peer, inboundToken } = await apiSend<{ peer: Peer; inboundToken: string }>(
        '/api/peers',
        'POST',
        {
          displayName: displayName.trim(),
          baseUrl: baseUrl.trim(),
          ...(outboundToken.trim() ? { outboundToken: outboundToken.trim() } : {}),
        },
      );
      toast.success(`Added ${peer.displayName}. Copy your token for them now`);
      onCreated(peer, inboundToken);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not add the brain');
    }
    setPending(false);
  };

  return (
    <div className="@container">
      <ItemHeader
        sticky
        visual={<Network className="size-4 text-muted-foreground" aria-hidden />}
        title="Link another brain"
        // Nothing to act on yet: no Focus or More slots.
        iconActions={null}
      />
      <div className="space-y-5 p-6">
        <PeerSection
          id="peer-how"
          icon={Link2}
          title="How linking works"
          description="Two brains link with two tokens, one for each direction."
        >
          <ol className="grid gap-3 @xl:grid-cols-3">
            {LINK_STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-3 rounded-md border border-border p-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{s.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-3">
            <ThisBrainAddress />
          </div>
        </PeerSection>

        <PeerSection id="peer-new" icon={Network} title="Their brain">
          <form onSubmit={submit} noValidate>
            <FieldGroup>
              <Field data-invalid={!!errors.name || undefined}>
                <FieldLabel htmlFor="peer-name">Name</FieldLabel>
                <Input
                  id="peer-name"
                  value={displayName}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (errors.name) setErrors((c) => ({ ...c, name: undefined }));
                  }}
                  placeholder="e.g. Lab brain"
                  autoFocus
                  aria-invalid={!!errors.name || undefined}
                  aria-describedby={
                    errors.name ? 'peer-name-error peer-name-hint' : 'peer-name-hint'
                  }
                />
                <FieldDescription id="peer-name-hint">
                  Your own name for it. Only you see it.
                </FieldDescription>
                <FieldError id="peer-name-error">{errors.name}</FieldError>
              </Field>
              <Field data-invalid={!!errors.url || undefined}>
                <FieldLabel htmlFor="peer-url">Address</FieldLabel>
                <Input
                  id="peer-url"
                  value={baseUrl}
                  onChange={(e) => {
                    setBaseUrl(e.target.value);
                    if (errors.url) setErrors((c) => ({ ...c, url: undefined }));
                  }}
                  placeholder="https://brain.example.com"
                  inputMode="url"
                  aria-invalid={!!errors.url || undefined}
                  aria-describedby={errors.url ? 'peer-url-error peer-url-hint' : 'peer-url-hint'}
                />
                <FieldDescription id="peer-url-hint">
                  The address their brain answers on (https://…), as their owner sees it on their
                  own Peers screen. It must be reachable from this brain.
                </FieldDescription>
                <FieldError id="peer-url-error">{errors.url}</FieldError>
              </Field>
              <Field>
                <FieldLabel htmlFor="peer-token">Their token (if you have it)</FieldLabel>
                <SecretInput
                  id="peer-token"
                  noun="token"
                  autoComplete="off"
                  value={outboundToken}
                  onChange={(e) => setOutbound(e.target.value)}
                  placeholder="mtlpeer_…"
                  aria-describedby="peer-token-hint"
                />
                <FieldDescription id="peer-token-hint">
                  The token their brain showed when they linked this one. Leave it empty if they
                  have not yet: they can already call this brain, and you paste theirs later.
                </FieldDescription>
              </Field>
              <div className="flex justify-end border-t border-border pt-3">
                <SubmitButton pending={pending}>Add brain</SubmitButton>
              </div>
            </FieldGroup>
          </form>
        </PeerSection>
      </div>
    </div>
  );
}

function PeerDetail({
  peer,
  reveal,
  onClearReveal,
  onChanged,
  onRevealNew,
  onDeleted,
}: {
  peer: Peer;
  reveal: Reveal | null;
  onClearReveal: () => void;
  onChanged: (patch: Partial<Peer>) => void;
  onRevealNew: (token: string) => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [shares, setShares] = useState<Share[]>([]);
  const [typeShares, setTypeShares] = useState<TypeShare[]>([]);
  const [typeCounts, setTypeCounts] = useState<Record<string, number>>({});
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<NodeHit[]>([]);
  const state = peerState(peer);
  const access: PeerAccess = {
    actsAsLoginId: peer.actsAsLoginId ?? null,
    // A brain before W8 only (peer-acts-as.ts).
    actsAsRole: peer.actsAsRole ?? null,
    writeEnabled: peer.writeEnabled ?? false,
    allowedRiskyTools: peer.allowedRiskyTools ?? [],
  };
  const login = usePeerLogins(access);

  const loadShares = useCallback(async () => {
    try {
      const { shares, typeShares, typeCounts } = await apiFetch<{
        shares: Share[];
        typeShares: TypeShare[];
        typeCounts: Record<string, number>;
      }>(`/api/peers/${peer.id}/shares`);
      setShares(shares ?? []);
      setTypeShares(typeShares ?? []);
      setTypeCounts(typeCounts ?? {});
    } catch {
      /* leave the existing list on a transient read failure */
    }
  }, [peer.id]);

  useEffect(() => {
    void loadShares();
  }, [loadShares]);

  // Debounced node search for the grant picker.
  useEffect(() => {
    if (!q.trim()) {
      setHits([]);
      return;
    }
    const h = setTimeout(async () => {
      try {
        const { nodes } = await apiFetch<{ nodes: NodeHit[] }>(
          `/api/peers/nodes?q=${encodeURIComponent(q.trim())}`,
        );
        setHits(nodes ?? []);
      } catch {
        setHits([]);
      }
    }, 300);
    return () => clearTimeout(h);
  }, [q]);

  const toggleEnabled = async (enabled: boolean) => {
    try {
      await apiSend(`/api/peers/${peer.id}`, 'PATCH', { enabled });
      onChanged({
        enabled,
        status: enabled ? (peer.hasOutboundToken ? 'active' : 'pending') : 'revoked',
      });
      toast.success(enabled ? 'Link turned on' : 'Link turned off');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not update the link');
    }
  };

  const grant = async (nodeId: string) => {
    try {
      await apiSend(`/api/peers/${peer.id}/shares`, 'POST', { nodeId });
      setQ('');
      setHits([]);
      await loadShares();
    } catch {
      toast.error('Could not share');
    }
  };

  const toggleCategory = async (nodeType: string, on: boolean) => {
    // Optimistic flip so the Switch doesn't lag; reload reconciles, revert on error.
    setTypeShares((list) =>
      on
        ? [...list, { id: `optimistic-${nodeType}`, nodeType, createdAt: new Date().toISOString() }]
        : list.filter((t) => t.nodeType !== nodeType),
    );
    try {
      if (on) {
        await apiSend(`/api/peers/${peer.id}/shares`, 'POST', { nodeType });
      } else {
        await apiSend(`/api/peers/${peer.id}/shares?nodeType=${nodeType}`, 'DELETE');
      }
      await loadShares();
    } catch {
      setTypeShares((list) =>
        on
          ? list.filter((t) => t.nodeType !== nodeType)
          : [
              ...list,
              { id: `optimistic-${nodeType}`, nodeType, createdAt: new Date().toISOString() },
            ],
      );
      toast.error('Could not update category share');
    }
  };

  const revoke = async (nodeId: string) => {
    try {
      await apiSend(`/api/peers/${peer.id}/shares?nodeId=${nodeId}`, 'DELETE');
      await loadShares();
    } catch {
      toast.error('Could not stop sharing');
    }
  };

  const confirmDelete = async () => {
    setDeleteOpen(false);
    try {
      await apiSend(`/api/peers/${peer.id}`, 'DELETE');
      toast.success(`Removed ${peer.displayName}`);
      onDeleted();
    } catch {
      toast.error('Could not remove the link');
    }
  };

  const grantedIds = new Set(shares.map((s) => s.nodeId));
  const categoriesOn = CATEGORIES.filter((c) => typeShares.some((t) => t.nodeType === c.type));

  return (
    <div className="@container">
      <ItemHeader
        sticky
        visual={<Network className="size-4 text-muted-foreground" aria-hidden />}
        title={peer.displayName}
        badges={<PeerStatePill state={state} />}
        iconActions={
          <>
            <HeaderInfoButton label="About this link">
              <p className="break-all font-mono text-xs">{peer.baseUrl}</p>
              <p className="text-xs text-muted-foreground">
                Added {formatDateTime(peer.createdAt)}. Changed {formatDateTime(peer.updatedAt)}.
              </p>
              <p className="text-xs text-muted-foreground">
                Read tools (peer_query, peer_search_chunks, peer_node_get) see only what you share
                here. Their peer_tools and peer_call need Acts as set for them below.
              </p>
            </HeaderInfoButton>
            <HeaderIconButton
              label={`Remove ${peer.displayName}`}
              className="text-muted-foreground hover:text-destructive-ink"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 />
            </HeaderIconButton>
          </>
        }
      />

      <div className="space-y-5 p-6">
        {/* Connection: both directions at a glance, and the on/off switch. */}
        <PeerSection
          id={`peer-connection-${peer.id}`}
          icon={Link2}
          title="Connection"
          description={peerStateText(state, peer.displayName)}
          control={
            <>
              <Label
                htmlFor={`peer-enabled-${peer.id}`}
                className="text-xs font-normal text-muted-foreground"
              >
                {peer.enabled ? 'On' : 'Off'}
              </Label>
              <Switch
                id={`peer-enabled-${peer.id}`}
                checked={peer.enabled}
                onCheckedChange={toggleEnabled}
              />
            </>
          }
        >
          <div className="grid gap-3 @xl:grid-cols-2">
            <DirectionTile
              icon={ArrowUpRight}
              title={`This brain → ${peer.displayName}`}
              rows={[
                {
                  label: 'Their token',
                  value: peer.hasOutboundToken ? (
                    <span className="text-success-ink">saved</span>
                  ) : (
                    <span className="text-warning-ink">missing</span>
                  ),
                },
                { label: 'Last call to them', value: <When iso={peer.lastContactedAt} /> },
              ]}
            />
            <DirectionTile
              icon={ArrowDownLeft}
              title={`${peer.displayName} → this brain`}
              rows={[
                { label: 'Acts as here', value: login.label },
                { label: 'Last call from them', value: <When iso={peer.lastSeenAt} /> },
              ]}
            />
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5">
            <span className="shrink-0 text-xs text-muted-foreground">Their address</span>
            <code className="min-w-0 flex-1 truncate font-mono text-xs">{peer.baseUrl}</code>
            <CopyButton value={peer.baseUrl} ariaLabel="Copy their address" />
          </div>
          <div className="mt-2">
            <ThisBrainAddress />
          </div>
        </PeerSection>

        <PeerTokens
          peer={peer}
          reveal={reveal}
          onClearReveal={onClearReveal}
          onRevealNew={onRevealNew}
          onSaved={() =>
            onChanged({
              hasOutboundToken: true,
              ...(peer.status === 'pending' ? { status: 'active' } : {}),
            })
          }
        />

        {/* Permissions: what they may reach, content left, tools right. */}
        <PeerSection
          id={`peer-permissions-${peer.id}`}
          icon={ShieldCheck}
          title={`What ${peer.displayName} can reach here`}
          description="Everything is private until you switch it on. Each switch saves at once."
        >
          <div className="grid gap-6 @xl:grid-cols-2 @xl:gap-0 @xl:divide-x @xl:divide-border">
            <div className="@xl:pr-5">
              <PeerColumnHeading
                title="Share whole categories"
                aside={
                  <span className="text-xs text-muted-foreground">
                    {categoriesOn.length}/{CATEGORIES.length} on
                  </span>
                }
                description="Every item of the type, including ones you make later. Read only."
              />
              <div className="divide-y divide-border rounded-md border border-border px-3">
                {CATEGORIES.map((c) => {
                  const on = typeShares.some((t) => t.nodeType === c.type);
                  const count = typeCounts[c.type] ?? 0;
                  return (
                    <FlagRow
                      key={c.type}
                      id={`peer-cat-${peer.id}-${c.type}`}
                      label={c.label}
                      hint={`${count} ${count === 1 ? c.one : c.label.toLowerCase()}${on ? ', and new ones' : ''}`}
                      checked={on}
                      onCheckedChange={(v) => toggleCategory(c.type, v)}
                    />
                  );
                })}
              </div>
              <div className="mt-6">
                <PeerColumnHeading
                  title="Shared items"
                  aside={<span className="text-xs text-muted-foreground">{shares.length}</span>}
                  description="Single items beyond the categories. Read only."
                />
                <div className="space-y-3">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="Search an item to share"
                      aria-label="Search items to share"
                      className="pl-8"
                    />
                  </div>
                  {hits.length > 0 ? (
                    <ul className="divide-y divide-border rounded-md border border-border">
                      {hits.map((h) => (
                        <li key={h.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                            {h.type}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{h.title}</span>
                          {grantedIds.has(h.id) ? (
                            <span className="text-xs text-muted-foreground">shared</span>
                          ) : (
                            <Button
                              type="button"
                              size="xs"
                              variant="outline"
                              onClick={() => grant(h.id)}
                            >
                              Share
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {shares.length === 0 ? (
                    <p className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-4 text-center text-xs text-muted-foreground">
                      {typeShares.length > 0
                        ? 'No single items: it reads the categories above.'
                        : 'Nothing shared yet: it can read nothing here.'}
                    </p>
                  ) : (
                    <ul className="divide-y divide-border rounded-md border border-border">
                      {shares.map((s) => (
                        <li key={s.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                            {s.nodeType}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{s.title}</span>
                          <Button
                            type="button"
                            size="icon-2xs"
                            variant="ghost"
                            className="text-muted-foreground hover:text-destructive-ink"
                            onClick={() => revoke(s.nodeId)}
                            aria-label={`Stop sharing ${s.title}`}
                            title="Stop sharing"
                          >
                            <X />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
            <div className="@xl:pl-5">
              <PeerToolAccess
                peerId={peer.id}
                peerName={peer.displayName}
                access={access}
                onChanged={onChanged}
                onRevealNew={onRevealNew}
              />
            </div>
          </div>
        </PeerSection>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{peer.displayName}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Both tokens stop working at once and everything shared with it is dropped. This cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** One direction of the link: who calls whom, and how it stands. */
function DirectionTile({
  icon: Icon,
  title,
  rows,
}: {
  icon: typeof ArrowUpRight;
  title: string;
  rows: { label: string; value: React.ReactNode }[];
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="mb-2 inline-flex min-w-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{title}</span>
      </p>
      <dl className="space-y-1 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">{r.label}</dt>
            <dd className="min-w-0 truncate text-right">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
