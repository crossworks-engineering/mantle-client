'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { BookOpen, Copy, Plus, Trash2 } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
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
import { Label } from '@mantle/web-ui/ui/label';
import { RadioGroup, RadioGroupItem } from '@mantle/web-ui/ui/radio-group';
import { Field, FieldError, FieldLabel } from '@mantle/web-ui/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@mantle/web-ui/ui/select';
import { Textarea } from '@mantle/web-ui/ui/textarea';
import { FieldHint, hintId } from '@mantle/web-ui/ui/field-hint';
import { ModelSelect } from '@/components/ui/model-select';
import { Slider } from '@mantle/web-ui/ui/slider';
import { useToast } from '@mantle/web-ui/ui/toast';
import { ListCard, ListCardTitle } from '@mantle/web-ui/ui/list-card';
import { MasterDetail } from '@mantle/web-ui/ui/master-detail';
import { getProvider, isProviderWired, providersForCapability } from '@mantle/voice-client';
import type { AiWorkerDTO, SkillDTO, ToolGroupWithRefs } from '@mantle/client-types';
import { apiFetch, apiSend } from '@mantle/web-ui/api-fetch';
import { invalidateAgentQueries } from '@mantle/web-ui/agent-invalidation';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { AvatarPicker } from '@/components/avatar-picker';
import { SubmitButton } from '@mantle/web-ui/ui/submit-button';
import { TelegramBotSection } from '@/components/telegram/telegram-bot-section';
import { AvatarWithLevel } from '@mantle/web-ui/avatar-with-level';
import { avatarPartsOf } from '@mantle/web-ui/avatar-parts';
import { experienceOf, experienceTitle } from '@/lib/experience';
import { useAvatarStyle } from '@mantle/web-ui/avatar-style-provider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@mantle/web-ui/ui/tabs';
import { ChatTestButton } from '@/components/settings/chat-test-button';
import { ModelsTab } from './models-tab';
import {
  BackupRouteSection,
  MemorySection,
  NONE,
  RouteHostFields,
  ThinkingEffortField,
} from './agent-form-sections';
import { ContextWindowHint, DelegatePicker, SkillPicker, ToolGroupPicker } from './agent-pickers';
import { catalogKeyId, useModelCatalog } from './use-model-catalog';
import {
  agentDeleteOutcome,
  agentDeletePath,
  type AgentDeleteResponse,
  type ConversationMode,
} from './agent-delete';
import {
  ROLES,
  brainHasAgentThinkingEffort,
  agentMemoryConfigFromForm,
  agentParamsFromForm,
  defaultsForRole,
  emptyForm,
  formFromAgent,
  tempDescriptor,
  validateAgent,
  DEFAULT_EXTRACTOR_PROMPT,
  DEFAULT_REFLECTOR_PROMPT,
  DEFAULT_SUMMARIZER_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
} from './agent-form-state';
import type {
  AgentErrors,
  AgentSection,
  AgentSummary,
  ApiKeyOption,
  FormState,
  Role,
  SkillOption,
  ToolGroupOption,
  TtsWorkerOption,
} from './agent-form-state';
import { slugify } from '@mantle/web-ui/slugify';
import { play } from '@/lib/sounds/play';

// The embedder is no longer agent-configurable — it's the single
// `embedding_config` row, managed at /settings/embedding (migration 0061).

// The static MODEL_SUGGESTIONS list was retired with the ModelSelect rollout —
// the form now reads the full live OpenRouter catalog (~330+ models) from
// /api/models?provider=openrouter and the combobox handles search + sort.
// Custom slugs the catalog hasn't indexed yet still commit via the
// "Use ‹typed›" affordance inside the combobox.

/** Which tab holds each field, and the order the form reads in — so a failed
 *  submit lands on the FIRST thing wrong rather than the last rule to run. */
const AGENT_ERROR_ORDER: { field: keyof AgentErrors; section: AgentSection }[] = [
  { field: 'name', section: 'general' },
  { field: 'slug', section: 'general' },
  // Provider, key and model live on "Model & routing", not General — which is
  // exactly why the browser could not deliver these: on the wrong tab they are
  // `display:none`, and a hidden control neither takes focus nor shows a bubble.
  { field: 'apiKey', section: 'model' },
  { field: 'model', section: 'model' },
  { field: 'systemPrompt', section: 'general' },
  { field: 'corpusMapChars', section: 'memory' },
];

