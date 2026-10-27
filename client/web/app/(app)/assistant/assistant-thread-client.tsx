'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GitCompareArrows, Highlighter, MapPin } from 'lucide-react';
import { apiFetch, apiSend } from '@mantle/web-ui/api-fetch';
import { useToast } from '@mantle/web-ui/ui/toast';
import { agentAccent } from '@/lib/agent-color';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import { AvatarWithLevel } from '@mantle/web-ui/avatar-with-level';
import { avatarPartsOf } from '@mantle/web-ui/avatar-parts';
import { experienceOf, experienceTitle } from '@/lib/experience';
import { AreaBackdrop } from '@mantle/web-ui/area-backdrop';
import { useAssistantDock } from '@/components/assistant/assistant-dock';
import { useMarkThreadRead } from '@/components/assistant/use-assistant-unread';
import { useIsAdminUser, useViewerAreas } from '@/components/workspaces/use-shell-workspaces';
import { chatFeatures, TURN_REFUSAL_TEXT } from '@/lib/assistant-turn-refusal';
import { shortModelName } from '@mantle/web-ui/lib/model-name';
import { cn } from '@mantle/web-ui/lib/utils';
import { ActiveRunsStrip } from '@/components/runs/active-runs-strip';
import { PendingQuestionsStrip } from '@/components/pending/pending-questions-strip';
import { AssistantClient } from './assistant-client';
import { AssistantHeaderControls } from './assistant-header-controls';
import type {
  AssistantAgentOption,
  AssistantTimelineRow,
  ChatArchiveResponse,
  ChatThreadRow,
} from '@mantle/client-types';
import { PreviousChatView, PreviousChatsList } from './previous-chats';
import { newChatToast, type ChatView } from './chat-threads-state';

/** The fields the header + chat need off the resolved agent. For a login
 *  that is not an Admin user the brain sends only id, slug, name, role and
 *  model (W7c): no avatar, and experience null. */
type ResolvedAgent = {
  id: string;
  slug: string;
  name: string;
  model: string;
  avatar?: { style: string; seed: string } | null;
};

type ThreadData = {
  agents: AssistantAgentOption[];
  agent: ResolvedAgent | null;
  messages: AssistantTimelineRow[];
  /** This login's own assistant, when the operator gave it one (migration 0143).
   *  Null when it shares the brain default. */
  assigned: { slug: string; assignedAt: string | null } | null;
  /** The open chat thread (chat archive, mantle 0231): null for a chat never
   *  restarted with New chat. ABSENT on a brain older than the feature, which
   *  is how the window knows to hide New chat and Previous chats. */
  thread?: ChatThreadRow | null;
};

/** Watermark for the last assignment this browser has already honoured. */
const ASSIGNED_SEEN_KEY = 'mantle_assistant_assigned_seen';

/**
 * Data-free /assistant. Fetches the agent list + resolved agent + initial
 * thread from GET /api/assistant/thread (keyed on the ?agent slug hint the page
 * reads from the URL/cookie), then renders the header + chat. The "..." menu's
 * agent picker switches the dock's agent, which re-keys this query.
 */
