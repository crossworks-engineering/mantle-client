'use client';

/**
 * What a peer's token may do on this brain's MCP endpoint (brain migration
 * 0227, "MCP as a login"): act as one login (the owner or a member) or
 * nobody (a share-only peer), with a Write switch. Bound to the owner, the
 * owner can also allow risky tools by name, one flag each
 * (peer-risky-tools.ts). Every change saves at once through
 * PATCH /api/peers/:id; the brain checks the login. Since W8 the peer keeps
 * only the login, and acts as that login is now.
 * Binding a peer to the owner may mint a new inbound token; the answer then
 * carries it and the reveal shows it once.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, TriangleAlert } from 'lucide-react';
import { apiFetch, apiSend, ApiError } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { Input } from '@mantle/web-ui/ui/input';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { Field, FieldDescription, FieldLabel } from '@mantle/web-ui/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@mantle/web-ui/ui/select';
import { useToast } from '@mantle/web-ui/ui/toast';
import { useViewerAreas, useViewerLogin } from '@/components/workspaces/use-shell-workspaces';
import { revealPatchToken, type PeerPatchAnswer } from './peer-patch';
import {
  ACTS_AS_NEEDS_USERS,
  ACTS_AS_NONE,
  actsAsOptions,
  actsAsOwner,
  actsAsValue,
  mayListUsers,
  ownerLoginId,
  type ActsAsBinding,
  type ActsAsLogin,
} from './peer-acts-as';
import {
  isRiskyToolName,
  MAX_RISKY_TOOLS,
  RISKY_TOOL_GROUPS,
  riskyGroupsFor,
  withRisky,
} from './peer-risky-tools';
import { FlagRow, PeerColumnHeading } from './peer-section';

const RISKY_COUNT = RISKY_TOOL_GROUPS.reduce((n, g) => n + g.tools.length, 0);

export type PeerAccess = ActsAsBinding & {
  writeEnabled: boolean;
  allowedRiskyTools: string[];
};

/**
 * The logins a peer may act as, and which is the owner. GET /api/users is
 * open to the `users` area only: until the shell names the areas, or
 * without it, the list is not asked, and the bound login stays a choice
 * (peer-acts-as.ts). Shared by the select and the connection summary; the
 * query is cached, so both ask once.
 */
export function usePeerLogins(access: ActsAsBinding) {
  const areas = useViewerAreas();
  const listUsers = mayListUsers(areas);
  const logins = useQuery({
    queryKey: ['users'],
    queryFn: () => apiFetch<{ users: ActsAsLogin[] }>('/api/users'),
    enabled: listUsers,
    retry: false,
  });
  const viewer = useViewerLogin();
  const ownerId = ownerLoginId(logins.data?.users, viewer);
  const options = actsAsOptions(logins.data?.users, access, ownerId);
  const value = actsAsValue(access, ownerId);
  return {
    /** The shell has answered, and the login lacks the Users area. */
    needsUsers: areas !== undefined && !listUsers,
    ownerId,
    options,
    value,
    /** What the select shows for the saved binding. */
    label: options.find((o) => o.value === value)?.label ?? 'Nobody (share only)',
    asOwner: actsAsOwner(access, ownerId),
  };
}

/**
 * The right-hand column of the peer's permissions: tool access over MCP.
 * Acts as, Write, then a flag per risky tool (a peer bound to the owner).
 */