export function AgentsClient() {
  const queryClient = useQueryClient();
  const toast = useToast();
  // The brain's avatar style — stamped onto avatars this screen saves so the
  // stored row matches what everything actually renders.
  const { avatarStyle } = useAvatarStyle();
  const [deleteTarget, setDeleteTarget] = useState<AgentSummary | null>(null);
  // Keep is the safe default and is re-armed every time the dialog opens.
  const [deleteConversation, setDeleteConversation] = useState<ConversationMode>('keep');
  const openDelete = (a: AgentSummary) => {
    setDeleteConversation('keep');
    setDeleteTarget(a);
  };
  const [saving, setSaving] = useState(false);

  // All data is client-fetched against `/api/**` (Phase 2 · Task 4) — no
  // SSR props, so the screen carries no in-process DB read. Query keys mirror
  // the URLs; mutations invalidate `['agents']` (the client-side replacement
  // for router.refresh()).
  const agentsQuery = useQuery({
    queryKey: ['agents'],
    queryFn: () => apiFetch<{ agents: AgentSummary[] }>('/api/agents').then((r) => r.agents),
  });
  const keysQuery = useQuery({
    queryKey: ['keys'],
    queryFn: () => apiFetch<{ keys: ApiKeyOption[] }>('/api/keys').then((r) => r.keys),
  });
  const skillsQuery = useQuery({
    queryKey: ['skills'],
    queryFn: () => apiFetch<{ skills: SkillDTO[] }>('/api/skills').then((r) => r.skills),
  });
  const toolGroupsQuery = useQuery({
    queryKey: ['tool-groups'],
    queryFn: () =>
      apiFetch<{ groups: ToolGroupWithRefs[] }>('/api/tool-groups').then((r) => r.groups),
  });
  const ttsWorkersQuery = useQuery({
    queryKey: ['ai-workers'],
    queryFn: () => apiFetch<{ workers: AiWorkerDTO[] }>('/api/ai-workers').then((r) => r.workers),
  });
  const tailnetQuery = useQuery({
    queryKey: ['tailnet', 'peers'],
    queryFn: () => apiFetch<{ peers: string[] }>('/api/tailscale/peers').then((r) => r.peers),
  });

  const agents = useMemo(() => agentsQuery.data ?? [], [agentsQuery.data]);
  // A brain from before per-agent thinking effort neither sends nor stores it:
  // hide the select there and leave the field out of the save.
  const hasThinkingEffort = brainHasAgentThinkingEffort(agents);
  const apiKeys = keysQuery.data ?? [];
  const tailnetPeers = tailnetQuery.data ?? [];
  // Only enabled skills / tool groups are grantable; TTS pickers want kind='tts'.
  const availableSkills = useMemo<SkillOption[]>(
    () =>
      (skillsQuery.data ?? [])
        .filter((s) => s.enabled)
        .map((s) => ({ slug: s.slug, name: s.name, description: s.description })),
    [skillsQuery.data],
  );
  const availableToolGroups = useMemo<ToolGroupOption[]>(
    () =>
      (toolGroupsQuery.data ?? [])
        .filter((g) => g.enabled)
        .map((g) => ({
          slug: g.slug,
          name: g.name,
          description: g.description,
          toolSlugs: g.toolSlugs,
        })),
    [toolGroupsQuery.data],
  );
  const ttsWorkers = useMemo<TtsWorkerOption[]>(
    () =>
      (ttsWorkersQuery.data ?? [])
        .filter((w) => w.kind === 'tts')
        .map((w) => ({
          id: w.id,
          slug: w.slug,
          name: w.name,
          provider: w.provider,
          model: w.model,
          enabled: w.enabled,
          isDefault: w.isDefault,
        })),
    [ttsWorkersQuery.data],
  );

  const [editing, setEditing] = useState<
    { mode: 'create' } | { mode: 'edit'; agent: AgentSummary }
  >();
  const [form, setForm] = useState<FormState>(emptyForm());
  const [slugTouched, setSlugTouched] = useState(false);
  // Kept across agent switches (handy for comparing the same setting across
  // agents).
  const [section, setSection] = useState<AgentSection>('general');
  const [errors, setErrors] = useState<AgentErrors>({});
  // Only complain AFTER a submit has failed: validating from the first
  // keystroke would mark a brand-new agent red before anything was typed.
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    if (!submitted || !editing) return;
    setErrors(validateAgent(form, editing));
  }, [submitted, form, editing]);

  // The agent's effective tool set = the union of every granted group's tools
  // (exactly what the runtime resolves; P6 — tool groups are the sole grant).
  // Surfaced read-only so the operator sees the agent's TRUE capability.
  const effectiveTools = useMemo(() => {
    const byGroup = new Map(availableToolGroups.map((g) => [g.slug, g.toolSlugs]));
    const set = new Set<string>();
    for (const g of form.toolGroupSlugs) for (const t of byGroup.get(g) ?? []) set.add(t);
    return [...set].sort();
  }, [form.toolGroupSlugs, availableToolGroups]);

  // Live model → context-window map (OpenRouter catalog, cached server-side),
  // fetched once so the Model field can show the real window for the typed
  // slug — the same source the dashboard's context-% bars use.
  const [contextLimits, setContextLimits] = useState<Record<string, number>>({});
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ limits?: Record<string, number> }>('/api/model-context')
      .then((d) => {
        if (!cancelled && d?.limits) setContextLimits(d.limits as Record<string, number>);
      })
      .catch(() => {
        /* readout is decorative — ignore fetch failures */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Live model catalog for the form's currently-selected provider.
  // OpenRouter returns ~330+ models with name + context + pricing +
  // modality; direct providers return a slimmer shape (id + display
  // name + context; pricing usually absent — the /models page explorer
  // is the source of truth for cost data). The ModelSelect combobox
  // handles missing pricing gracefully (sinks unpriced rows to the
  // bottom, skips the price badge).
  //
  // Re-fetches whenever form.provider changes so switching the
  // dropdown from OpenRouter to Anthropic-direct (etc.) lists the
  // RIGHT slugs — pre-Phase-3d this was hard-coded to openrouter and
  // operators ended up with cross-provider slugs that 404'd at first
  // turn (anthropic/claude-haiku-4.5 vs the direct-Anthropic
  // claude-haiku-4-5).
  //
  // Listed with the picked key, so a key saved under any label lists its own
  // models (a new key used to list nothing), and re-fetched when it changes.
  const catalog = useModelCatalog(
    form.provider,
    true,
    catalogKeyId(apiKeys, form.apiKeyId, form.provider),
  );
  // Only while the backup section is open: an agent with no backup should not
  // cost an /api/models call.
  const backupCatalog = useModelCatalog(
    form.backupProvider,
    form.backupEnabled,
    catalogKeyId(apiKeys, form.backupApiKeyId, form.backupProvider),
  );

  const openCreate = () => {
    setForm(emptyForm());
    setSlugTouched(false);
    setEditing({ mode: 'create' });
  };

  const openEdit = (agent: AgentSummary) => {
    setForm(formFromAgent(agent));
    setSlugTouched(true);
    setEditing({ mode: 'edit', agent });
  };

  const closeDialog = () => {
    setEditing(undefined);
  };

  // Deep link: /settings/agents?selected=<id-or-slug> opens that agent's
  // editor once the list arrives (agent_list hands these URLs to the
  // assistant). One-shot entry point — selection stays client-state after.
  const searchParams = useSearchParams();
  const router = useRouter();
  // Tab is URL-driven (`?tab=models`) per the settings convention, so the
  // Models matrix is linkable. Staged changes over there are memory-only —
  // switching tabs discards them by design.
  const tab = searchParams.get('tab') === 'models' ? 'models' : 'agents';
  // While the Models tab is mid-apply the switcher locks: unmounting it would
  // hide per-row progress and silently drop still-staged failures.
  const [modelsBusy, setModelsBusy] = useState(false);
  const onTabChange = (next: string) => {
    if (modelsBusy) return;
    router.replace(next === 'models' ? '/settings/agents?tab=models' : '/settings/agents', {
      scroll: false,
    });
  };
  const requestedAgentRef = useRef(searchParams.get('selected'));
  useEffect(() => {
    const want = requestedAgentRef.current?.trim();
    if (!want || agents.length === 0) return;
    requestedAgentRef.current = null;
    const hit = agents.find((a) => a.id === want || a.slug === want);
    if (hit) openEdit(hit);
  }, [agents]);

  // Clone: open the CREATE form pre-seeded from a donor row. The clone is
  // operator-authored, so the boot reconcile never touches it — the stable way
  // to build on a system agent's proven config (overriding a manifest agent
  // in place would be silently reverted by the next update's def sync). It
  // lands as role 'custom' and DISABLED: a second enabled responder would
  // enter priority resolution and could shadow the persona on Telegram/web —
  // promoting a clone is a deliberate act. Avatar resets so twins stay
  // tellable-apart; the slug regenerates from the editable name.
  const openClone = (donor: AgentSummary) => {
    const name = `${donor.name} copy`;
    setForm({
      ...formFromAgent(donor),
      name,
      slug: slugify(name, { maxLength: 64 }),
      role: 'custom',
      enabled: false,
      avatar: null,
    });
    setSlugTouched(false);
    setEditing({ mode: 'create' });
  };

  const onNameChange = (v: string) => {
    setForm((f) => ({
      ...f,
      name: v,
      slug: slugTouched ? f.slug : slugify(v, { maxLength: 64 }),
    }));
  };

  /** When the user picks a different role on a freshly-created agent, swap
   *  the default model + system prompt to match the new role — but only
   *  if the user hasn't customised them yet (best-effort heuristic). */
  const onRoleChange = (next: Role) => {
    setForm((f) => {
      const prevDefaults = defaultsForRole(f.role);
      const nextDefaults = defaultsForRole(next);
      const isUntouchedModel = f.model === prevDefaults.model;
      const isUntouchedPrompt =
        f.systemPrompt === prevDefaults.systemPrompt ||
        f.systemPrompt === DEFAULT_SYSTEM_PROMPT ||
        f.systemPrompt === DEFAULT_SUMMARIZER_PROMPT ||
        f.systemPrompt === DEFAULT_EXTRACTOR_PROMPT ||
        f.systemPrompt === DEFAULT_REFLECTOR_PROMPT;
      return {
        ...f,
        role: next,
        model: isUntouchedModel ? nextDefaults.model : f.model,
        systemPrompt: isUntouchedPrompt ? nextDefaults.systemPrompt : f.systemPrompt,
      };
    });
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;

    // The form is `noValidate`: its fields are spread across tabs and an
    // inactive tab is CSS-hidden, so the browser abandons a native-validation
    // submit silently. The same rules run here instead, and the message lands
    // ON the field — see `validateAgent`.
    const errs = validateAgent(form, editing);
    setSubmitted(true);
    setErrors(errs);
    const first = AGENT_ERROR_ORDER.find((f) => errs[f.field]);
    if (first) {
      // flushSync so the tab switch commits before the focus call — a
      // `display:none` control cannot take focus, and the screen would mark a
      // field red on a tab the user cannot see.
      if (first.section !== section) flushSync(() => setSection(first.section));
      document.getElementById(first.field)?.focus();
      return;
    }

    // Only the fields this form shows; the brain merges memory_config, so
    // every other key keeps its stored value (see agentMemoryConfigFromForm).
    const memoryConfig = agentMemoryConfigFromForm(
      form,
      editing.mode === 'edit' ? editing.agent.memoryConfig : null,
    );

    // The form's params plus the saved ones it has no field for (see
    // agentParamsFromForm): the brain replaces params whole on a save.
    const params = agentParamsFromForm(form, editing.mode === 'edit' ? editing.agent.params : null);

    const priority = parseInt(form.priority, 10);

    const body = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      role: form.role,
      provider: form.provider.trim() || 'openrouter',
      model: form.model.trim(),
      apiKeyId: form.apiKeyId || null,
      // Backup chat route. Always send all four so toggling failover off (or
      // clearing a field) actually persists — the PATCH set-map writes each
      // explicitly. backupEnabled gates failover at runtime, not the columns.
      backupEnabled: form.backupEnabled,
      backupProvider: form.backupProvider.trim() || null,
      backupModel: form.backupModel.trim() || null,
      backupApiKeyId: form.backupApiKeyId || null,
      // Per-route host + tailnet flag. Always send so clearing persists.
      baseUrl: form.baseUrl.trim() || null,
      viaTailnet: form.viaTailnet,
      backupBaseUrl: form.backupBaseUrl.trim() || null,
      backupViaTailnet: form.backupViaTailnet,
      // Per-agent voice: pinned TTS worker, or null to use the default.
      ttsWorkerId: form.ttsWorkerId || null,
      systemPrompt: form.systemPrompt,
      memoryConfig,
      params,
      priority: Number.isNaN(priority) ? 100 : priority,
      enabled: form.enabled,
      skillSlugs: form.skillSlugs,
      toolGroupSlugs: form.toolGroupSlugs,
      avatar: form.avatar,
      // null = inherit the profile. Always sent (where the brain has it) so
      // switching back to Inherit persists.
      ...(hasThinkingEffort ? { thinkingEffort: form.thinkingEffort } : {}),
      ...(editing.mode === 'create' ? { slug: form.slug.trim() } : {}),
    };

    const url = editing.mode === 'create' ? '/api/agents' : `/api/agents/${editing.agent.id}`;
    const method = editing.mode === 'create' ? 'POST' : 'PATCH';
    setSaving(true);
    try {
      // Both POST and PATCH return `{ agent: row }` (dates already ISO).
      let saved: AgentSummary | undefined;
      let droppedParts = false;
      try {
        ({ agent: saved } = await apiSend<{ agent: AgentSummary }>(url, method, body));
      } catch (err) {
        // A brain that predates the avatar builder rejects the whole save over
        // the one unknown `parts` key (its Avatar schema is strict). Retry once
        // without the pins so the rest of the form still lands, and say so.
        // The message must name `parts` specifically — zod's strict error lists
        // the offending keys — so a rejection of some OTHER unknown key never
        // strips a user's pins on a brain that actually supports them.
        const strict =
          err instanceof Error && /unrecognized key[^:]*:.*\bparts\b/i.test(err.message);
        if (!strict || !form.avatar?.parts) throw err;
        droppedParts = true;
        ({ agent: saved } = await apiSend<{ agent: AgentSummary }>(url, method, {
          ...body,
          avatar: { style: form.avatar.style, seed: form.avatar.seed },
        }));
      }
      play('success');
      if (droppedParts) {
        toast.error('Saved, but this brain is too old to keep pinned avatar parts.');
      } else {
        toast.success(editing.mode === 'create' ? 'Agent created' : 'Agent saved');
      }
      // Keep focus on the just-saved row instead of dropping back to the
      // empty-detail state. Promote the saved record into `editing` (turning a
      // create into an edit naturally — slug/id are now known) and resync the
      // form fields to whatever the server canonicalised. invalidateAgentQueries
      // then refetches the list around the still-selected row.
      if (saved) {
        setEditing({ mode: 'edit', agent: saved });
        setForm(formFromAgent(saved));
        setSlugTouched(true);
      } else {
        closeDialog();
      }
      await invalidateAgentQueries(queryClient);
    } catch (err) {
      // A brain from before v0.238.8 rejects the unknown `tool_loading` key.
      play('danger');
      const oldBrain =
        err instanceof Error && /unrecognized key[^:]*:.*\btool_loading\b/i.test(err.message);
      toast.error(
        oldBrain
          ? 'This brain is too old for on-demand tools (it needs v0.238.8 or later). Turn the switch off and save again.'
          : err instanceof Error
            ? err.message
            : 'Save failed.',
      );
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    const a = deleteTarget;
    if (!a) return;
    const mode = deleteConversation;
    let res: AgentDeleteResponse;
    try {
      res = await apiSend<AgentDeleteResponse>(agentDeletePath(a.id, mode), 'DELETE');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed.');
      return;
    }
    const outcome = agentDeleteOutcome(a.name, mode, res);
    if (outcome.warn) toast.info(outcome.message);
    else toast.success(outcome.message);
    if (editing?.mode === 'edit' && editing.agent.id === a.id) closeDialog();
    await invalidateAgentQueries(queryClient);
  };

  const activeResponder = useMemo(
    () =>
      agents
        .filter((a) => a.enabled && a.role === 'responder')
        .sort((a, b) => b.priority - a.priority)[0],
    [agents],
  );
  const selectedId = editing?.mode === 'edit' ? editing.agent.id : null;
  const temp = Number.parseFloat(form.temperature) || 0;

  if (agentsQuery.isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (agentsQuery.isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm">
        <p className="text-muted-foreground">
          {agentsQuery.error instanceof Error
            ? agentsQuery.error.message
            : 'Failed to load agents.'}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => agentsQuery.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Agents (master-detail editor) | Models (bulk model matrix) */}
      <div className="shrink-0 border-b border-border px-4 py-2">
        <Tabs value={tab} onValueChange={onTabChange}>
          <TabsList>
            <TabsTrigger value="agents" disabled={modelsBusy}>
              Agents
            </TabsTrigger>
            <TabsTrigger value="models">Models</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {tab === 'models' ? (
        <ModelsTab agents={agents} apiKeys={apiKeys} onBusyChange={setModelsBusy} />
      ) : (
        <>
          {/* Active responder banner */}
          <div className="shrink-0 border-b border-border px-4 py-2 text-xs">
            {activeResponder ? (
              <p className="text-muted-foreground">
                Active Telegram responder:{' '}
                <strong className="text-foreground">{activeResponder.name}</strong> (
                {activeResponder.model}, priority {activeResponder.priority})
              </p>
            ) : (
              <p className="text-warning-ink">
                No enabled <code>responder</code> agent — Telegram messages go unanswered until you
                create one.
              </p>
            )}
          </div>

          <MasterDetail
            id="settings-agents"
            // The tab strip and the responder banner stay full width above, so
            // the scaffold is the lower half of the screen.
            className="min-h-0 flex-1"
            // The 340px this screen has always had.
            defaultListSize="340px"
            // No `detailFills`: the detail is the agent FORM, and the 672px
            // default measure is what keeps its fields off 1200px line lengths.
            list={
              <>
                <div className="flex items-center justify-between gap-2 border-b border-border p-3">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                    Agents
                  </h2>
                  <Button type="button" size="sm" onClick={openCreate}>
                    <Plus /> New
                  </Button>
                </div>
                <div className="space-y-2 p-3 md:flex-1 md:overflow-y-auto md:scrollbar-thin">
                  {agents.length === 0 ? (
                    <p className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
                      No agents yet. Click <strong>New</strong> to create one — you&apos;ll need an
                      API key saved at <code>/settings/keys</code> first.
                    </p>
                  ) : (
                    agents.map((a) => {
                      const selected = selectedId === a.id;
                      const xp = experienceOf(a);
                      return (
                        <ListCard
                          key={a.id}
                          onClick={() => openEdit(a)}
                          selected={selected}
                          dimmed={!a.enabled}
                        >
                          <div className="flex items-center gap-2.5">
                            {/* Every agent gets an avatar, stored record or not:
                              the STYLE is the brain's, so all a per-agent record
                              adds is a rerolled seed. Falling back to the slug
                              means a fresh brain looks right immediately, rather
                              than showing initials until each agent is opened and
                              saved one by one. The corner badge is the agent's
                              experience level — earned from real recorded work,
                              display only (hover shows the counts behind it). */}
                            <AvatarWithLevel
                              seed={a.avatar?.seed || a.slug}
                              parts={avatarPartsOf(a.avatar)}
                              size={32}
                              level={xp?.level}
                              title={xp ? experienceTitle(xp) : undefined}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <ListCardTitle>{a.name}</ListCardTitle>
                                {!a.enabled && (
                                  <span className="shrink-0 rounded-sm bg-muted px-1 text-[9px] uppercase tracking-wider text-muted-foreground">
                                    off
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                                <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider">
                                  {a.role}
                                </span>
                                <span className="shrink-0 text-[11px]">
                                  {getProvider(a.provider)?.label ?? a.provider}
                                </span>
                                <span className="shrink-0 text-[11px]" aria-hidden>
                                  ·
                                </span>
                                <code className="truncate font-mono text-[11px]">{a.model}</code>
                              </div>
                            </div>
                          </div>
                        </ListCard>
                      );
                    })
                  )}
                </div>
              </>
            }
            // `MasterDetail`'s detail pane is `relative`, which this screen
            // needs more than most: the Radix Switch/Checkbox hidden "bubble
            // inputs" behind the many tool/skill toggles are absolutely
            // positioned, and without a containing block here their
            // offsetParent resolves to the fixed `<main>` — they escape the
            // pane's clip, inflate main's scroll area, and paint a second
            // scrollbar beside this one.
            detail={
              <>
                {!editing ? (
                  <div className="flex h-full items-center justify-center p-10 text-center text-sm text-muted-foreground">
                    Select an agent to edit, or create a new one.
                  </div>
                ) : (
                  <div className="space-y-4 p-6">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="text-lg font-semibold">
                          {editing.mode === 'create' ? 'New agent' : `Edit ${editing.agent.name}`}
                        </h2>
                        <p className="text-xs text-muted-foreground">
                          {editing.mode === 'create'
                            ? 'A new AI agent. Pick a stored API key, model, and persona.'
                            : 'Update the agent. Slug is immutable.'}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <label className="flex cursor-pointer items-center gap-2 text-sm">
                          <Switch
                            checked={form.enabled}
                            onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
                          />
                          Enabled
                        </label>
                        {editing.mode === 'edit' && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => openClone(editing.agent)}
                          >
                            <Copy /> Duplicate
                          </Button>
                        )}
                        {editing.mode === 'edit' && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground hover:text-destructive-ink"
                            onClick={() => openDelete(editing.agent)}
                          >
                            <Trash2 /> Delete
                          </Button>
                        )}
                      </div>
                    </div>
                    {/* Sub-tabs of the editor. `TabsContent` is `forceMount` +
                  CSS-hidden so (a) all fields stay in the DOM for
                  checkValidity() across tabs and (b) self-persisting children
                  (TelegramBotSection) keep their local state across tab
                  switches. */}
                    <Tabs value={section} onValueChange={(v) => setSection(v as AgentSection)}>
                      <TabsList className="h-auto flex-wrap justify-start">
                        <TabsTrigger value="general">General</TabsTrigger>
                        <TabsTrigger value="model">Model & routing</TabsTrigger>
                        <TabsTrigger value="tools">Tool groups</TabsTrigger>
                        <TabsTrigger value="skills">Skills</TabsTrigger>
                        <TabsTrigger value="delegation">Delegation</TabsTrigger>
                        <TabsTrigger value="memory">Memory</TabsTrigger>
                      </TabsList>
                      {/* noValidate: see submitForm — the browser can't focus an
                    invalid field on a hidden tab, so constraints are re-run
                    there with a jump to the offending tab. */}
                      <form onSubmit={submitForm} noValidate className="mt-4 space-y-4">
                        <TabsContent
                          forceMount
                          value="general"
                          data-agent-section="general"
                          className="mt-0 space-y-4 data-[state=inactive]:hidden"
                        >
                          <div className="grid gap-3 sm:grid-cols-2">
                            <Field data-invalid={!!errors.name || undefined}>
                              <FieldLabel htmlFor="name">Name</FieldLabel>
                              <Input
                                id="name"
                                value={form.name}
                                onChange={(e) => onNameChange(e.target.value)}
                                placeholder="Telegram responder"
                                required
                                autoFocus
                                aria-invalid={!!errors.name || undefined}
                                aria-describedby={
                                  errors.name ? `name-error ${hintId('name')}` : hintId('name')
                                }
                              />
                              <FieldHint id="name">
                                What you&apos;ll see in the agent list and above this agent&apos;s
                                messages.
                              </FieldHint>
                              <FieldError id="name-error">{errors.name}</FieldError>
                            </Field>
                            <Field data-invalid={!!errors.slug || undefined}>
                              <FieldLabel htmlFor="slug">Slug</FieldLabel>
                              <Input
                                id="slug"
                                value={form.slug}
                                onChange={(e) => {
                                  setSlugTouched(true);
                                  setForm((f) => ({ ...f, slug: e.target.value }));
                                }}
                                pattern="[a-z0-9_\-]+"
                                required
                                disabled={editing?.mode === 'edit'}
                                aria-invalid={!!errors.slug || undefined}
                                aria-describedby={
                                  errors.slug ? `slug-error ${hintId('slug')}` : hintId('slug')
                                }
                              />
                              <FieldHint id="slug">
                                The stable id other agents delegate to. Fixed once saved.
                              </FieldHint>
                              <FieldError id="slug-error">{errors.slug}</FieldError>
                            </Field>
                          </div>

                          <Field>
                            <FieldLabel htmlFor="description">Description</FieldLabel>
                            <Input
                              id="description"
                              value={form.description}
                              onChange={(e) =>
                                setForm((f) => ({ ...f, description: e.target.value }))
                              }
                              placeholder="Default Telegram responder, with memory"
                              aria-describedby={hintId('description')}
                            />
                            <FieldHint id="description">
                              One line on what this agent is for — it&apos;s what another agent
                              reads when choosing whether to hand work over.
                            </FieldHint>
                          </Field>

                          <Field>
                            <FieldLabel>Avatar</FieldLabel>
                            <AvatarPicker
                              value={form.avatar}
                              onChange={(v) =>
                                // The stored shape still carries a style for API
                                // compatibility, but rendering ignores it — the
                                // brain's style (Appearance) is what every avatar
                                // is drawn in. Stamp the current one so the row
                                // stays coherent rather than storing a stale id.
                                setForm((f) => ({
                                  ...f,
                                  // parts: send the pins; when the form HAD pins
                                  // and the builder cleared them, send {} — the
                                  // server treats an ABSENT parts key as "keep
                                  // what's stored" (so parts-unaware clients
                                  // can't wipe pins), so a clear must be said
                                  // out loud.
                                  avatar: v
                                    ? {
                                        style: avatarStyle,
                                        seed: v.seed,
                                        ...(v.parts
                                          ? { parts: v.parts }
                                          : f.avatar?.parts
                                            ? { parts: {} }
                                            : {}),
                                      }
                                    : null,
                                }))
                              }
                              fallbackSeed={form.slug || form.name || 'agent'}
                              clearLabel="Reset to default"
                            />
                            <FieldHint>
                              Shown beside this agent&apos;s replies and in the list, drawn in the
                              brain&apos;s avatar style (change that in Appearance). Every agent has
                              one already, seeded from its slug — Randomize picks a different one,
                              Customize pins individual parts.
                            </FieldHint>
                          </Field>

                          {/*
              Two rows of paired fields. Row 1: Role + Priority (short
              controls, fit naturally side-by-side). Row 2: Model + API key
              50/50 — the model combobox needs the extra width so its
              selected-summary (name + context + pricing badges) doesn't
              get truncated on long Anthropic/Google slugs.
            */}
                          <div className="grid gap-3 sm:grid-cols-2">
                            <Field>
                              <FieldLabel htmlFor="role">Role</FieldLabel>
                              <Select
                                value={form.role}
                                onValueChange={(v) => onRoleChange(v as Role)}
                              >
                                <SelectTrigger id="role" aria-describedby={hintId('role')}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {ROLES.map((r) => (
                                    <SelectItem key={r.value} value={r.value}>
                                      {r.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FieldHint id="role">
                                Which loop runs this agent. It also decides which of the tuning
                                fields below apply.
                              </FieldHint>
                            </Field>
                            <Field>
                              <FieldLabel htmlFor="priority">Priority</FieldLabel>
                              <Input
                                id="priority"
                                type="number"
                                value={form.priority}
                                onChange={(e) =>
                                  setForm((f) => ({ ...f, priority: e.target.value }))
                                }
                                min={0}
                                step={1}
                                aria-describedby={hintId('priority')}
                              />
                              <FieldHint id="priority">
                                Ordering when several agents qualify — highest sits at the top of
                                the chat list.
                              </FieldHint>
                            </Field>
                          </div>

                          {form.role === 'responder' && (
                            <fieldset className="space-y-3 rounded-md border border-border p-3">
                              <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Telegram bot
                              </legend>
                              {editing.mode === 'edit' ? (
                                <TelegramBotSection agentId={editing.agent.id} />
                              ) : (
                                <p className="text-xs text-muted-foreground">
                                  Save this responder first, then link its Telegram bot here.
                                </p>
                              )}
                              <p className="text-xs text-muted-foreground">
                                This responder long-polls its own bot. Create one with{' '}
                                <a
                                  href="https://t.me/BotFather"
                                  target="_blank"
                                  rel="noreferrer"
                                  className="underline"
                                >
                                  @BotFather
                                </a>{' '}
                                and paste the token, it&apos;s encrypted at rest. DMs to this bot
                                are answered by this agent, for the person whose chat it is: each
                                person pairs their own chat with the code the bot sends them.
                              </p>
                            </fieldset>
                          )}

                          <Field data-invalid={!!errors.systemPrompt || undefined}>
                            <FieldLabel htmlFor="systemPrompt">System prompt</FieldLabel>
                            <Textarea
                              id="systemPrompt"
                              value={form.systemPrompt}
                              onChange={(e) =>
                                setForm((f) => ({ ...f, systemPrompt: e.target.value }))
                              }
                              rows={6}
                              required
                              className="font-mono"
                              aria-invalid={!!errors.systemPrompt || undefined}
                              aria-describedby={
                                errors.systemPrompt ? 'systemPrompt-error' : undefined
                              }
                            />
                            <FieldError id="systemPrompt-error">{errors.systemPrompt}</FieldError>
                            <p className="text-xs text-muted-foreground">
                              For <code>anthropic/*</code> models this block is sent with{' '}
                              <code>cache_control</code>, so the prefix is reused turn-to-turn and
                              the provider only re-processes the new user message.
                            </p>
                          </Field>
                        </TabsContent>

                        <TabsContent
                          forceMount
                          value="model"
                          data-agent-section="model"
                          className="mt-0 space-y-4 data-[state=inactive]:hidden"
                        >
                          {/* Provider + key side by side; the model picker gets its own
                full-width row below (three dropdowns abreast was too
                cramped). Post-Phase-3 the provider field on the agent row
                actually controls runtime dispatch —
                `getChatAdapter(agent.provider)` resolves the adapter the
                responder / assistant / heartbeat loop runs through, and
                the API key filter narrows accordingly. */}
                          <div className="grid gap-3 sm:grid-cols-2">
                            <Field>
                              <FieldLabel htmlFor="provider">Provider</FieldLabel>
                              {(() => {
                                const chatProviders = providersForCapability('chat');
                                return (
                                  <>
                                    <Select
                                      value={form.provider}
                                      onValueChange={(v) => setForm((f) => ({ ...f, provider: v }))}
                                    >
                                      <SelectTrigger
                                        id="provider"
                                        aria-describedby={hintId('provider')}
                                      >
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {chatProviders.map((p) => {
                                          const wired = isProviderWired(p.id, 'chat');
                                          return (
                                            <SelectItem key={p.id} value={p.id}>
                                              {p.label}
                                              {wired ? '' : ' · not yet wired'}
                                            </SelectItem>
                                          );
                                        })}
                                      </SelectContent>
                                    </Select>
                                    <FieldHint id="provider">
                                      Which service runs this agent&apos;s turns. It picks the
                                      adapter and narrows the key and model lists below.
                                    </FieldHint>
                                    {!isProviderWired(form.provider, 'chat') && (
                                      <p className="text-xs text-warning-ink">
                                        No chat adapter registered for <code>{form.provider}</code>.
                                        Saves will succeed but the responder/assistant will fail at
                                        first turn until a chat adapter ships for this provider.
                                      </p>
                                    )}
                                  </>
                                );
                              })()}
                            </Field>
                            <Field data-invalid={!!errors.apiKey || undefined}>
                              <FieldLabel htmlFor="apiKey">API key</FieldLabel>
                              {(() => {
                                // Filter keys to those whose service matches the selected
                                // provider. Direct-provider workers need a same-provider
                                // key; OR workers need an `openrouter` key. The runtime
                                // refuses cross-provider keys via getApiKeyById +
                                // adapter.chat()'s auth check.
                                const eligibleAgentKeys = apiKeys.filter(
                                  (k) => k.service === form.provider,
                                );
                                return (
                                  <>
                                    <Select
                                      value={form.apiKeyId || undefined}
                                      onValueChange={(v) => setForm((f) => ({ ...f, apiKeyId: v }))}
                                    >
                                      <SelectTrigger
                                        id="apiKey"
                                        aria-invalid={!!errors.apiKey || undefined}
                                        aria-describedby={
                                          errors.apiKey
                                            ? `apiKey-error ${hintId('apiKey')}`
                                            : hintId('apiKey')
                                        }
                                      >
                                        {/* No empty `SelectItem` to fall back on — Radix
                                            forbids one — so "nothing picked yet" is the
                                            trigger's placeholder. */}
                                        <SelectValue placeholder="— select a key —" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {eligibleAgentKeys.map((k) => (
                                          <SelectItem key={k.id} value={k.id}>
                                            {k.service} / {k.label} ({k.masked})
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    {apiKeys.length > 0 && eligibleAgentKeys.length === 0 && (
                                      <p className="text-xs text-warning-ink">
                                        None of your saved keys are for <code>{form.provider}</code>
                                        . Add one at{' '}
                                        <a href="/settings/keys" className="underline">
                                          /settings/keys
                                        </a>{' '}
                                        or pick a different provider.
                                      </p>
                                    )}
                                    {apiKeys.length === 0 ? (
                                      <FieldHint>
                                        No keys saved.{' '}
                                        <a href="/settings/keys" className="underline">
                                          Add one
                                        </a>{' '}
                                        first.
                                      </FieldHint>
                                    ) : (
                                      <FieldHint id="apiKey">
                                        Which saved key pays for this agent. It must belong to the
                                        provider above — the runtime refuses a mismatch.
                                      </FieldHint>
                                    )}
                                    <FieldError id="apiKey-error">{errors.apiKey}</FieldError>
                                  </>
                                );
                              })()}
                            </Field>
                          </div>

                          <Field data-invalid={!!errors.model || undefined}>
                            <FieldLabel htmlFor="model">Model</FieldLabel>
                            <ModelSelect
                              id="model"
                              value={form.model}
                              onValueChange={(next) => setForm((f) => ({ ...f, model: next }))}
                              models={catalog.models}
                              loading={catalog.loading}
                              error={catalog.error}
                              placeholder="— pick a model —"
                              emptyMessage="No matching models in the catalog."
                              required
                              aria-invalid={!!errors.model || undefined}
                              aria-describedby={errors.model ? 'model-error' : undefined}
                            />
                            <FieldError id="model-error">{errors.model}</FieldError>
                            <ContextWindowHint
                              provider={form.provider}
                              model={form.model}
                              limits={contextLimits}
                              catalog={catalog.models}
                            />
                            {editing.mode === 'edit' && editing.agent.manifestManaged && (
                              <p className="text-xs text-muted-foreground">
                                System agent — your provider, model and prompt choices are permanent
                                across upgrades; only tuning params re-sync to the system default.
                                Studio&apos;s reset-to-default pulls the shipped configuration back
                                if you want it.
                              </p>
                            )}
                            {(() => {
                              // Subtle hint when the typed slug doesn't appear in the
                              // current provider's catalog AND discovery has settled.
                              // Catches the "switched provider mid-edit and forgot the
                              // slug shape differs" case (OR's `anthropic/claude-haiku-
                              // 4.5` vs direct Anthropic's `claude-haiku-4-5`). Custom
                              // slugs are still allowed — the save commits whatever's
                              // typed — so this is informational, not blocking.
                              if (catalog.loading) return null;
                              if (!form.model.trim()) return null;
                              if (catalog.models.some((m) => m.id === form.model)) return null;
                              return (
                                <p className="text-xs text-warning-ink">
                                  <code>{form.model}</code> isn&apos;t in{' '}
                                  <code>{form.provider}</code>
                                  &apos;s catalog. Save will succeed but the call will fail if the
                                  slug is wrong — direct providers use bare ids (e.g.{' '}
                                  <code>claude-haiku-4-5</code>) where OpenRouter uses prefixed
                                  slugs (e.g. <code>anthropic/claude-haiku-4.5</code>
                                  ).
                                </p>
                              );
                            })()}
                          </Field>

                          {/* Per-agent voice (migration 0066). The chosen TTS worker owns
                provider + voice + model + key; the agent only references it.
                "Default" = the owner's default TTS worker, resolved at speak
                time (so it tracks whatever you mark default in AI workers). */}
                          <Field>
                            <FieldLabel htmlFor="ttsWorker">Voice (TTS)</FieldLabel>
                            <Select
                              // "Default voice" is a real choice here rather than
                              // an empty state, so it rides the NONE sentinel:
                              // Radix forbids an empty-string item value.
                              value={form.ttsWorkerId || NONE}
                              onValueChange={(v) =>
                                setForm((f) => ({ ...f, ttsWorkerId: v === NONE ? '' : v }))
                              }
                            >
                              <SelectTrigger id="ttsWorker">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {(() => {
                                  const def =
                                    ttsWorkers.find((w) => w.enabled && w.isDefault) ??
                                    ttsWorkers.find((w) => w.enabled);
                                  return (
                                    <SelectItem value={NONE}>
                                      {def ? `Default voice (${def.name})` : 'Default voice'}
                                    </SelectItem>
                                  );
                                })()}
                                {ttsWorkers.map((w) => (
                                  <SelectItem key={w.id} value={w.id}>
                                    {w.name} — {w.provider}/{w.model}
                                    {w.enabled ? '' : ' (disabled)'}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {ttsWorkers.length === 0 ? (
                              <p className="text-xs text-muted-foreground">
                                No voice (TTS) workers yet — replies use the default voice. Add one
                                at{' '}
                                <a href="/settings/ai-workers" className="underline">
                                  /settings/ai-workers
                                </a>
                                .
                              </p>
                            ) : (
                              <p className="text-xs text-muted-foreground">
                                Which voice this agent speaks with. Leave on <em>Default</em> to
                                track the default TTS worker; manage voices at{' '}
                                <a href="/settings/ai-workers" className="underline">
                                  /settings/ai-workers
                                </a>
                                .
                              </p>
                            )}
                          </Field>

                          {/* Primary route host (migration 0063). The `local` adapter (self-
                hosted/LAN/tailnet box) and the `custom` adapter (cloud OpenAI-
                compatible endpoint) both need a per-route Base URL. */}
                          {(form.provider === 'local' || form.provider === 'custom') && (
                            <RouteHostFields
                              idPrefix="primary"
                              provider={form.provider}
                              baseUrl={form.baseUrl}
                              viaTailnet={form.viaTailnet}
                              peers={tailnetPeers}
                              onBaseUrl={(v) => setForm((f) => ({ ...f, baseUrl: v }))}
                              onViaTailnet={(v) => setForm((f) => ({ ...f, viaTailnet: v }))}
                            />
                          )}

                          <BackupRouteSection
                            form={form}
                            setForm={setForm}
                            apiKeys={apiKeys}
                            tailnetPeers={tailnetPeers}
                            catalog={backupCatalog}
                          />

                          <fieldset className="space-y-3 rounded-md border border-border p-3">
                            <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Model params
                            </legend>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <Field>
                                <div className="flex items-baseline justify-between gap-2">
                                  <FieldLabel>Temperature</FieldLabel>
                                  <span className="text-xs">
                                    <span className="font-medium text-foreground">
                                      {tempDescriptor(temp).word}
                                    </span>
                                    <span className="ml-1.5 tabular-nums text-muted-foreground">
                                      {temp.toFixed(1)}
                                    </span>
                                  </span>
                                </div>
                                <Slider
                                  min={0}
                                  max={2}
                                  step={0.1}
                                  value={[temp]}
                                  onValueChange={([v]) =>
                                    setForm((f) => ({ ...f, temperature: String(v ?? 0) }))
                                  }
                                  className="py-1.5"
                                  aria-label="Temperature"
                                />
                                <FieldHint
                                  warn={
                                    temp > 1.2 ? 'This high, replies start to wander.' : undefined
                                  }
                                >
                                  {tempDescriptor(temp).hint}
                                </FieldHint>
                              </Field>
                              <Field>
                                <FieldLabel htmlFor="maxTokens">Max tokens</FieldLabel>
                                <Input
                                  id="maxTokens"
                                  type="number"
                                  step={1}
                                  min={1}
                                  value={form.maxTokens}
                                  onChange={(e) =>
                                    setForm((f) => ({ ...f, maxTokens: e.target.value }))
                                  }
                                  placeholder="(provider default)"
                                  aria-describedby={hintId('maxTokens')}
                                />
                                <FieldHint
                                  id="maxTokens"
                                  warn="Set it too low and long answers get cut off mid-sentence."
                                >
                                  Ceiling on a single reply. Blank leaves it to the provider.
                                </FieldHint>
                              </Field>
                            </div>
                            <Field>
                              <FieldLabel
                                htmlFor="suggestFollowUp"
                                className="cursor-pointer items-center gap-2"
                              >
                                <Switch
                                  id="suggestFollowUp"
                                  checked={form.suggestFollowUp}
                                  onCheckedChange={(v) =>
                                    setForm((f) => ({ ...f, suggestFollowUp: v }))
                                  }
                                />
                                Suggest follow-ups
                              </FieldLabel>
                              <FieldHint>
                                After each reply, propose the next question as an accept-with-Enter
                                chip in the chat composer. Runs the Follow-up suggester worker once
                                per turn (a cheap model, off the reply&apos;s critical path), so it
                                costs a little per message. Off by default.
                              </FieldHint>
                            </Field>
                            <Field>
                              <FieldLabel
                                htmlFor="toolLoading"
                                className="cursor-pointer items-center gap-2"
                              >
                                <Switch
                                  id="toolLoading"
                                  checked={form.toolLoading === 'deferred'}
                                  onCheckedChange={(v) =>
                                    setForm((f) => ({ ...f, toolLoading: v ? 'deferred' : 'full' }))
                                  }
                                />
                                Load tools on demand
                              </FieldLabel>
                              <FieldHint>
                                Sends the most used tools in full and lists the rest by name; the
                                agent loads one with a search when it needs it. Same tools, about
                                75% fewer tool tokens per call, and one extra step when a rarely
                                used tool is needed. Off sends every granted tool on every call.
                                Needs brain v0.238.8 or later.
                              </FieldHint>
                            </Field>
                            {hasThinkingEffort && (
                              <ThinkingEffortField form={form} setForm={setForm} />
                            )}
                          </fieldset>

                          {editing.mode === 'edit' && (
                            <section className="space-y-2 border-t border-border pt-6">
                              <h3 className="text-sm font-semibold">Test chat</h3>
                              <p className="text-xs text-muted-foreground">
                                Send a one-shot prompt through this agent&apos;s adapter (
                                <code>{editing.agent.provider}</code>) and see what comes back. Uses
                                the saved system prompt, model, and params — same path as the
                                production responder. Useful for validating a new direct- provider
                                key (Anthropic / Google / xAI) without sending a real Telegram
                                message.
                              </p>
                              <ChatTestButton
                                endpoint={`/api/agents/${editing.agent.id}/test/chat`}
                              />
                            </section>
                          )}
                        </TabsContent>

                        <TabsContent
                          forceMount
                          value="tools"
                          data-agent-section="tools"
                          className="mt-0 space-y-4 data-[state=inactive]:hidden"
                        >
                          <fieldset className="space-y-3 rounded-md border border-border p-3">
                            <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Tool groups
                            </legend>
                            {availableToolGroups.length === 0 ? (
                              <p className="text-xs text-muted-foreground">
                                No tool groups yet. Create capability bundles at{' '}
                                <a href="/settings/tool-groups" className="underline">
                                  /settings/tool-groups
                                </a>
                                .
                              </p>
                            ) : (
                              <ToolGroupPicker
                                available={availableToolGroups}
                                selected={form.toolGroupSlugs}
                                onChange={(next) =>
                                  setForm((f) => ({ ...f, toolGroupSlugs: next }))
                                }
                              />
                            )}
                            <p className="text-xs text-muted-foreground">
                              The primary way to grant capability — each group joins all its tools
                              into the agent&apos;s effective set. Curate bundles at{' '}
                              <a href="/settings/tool-groups" className="underline">
                                /settings/tool-groups
                              </a>
                              .
                            </p>
                            {/* Effective set — what the runtime actually resolves (the union of
                  the granted groups' tools; P6 — groups are the sole grant). */}
                            <div className="rounded-md bg-muted/40 p-2">
                              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                Effective tools · {effectiveTools.length}
                              </p>
                              {effectiveTools.length === 0 ? (
                                <p className="text-xs text-muted-foreground">
                                  None — the agent never sees a <code>tools</code> parameter.
                                </p>
                              ) : (
                                <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
                                  {effectiveTools.join(', ')}
                                </p>
                              )}
                            </div>
                          </fieldset>

                          <fieldset className="space-y-3 rounded-md border border-border p-3">
                            <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Tool results
                            </legend>
                            <p className="text-xs text-muted-foreground">
                              Large tool outputs (a delegated agent&apos;s full answer, a big file
                              read, a wide search) are stored and handed to the agent as a handle it
                              reads via <code>read_result</code> (page / grep / semantic query) —
                              instead of being truncated. Tune when that spill kicks in. Blank =
                              system default.
                            </p>
                            <div className="grid grid-cols-2 gap-3">
                              <Field>
                                <FieldLabel htmlFor="result-inline">Inline max (KB)</FieldLabel>
                                <Input
                                  id="result-inline"
                                  type="number"
                                  min={1}
                                  value={form.resultInlineMaxKb}
                                  onChange={(e) =>
                                    setForm((f) => ({ ...f, resultInlineMaxKb: e.target.value }))
                                  }
                                  placeholder="32 (default)"
                                  aria-describedby={hintId('result-inline')}
                                />
                                <FieldHint
                                  id="result-inline"
                                  warn="Raise it and big results land straight in the prompt."
                                >
                                  Results larger than this spill to the store.
                                </FieldHint>
                              </Field>
                              <Field>
                                <FieldLabel htmlFor="result-embed">Semantic-tier (KB)</FieldLabel>
                                <Input
                                  id="result-embed"
                                  type="number"
                                  min={1}
                                  value={form.resultEmbedMinKb}
                                  onChange={(e) =>
                                    setForm((f) => ({ ...f, resultEmbedMinKb: e.target.value }))
                                  }
                                  placeholder="100 (default)"
                                  aria-describedby={hintId('result-embed')}
                                />
                                <FieldHint id="result-embed">
                                  At/over this, the agent is steered to semantic <code>query</code>.
                                </FieldHint>
                              </Field>
                              <Field>
                                <FieldLabel htmlFor="result-spill">Hard ceiling (KB)</FieldLabel>
                                <Input
                                  id="result-spill"
                                  type="number"
                                  min={1}
                                  value={form.resultSpillMaxKb}
                                  onChange={(e) =>
                                    setForm((f) => ({ ...f, resultSpillMaxKb: e.target.value }))
                                  }
                                  placeholder="1024 (default)"
                                  aria-describedby={hintId('result-spill')}
                                />
                                <FieldHint
                                  id="result-spill"
                                  warn="Raising it grows both the DB and the embedding bill."
                                >
                                  Bigger results are head-truncated before storing.
                                </FieldHint>
                              </Field>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Max embedding chunks and retention (TTL) are system-wide — set via{' '}
                              <code>TOOL_RESULT_MAX_CHUNKS</code> /{' '}
                              <code>TOOL_RESULT_TTL_DAYS</code> env vars.
                            </p>
                          </fieldset>
                        </TabsContent>

                        <TabsContent
                          forceMount
                          value="skills"
                          data-agent-section="skills"
                          className="mt-0 space-y-4 data-[state=inactive]:hidden"
                        >
                          <fieldset className="space-y-3 rounded-md border border-border p-3">
                            <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Skills
                            </legend>
                            {availableSkills.length === 0 ? (
                              <p className="text-xs text-muted-foreground">
                                No skills yet. Author one at{' '}
                                <a href="/settings/skills" className="underline">
                                  /settings/skills
                                </a>
                                .
                              </p>
                            ) : (
                              <SkillPicker
                                available={availableSkills}
                                selected={form.skillSlugs}
                                onChange={(next) => setForm((f) => ({ ...f, skillSlugs: next }))}
                              />
                            )}
                            <p className="text-xs text-muted-foreground">
                              Each attached skill appends its instructions to the agent&apos;s
                              system prompt (always-loaded). Skills are pure teaching: capability
                              comes from the Tool groups tab.
                            </p>
                          </fieldset>
                        </TabsContent>

                        <TabsContent
                          forceMount
                          value="delegation"
                          data-agent-section="delegation"
                          className="mt-0 space-y-4 data-[state=inactive]:hidden"
                        >
                          <fieldset className="space-y-3 rounded-md border border-border p-3">
                            <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Delegates to
                            </legend>
                            {agents.filter((a) => a.slug !== form.slug).length === 0 ? (
                              <p className="text-xs text-muted-foreground">
                                No other agents to delegate to. Create another agent (e.g. a
                                research or recall agent) first.
                              </p>
                            ) : (
                              <DelegatePicker
                                available={agents
                                  .filter((a) => a.slug !== form.slug)
                                  .map((a) => ({ slug: a.slug, name: a.name, enabled: a.enabled }))}
                                selected={form.delegateTo}
                                onChange={(next) => setForm((f) => ({ ...f, delegateTo: next }))}
                              />
                            )}
                            <p className="text-xs text-muted-foreground">
                              Agents this one may hand a sub-task to via the{' '}
                              <code>invoke_agent</code> tool. Empty = delegation disabled (the
                              runtime fails closed).
                              {form.delegateTo.length > 0 &&
                                !effectiveTools.includes('invoke_agent') && (
                                  <span className="mt-1 block text-warning-ink">
                                    Grant the <code>delegation</code> group (or{' '}
                                    <code>invoke_agent</code> directly), or these delegates
                                    can&apos;t actually be reached.
                                  </span>
                                )}
                            </p>
                          </fieldset>
                        </TabsContent>

                        <TabsContent
                          forceMount
                          value="memory"
                          data-agent-section="memory"
                          className="mt-0 space-y-4 data-[state=inactive]:hidden"
                        >
                          <MemorySection form={form} setForm={setForm} errors={errors} />
                          {editing.mode === 'edit' && (
                            <LearnedInJournal slug={editing.agent.slug} />
                          )}
                        </TabsContent>

                        <div className="flex justify-end gap-2 border-t border-border pt-3">
                          <Button type="button" variant="outline" onClick={closeDialog}>
                            Cancel
                          </Button>
                          <SubmitButton pending={saving}>
                            {editing.mode === 'create' ? 'Create agent' : 'Save agent'}
                          </SubmitButton>
                        </div>
                      </form>
                    </Tabs>
                  </div>
                )}
              </>
            }
          />
        </>
      )}

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. Choose what happens to its conversation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <RadioGroup
            aria-label="Conversation"
            value={deleteConversation}
            onValueChange={(v) => setDeleteConversation(v as ConversationMode)}
          >
            <div className="flex items-start gap-2">
              <RadioGroupItem id="agent_delete_keep" value="keep" className="mt-0.5" />
              <Label htmlFor="agent_delete_keep" className="grid gap-0.5 font-normal">
                <span className="text-sm font-medium">Keep conversation</span>
                <span className="text-xs text-muted-foreground">
                  The chat stays in the brain. Replay can still find it, but no screen can open it.
                </span>
              </Label>
            </div>
            <div className="flex items-start gap-2">
              <RadioGroupItem id="agent_delete_conversation" value="delete" className="mt-0.5" />
              <Label htmlFor="agent_delete_conversation" className="grid gap-0.5 font-normal">
                <span className="text-sm font-medium">Delete conversation</span>
                <span className="text-xs text-muted-foreground">
                  Remove every message and conversation summary of this agent.
                </span>
              </Label>
            </div>
          </RadioGroup>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              {deleteConversation === 'delete' ? 'Delete agent and chat' : 'Delete agent'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** What an agent learned lives in the Journal (mantle v0.232.236: the Journal
 *  is every agent's notes target). The old Learned tab edited the agent's
 *  persona notes, which no agent writes any more; this points at the
 *  Journal's view of the rules this agent learned instead. */
function LearnedInJournal({ slug }: { slug: string }) {
  const { data } = useQuery({
    queryKey: ['journal', { learnedBy: slug, count: true }],
    queryFn: () =>
      apiFetch<{ total: number }>(`/api/journal?learned_by=${encodeURIComponent(slug)}`),
  });
  return (
    <fieldset className="space-y-2 rounded-md border border-border p-3">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Learned
      </legend>
      <p className="text-sm text-muted-foreground">
        What this agent learns about working for you is kept in the Journal
        {data ? ` (${data.total} rule${data.total === 1 ? '' : 's'})` : ''}. Edit or retire a rule
        there.
      </p>
      <Button asChild variant="outline" size="sm">
        <Link href={`/journal?learned_by=${encodeURIComponent(slug)}`}>
          <BookOpen /> Open in Journal
        </Link>
      </Button>
    </fieldset>
  );
}