export function AssistantThreadClient({
  slugHint,
  embedded = false,
}: {
  slugHint?: string;
  /** Rendered in the Chats screen as an agent row's thread (Messenger V1
   *  Phase 2), not in the dock: no dock controls, the slug is the row's,
   *  and the thread is read while it shows. */
  embedded?: boolean;
}) {
  const {
    minimize,
    pinnedContext,
    surfaceSelection,
    surfaceChanges,
    setActiveAgentSlug,
    display,
    startPopoutMove,
    busy,
    panel,
  } = useAssistantDock();
  // Every login chats here, in its own threads (W7c). An Admin user gets
  // everything; anyone else the thread and a text composer (chatFeatures).
  const adminUser = useIsAdminUser();
  const viewerAreas = useViewerAreas();
  const features = chatFeatures(adminUser, viewerAreas);
  const queryClient = useQueryClient();
  const toast = useToast();
  // What sits under the header: the live chat, the Previous chats list, or one
  // previous chat read-only. Back to the live chat on an agent switch.
  const [view, setView] = useState<ChatView>({ kind: 'live' });
  const [startingNew, setStartingNew] = useState(false);
  useEffect(() => setView({ kind: 'live' }), [slugHint]);
  const threadQuery = useQuery({
    queryKey: ['assistant', 'thread', slugHint ?? ''],
    queryFn: () =>
      apiFetch<ThreadData>(
        slugHint
          ? `/api/assistant/thread?agent=${encodeURIComponent(slugHint)}`
          : '/api/assistant/thread',
      ),
  });

  // Adopt a NEW assignment once. The sticky `mantle_assistant_agent` cookie is
  // per-browser, so a co-admin who has been chatting to the shared agent keeps
  // landing there after the operator gives them their own — i.e. the change
  // wouldn't reach the very people it's for. Comparing the server's assignedAt
  // against a local watermark switches them over exactly once; a deliberate pick
  // from the agent picker afterwards is left alone.
  const assignedSlug = threadQuery.data?.assigned?.slug ?? null;
  const assignedAt = threadQuery.data?.assigned?.assignedAt ?? null;
  // The unread badge of a login that is not an Admin user reads its own
  // threads (W7c): showing the live thread marks it read.
  useMarkThreadRead(
    threadQuery.data?.agent?.slug,
    (embedded || (!adminUser && panel === 'open')) && view.kind === 'live',
  );

  useEffect(() => {
    if (embedded || !assignedAt || !assignedSlug) return;
    if (window.localStorage.getItem(ASSIGNED_SEEN_KEY) === assignedAt) return;
    window.localStorage.setItem(ASSIGNED_SEEN_KEY, assignedAt);
    if (slugHint !== assignedSlug) setActiveAgentSlug(assignedSlug);
  }, [embedded, assignedAt, assignedSlug, slugHint, setActiveAgentSlug]);

  if (threadQuery.isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (threadQuery.isError && !threadQuery.data) {
    return (
      <div className="flex h-full items-center justify-center p-10 text-center text-sm text-muted-foreground">
        Couldn&apos;t load the assistant.
      </div>
    );
  }

  const { agents: agentList, agent, messages } = threadQuery.data;
  const openThread = threadQuery.data.thread ?? null;
  const threadsSupported = 'thread' in threadQuery.data;

  // New chat: the brain saves the current chat in Previous chats (and writes
  // its summary) and opens a fresh one. Refetching the thread changes the open
  // thread id, which remounts the chat below with the empty transcript.
  async function startNewChat() {
    if (!agent) return;
    setStartingNew(true);
    try {
      const r = await apiSend<ChatArchiveResponse>('/api/assistant/threads', 'POST', {
        agent: agent.slug,
      });
      await queryClient.invalidateQueries({ queryKey: ['assistant'] });
      const t = newChatToast(r);
      toast[t.kind](t.text);
      setView({ kind: 'live' });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Couldn’t start a new chat. Try again.');
    } finally {
      setStartingNew(false);
    }
  }
  const accent = agent ? agentAccent(agent.slug) : null;
  const agentXp = experienceOf(agent);

  return (
    // `relative isolate` is what makes the backdrop below safe: unlike the
    // shell's panels this root is statically positioned, so without a stacking
    // context of its own a `-z-10` child would slip behind the page background
    // and vanish. `isolate` contains it.
    <div className="relative isolate flex h-full flex-col">
      {/* Renders nothing when the chat area is switched off. */}
      <AreaBackdrop area="chat" className="-z-10" />
      {/* In window mode this header IS the title bar: pointer-down anywhere on
          it that is not one of its own controls starts the move. It is a no-op
          in the other two shapes, which have nothing to move. `select-none`
          only while it can be dragged, so text stays selectable otherwise. */}
      <header
        onPointerDown={embedded ? undefined : startPopoutMove}
        className={cn(
          'flex flex-wrap items-center justify-between gap-2 border-b border-border px-6 py-3',
          !embedded && display === 'popout' && 'cursor-grab select-none active:cursor-grabbing',
        )}
      >
        <div className="flex items-center gap-3">
          {/* No initials branch: the agent always has an avatar now — the seed
              falls back to its slug when no record is stored. The corner badge
              is the agent's experience level (display only; hover explains). */}
          {agent && (
            <AvatarWithLevel
              seed={agent.avatar?.seed || agent.slug}
              parts={avatarPartsOf(agent.avatar)}
              size={40}
              level={agentXp?.level}
              title={agentXp ? experienceTitle(agentXp) : undefined}
              className="ring-2"
              containerStyle={{ '--tw-ring-color': accent?.border } as React.CSSProperties}
            />
          )}
          {/* The responder's NAME leads, and everything else is a footnote
              under it. The header used to open straight onto `slug · model`,
              which names the responder the way the machine does — you are
              talking to someone here, and their name is what tells you who
              picked up. `min-w-0` + truncate so a long one shortens rather
              than shoving the controls off the end of a narrow column. */}
          <div className="min-w-0">
            <p className="truncate text-base font-semibold leading-tight text-foreground">
              {agent ? agent.name : 'No responder'}
            </p>
            {/* The small print: which agent and model answered, or — when there
                is none — what to do about it. Same slot either way, so the
                notice reads as this responder's status line rather than as a
                banner that appears from nowhere and moves the name. */}
            <p className="mt-0.5 text-xs text-muted-foreground">
              {agent ? (
                // Short and plain (Jason, 2026-10-05): "assistant · Sonnet 5.5",
                // the full model id on hover.
                <span className="block truncate" title={agent.model}>
                  {agent.slug} · {shortModelName(agent.model)}
                </span>
              ) : adminUser ? (
                <span className="text-destructive-ink">
                  No enabled agent. Configure one at{' '}
                  <a href="/settings/agents" className="underline">
                    /settings/agents
                  </a>
                  .
                </span>
              ) : (
                <span className="text-destructive-ink">{TURN_REFUSAL_TEXT.noAssistant}</span>
              )}
            </p>
          </div>
        </div>
        {/* `ml-auto` rather than relying on `justify-between`: the header wraps,
            and once it does a `justify-between` right group drops to the LEFT of
            the next line. Floated, the controls stay on the right edge whatever
            the width. */}
        <div className="ml-auto">
          <AssistantHeaderControls
            agents={agentList}
            selected={agent?.slug ?? ''}
            threads={!!agent && threadsSupported}
            showingPrevious={view.kind !== 'live'}
            newChatDisabled={startingNew || busy}
            onPreviousChats={() =>
              setView(view.kind === 'live' ? { kind: 'list' } : { kind: 'live' })
            }
            onNewChat={startNewChat}
            onMinimise={minimize}
            embedded={embedded}
          />
        </div>
      </header>

      {/* Context strip — one line of truth about what the assistant is working
          with: the pinned on-screen node, how many sections are focused, and
          how many draft changes await review. Only when a surface is pinned. */}
      {pinnedContext.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-muted/30 px-6 py-1.5 text-xs text-muted-foreground">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <MapPin className="size-3.5 shrink-0 text-primary-ink" aria-hidden />
            <span className="truncate">
              Working on{' '}
              <span className="font-medium text-foreground">{pinnedContext[0]?.label}</span>
            </span>
          </span>
          {surfaceSelection && surfaceSelection.items.length > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <Highlighter className="size-3.5 shrink-0 text-primary-ink" aria-hidden />
              {surfaceSelection.items.length} {surfaceSelection.noun}
              {surfaceSelection.items.length === 1 ? '' : 's'} focused
            </span>
          )}
          {surfaceChanges != null && surfaceChanges > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <GitCompareArrows className="size-3.5 shrink-0" aria-hidden />
              {surfaceChanges} draft change{surfaceChanges === 1 ? '' : 's'} to review
            </span>
          )}
        </div>
      )}

      {/* Blocked runs first: a question is the only thing here the operator
          MUST act on — the run cannot advance without it. Self-hiding. */}
      {features.runs && <PendingQuestionsStrip />}
      {/* Background runs the owner has in flight — compact cards, self-hiding
          when none are active (slice 4 WP-A). Both strips read Admin-only
          routes. */}
      {features.runs && <ActiveRunsStrip />}
      {view.kind === 'live' && openThread?.continuedFrom && (
        <RowButton
          onClick={() => setView({ kind: 'thread', id: openThread.continuedFrom!.id })}
          className="border-b border-border bg-muted/30 px-6 py-1.5 text-left text-xs text-muted-foreground hover:text-foreground"
        >
          Continued from the previous chat{' '}
          <span className="font-medium text-foreground">
            {openThread.continuedFrom.title ?? 'without a title'}
          </span>
        </RowButton>
      )}
      {agent && view.kind === 'list' && (
        <PreviousChatsList
          agentSlug={agent.slug}
          onOpen={(id) => setView({ kind: 'thread', id })}
          onBack={() => setView({ kind: 'live' })}
        />
      )}
      {view.kind === 'thread' && (
        <PreviousChatView
          threadId={view.id}
          agentName={agent?.name}
          accentBorder={accent?.border ?? ''}
          onBack={() => setView({ kind: 'list' })}
          onContinued={() => setView({ kind: 'live' })}
        />
      )}
      {/* Kept mounted (hidden) while a previous chat is open, so a reply
          streaming in the live chat and the composer draft both survive. */}
      <div className={cn('flex min-h-0 flex-1 flex-col', view.kind !== 'live' && 'hidden')}>
        <AssistantClient
          // Force a remount on agent change so the draft input, attachment,
          // recording state, and optimistic messages don't carry across agents.
          // The SSR-equivalent initialMessages are already per-agent; the key
          // makes React honour the swap. The open thread id is in the key too:
          // New chat swaps it, and the fresh chat starts empty.
          key={`${agent?.slug ?? '__none__'}:${openThread?.id ?? ''}`}
          initialMessages={messages}
          agentReady={!!agent}
          agentSlug={agent?.slug}
          agentName={agent?.name}
          agentAvatar={agent?.avatar ?? null}
        />
      </div>
    </div>
  );
}