export function PeerToolAccess({
  peerId,
  peerName,
  access,
  onChanged,
  onRevealNew,
}: {
  peerId: string;
  peerName: string;
  access: PeerAccess;
  onChanged: (patch: PeerAccess) => void;
  onRevealNew: (token: string) => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const logins = usePeerLogins(access);

  const save = async (body: Record<string, unknown>, optimistic?: Partial<PeerAccess>) => {
    setSaving(true);
    if (optimistic) onChanged({ ...access, ...optimistic });
    let saved = false;
    try {
      const answer = await apiSend<PeerPatchAnswer>(`/api/peers/${peerId}`, 'PATCH', body);
      saved = true;
      // Before the reload: the token is shown once, so a failed list read must not lose it.
      const minted = revealPatchToken(answer, onRevealNew);
      const { peers } = await apiFetch<{ peers: (PeerAccess & { id: string })[] }>('/api/peers');
      const p = peers.find((x) => x.id === peerId);
      if (p) {
        onChanged({
          actsAsLoginId: p.actsAsLoginId,
          actsAsRole: p.actsAsRole ?? null,
          writeEnabled: p.writeEnabled,
          allowedRiskyTools: p.allowedRiskyTools,
        });
      }
      toast.success(minted ? 'Saved. New token for them minted' : 'Saved');
    } catch (err) {
      if (!saved && optimistic) onChanged(access);
      if (saved) toast.error('Saved, but the list could not reload');
      else toast.error(err instanceof ApiError ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const bound = access.actsAsLoginId !== null || !!access.actsAsRole;

  return (
    <div className="space-y-4">
      <PeerColumnHeading
        title="Tools (MCP)"
        description={
          <>
            Lets {peerName} call this brain&apos;s tools as one login, with exactly that
            login&apos;s rights. Needs Remote MCP on (Settings, MCP).
          </>
        }
      />
      <Field>
        <FieldLabel htmlFor={`peer-acts-as-${peerId}`}>Acts as</FieldLabel>
        <Select
          value={logins.value}
          disabled={saving}
          onValueChange={(v) => save({ actsAs: v === ACTS_AS_NONE ? null : v })}
        >
          <SelectTrigger id={`peer-acts-as-${peerId}`} size="sm" className="w-full">
            <SelectValue placeholder="Nobody (share only)" />
          </SelectTrigger>
          <SelectContent>
            {logins.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>
          {bound
            ? 'Changing it turns Write and the risky tools off again.'
            : 'Nobody: they read only what you share, and cannot call tools here.'}
        </FieldDescription>
        {logins.needsUsers ? <FieldDescription>{ACTS_AS_NEEDS_USERS}</FieldDescription> : null}
      </Field>

      {bound ? (
        <div className="divide-y divide-border rounded-md border border-border px-3">
          <FlagRow
            id={`peer-write-${peerId}`}
            label="Write"
            hint={
              logins.asOwner
                ? 'Create, change, move and delete content here. Not the risky tools.'
                : 'Create and change content wherever that login may write.'
            }
            checked={access.writeEnabled}
            disabled={saving}
            onCheckedChange={(v) => save({ writeEnabled: v }, { writeEnabled: v })}
          />
        </div>
      ) : null}
      {bound && access.writeEnabled && logins.asOwner ? (
        <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive-ink">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {peerName} can now change this brain as you. Turn this on only for a brain you own and
          trust.
        </p>
      ) : null}

      <RiskyTools
        peerId={peerId}
        allowed={access.allowedRiskyTools}
        enabled={bound && logins.asOwner}
        saving={saving}
        onSave={(next) => save({ allowedRiskyTools: next }, { allowedRiskyTools: next })}
      />
    </div>
  );
}

/** One flag per risky tool, grouped; "Other" keeps saved names the catalog
 *  does not list, and takes a name by hand. */
function RiskyTools({
  peerId,
  allowed,
  enabled,
  saving,
  onSave,
}: {
  peerId: string;
  allowed: string[];
  /** Only a peer bound to the owner can be allowed risky tools. */
  enabled: boolean;
  saving: boolean;
  onSave: (next: string[]) => void;
}) {
  const toast = useToast();
  const [extra, setExtra] = useState('');
  const disabled = saving;
  const on = new Set(allowed);
  const groups = riskyGroupsFor(allowed);

  const set = (names: readonly string[], value: boolean) => {
    const next = withRisky(allowed, names, value);
    if (next.length > MAX_RISKY_TOOLS) {
      toast.error(`At most ${MAX_RISKY_TOOLS} risky tools per peer.`);
      return;
    }
    onSave(next);
  };

  const addExtra = (e: React.FormEvent) => {
    e.preventDefault();
    const name = extra.trim();
    if (!isRiskyToolName(name)) {
      toast.error(
        'A tool name is lower case letters, digits and _ (like mcp_github_create_issue).',
      );
      return;
    }
    setExtra('');
    if (!on.has(name)) set([name], true);
  };

  return (
    <div>
      <PeerColumnHeading
        title="Risky tools allowed"
        aside={<span className="text-xs text-muted-foreground">{allowed.length} allowed</span>}
        description={
          enabled
            ? 'Blocked unless switched on here, even with Write on.'
            : `Only for a peer that acts as the owner: set Acts as to Owner to choose from the ${RISKY_COUNT} risky tools.`
        }
      />
      {/* Only a peer bound to the owner can have them: otherwise the
          flags would all be greyed, so the note above stands alone. */}
      {enabled ? (
        <div className="space-y-3">
          {groups.map((g) => {
            const count = g.tools.filter((t) => on.has(t)).length;
            const all = count === g.tools.length;
            return (
              <div key={g.id} className="rounded-md border border-border">
                <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{g.label}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{g.hint}</p>
                  </div>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {count}/{g.tools.length}
                  </span>
                  <Button
                    type="button"
                    size="2xs"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => set(g.tools, !all)}
                    aria-label={`${all ? 'Clear' : 'Allow all'}: ${g.label}`}
                  >
                    {all ? 'Clear' : 'All'}
                  </Button>
                </div>
                <div className="divide-y divide-border px-3">
                  {g.tools.map((t) => (
                    <FlagRow
                      key={t}
                      id={`peer-risky-${peerId}-${t}`}
                      label={t}
                      mono
                      checked={on.has(t)}
                      disabled={disabled}
                      onCheckedChange={(v) => set([t], v)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
          <form onSubmit={addExtra} className="flex items-center gap-2">
            <Input
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder="Another tool by name, e.g. mcp_github_create_issue"
              aria-label="Allow another tool by name"
              className="h-8 font-mono text-xs"
              disabled={saving}
              autoComplete="off"
            />
            <SubmitButton size="xs" variant="outline" pending={saving} disabled={!extra.trim()}>
              <Plus /> Allow tool
            </SubmitButton>
          </form>
        </div>
      ) : null}
    </div>
  );
}
