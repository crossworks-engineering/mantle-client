'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Hand, MousePointer2, ShieldAlert } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import { agentHands, type HandsState } from '@/lib/agent-ui/hands';
import { heldText } from '@/lib/agent-ui/model';
import { claimTurn, handleUiCall, loadAgentUiSetting, WINDOW_ID } from '@/lib/agent-ui/turn-calls';
import { placeCard } from '@/lib/tour/model';

/** How long a held request's Allow stays disarmed, so a click already on
 *  its way (the agent's, or a stray one) cannot answer it. */
const ARM_MS = 800;

function useHands(): HandsState {
  const hands = agentHands();
  return React.useSyncExternalStore(
    (fn) => hands.subscribe(fn),
    () => hands.get(),
    () => hands.get(),
  );
}

/**
 * What the user sees while an agent drives this window (lib/agent-ui): the
 * agent's cursor, a spotlight with a caption when it points at something,
 * the bar that says who is acting with Stop, and the question for a held
 * request. Every one of these is `data-agent-host`: the agent cannot read
 * or press them, and the user's clicks on them do not count as taking over.
 *
 * Renders nothing unless a session runs. In a dev build it also hands the
 * controller to the e2e specs as `window.__mantleAgentHands` (and the
 * in-app agent's call handler as `__mantleAgentCalls`); a production
 * build has no such global.
 */
export function AgentOverlay() {
  const router = useRouter();
  const state = useHands();

  React.useEffect(() => {
    const hands = agentHands();
    hands.setNavigator((path) => router.push(path));
    if (process.env.NODE_ENV !== 'production') {
      (window as unknown as { __mantleAgentHands?: unknown }).__mantleAgentHands = hands;
      (window as unknown as { __mantleAgentCalls?: unknown }).__mantleAgentCalls = {
        handleUiCall,
        claimTurn,
        loadAgentUiSetting,
        windowId: WINDOW_ID,
      };
    }
    return () => hands.setNavigator(null);
  }, [router]);

  if (!state.active && !state.consent) return null;
  if (!state.active) {
    return (
      <div data-agent-host="" className="pointer-events-none fixed inset-0 z-[80]">
        <ConsentPrompt state={state} />
      </div>
    );
  }
  return (
    <div data-agent-host="" className="pointer-events-none fixed inset-0 z-[80]">
      {state.consent && <ConsentPrompt state={state} />}
      {state.spotlight && <Spotlight el={state.spotlight.el} caption={state.spotlight.caption} />}
      {state.cursor && !state.paused && (
        <MousePointer2
          aria-hidden
          className="absolute size-6 -translate-x-1 -translate-y-1 fill-primary text-primary-foreground drop-shadow transition-[left,top] duration-300 ease-out"
          style={{ left: state.cursor.x, top: state.cursor.y }}
        />
      )}
      <AgentBar state={state} />
      {state.held && <HeldPrompt state={state} />}
    </div>
  );
}

function AgentBar({ state }: { state: HandsState }) {
  // Esc stops, heard in the capture phase: a dialog or an editor that
  // handles Esc itself (and stops it there) cannot keep it from the bar.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && e.isTrusted) agentHands().end();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-auto absolute inset-x-0 top-3 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-3 rounded-lg border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg"
    >
      <Hand className="size-4 shrink-0 text-primary-ink" aria-hidden />
      <span className="min-w-0 truncate">
        {state.paused
          ? `${state.agent} paused: you took over.`
          : `${state.agent} is using this window.`}
      </span>
      {state.paused && (
        <Button size="sm" variant="outline" onClick={() => agentHands().resume()}>
          Let it go on
        </Button>
      )}
      <Button size="sm" variant="destructive" onClick={() => agentHands().end()}>
        Stop
        <kbd className="ml-1 rounded border border-border/50 px-1 text-[10px]">Esc</kbd>
      </Button>
    </div>
  );
}

function ConsentPrompt({ state }: { state: HandsState }) {
  const ask = state.consent!;
  const [armed, setArmed] = React.useState(false);
  React.useEffect(() => {
    setArmed(false);
    const t = setTimeout(() => setArmed(true), ARM_MS);
    return () => clearTimeout(t);
  }, [ask]);
  return (
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-foreground/20">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="agent-consent-title"
        className="w-[min(26rem,calc(100%-2rem))] rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-xl"
      >
        <div className="flex items-start gap-3">
          <Hand className="mt-0.5 size-5 shrink-0 text-primary-ink" aria-hidden />
          <div className="min-w-0 space-y-1">
            <h2 id="agent-consent-title" className="font-semibold">
              {ask.agent} wants to show you around in this window
            </h2>
            <p className="text-sm text-muted-foreground">
              It moves, clicks and types where you can see it, as you. Anything that deletes, sends,
              shares or changes a setting still waits for you, and Stop ends it.
            </p>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => ask.answer(false)}>
            Not now
          </Button>
          <Button disabled={!armed} onClick={() => ask.answer(true)}>
            Allow for this session
          </Button>
        </div>
      </div>
    </div>
  );
}

function HeldPrompt({ state }: { state: HandsState }) {
  const held = state.held!;
  const [armed, setArmed] = React.useState(false);
  React.useEffect(() => {
    setArmed(false);
    const t = setTimeout(() => setArmed(true), ARM_MS);
    return () => clearTimeout(t);
  }, [held.id]);
  return (
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-foreground/20">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="agent-held-title"
        className="w-[min(26rem,calc(100%-2rem))] rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-xl"
      >
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warning-ink" aria-hidden />
          <div className="min-w-0 space-y-1">
            <h2 id="agent-held-title" className="font-semibold">
              {state.agent} wants to {heldText(held.risk, held.reason)}
            </h2>
            {held.path && (
              <p className="break-all font-mono text-xs text-muted-foreground">
                {held.method} {held.path}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              {held.risk === 'refused'
                ? 'The brain keeps this step for you. Allow it once to send it as your own, or do it yourself.'
                : 'Nothing happens unless you allow it. You can also do this step yourself.'}
            </p>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => held.answer(false)}>
            Not now
          </Button>
          <Button disabled={!armed} onClick={() => held.answer(true)}>
            Allow once
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Where an element is now, read every frame: the page can move under a
 *  spotlight (a list loads, a panel opens) and the hole must move with it. */
function useLiveRect(el: Element): DOMRect {
  const [rect, setRect] = React.useState(() => el.getBoundingClientRect());
  React.useEffect(() => {
    let frame = 0;
    const tick = () => {
      const r = el.getBoundingClientRect();
      setRect((p) =>
        p.top === r.top && p.left === r.left && p.width === r.width && p.height === r.height
          ? p
          : r,
      );
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [el]);
  return rect;
}

function Spotlight({ el, caption }: { el: Element; caption: string }) {
  const rect = useLiveRect(el);
  const pad = 6;
  const hole = {
    top: rect.top - pad,
    left: rect.left - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  };
  const card = { width: 280, height: 96 };
  const pos = placeCard(hole, card, { width: innerWidth, height: innerHeight }, 'bottom');
  return (
    <>
      <div
        aria-hidden
        className="absolute rounded-lg outline outline-2 outline-primary"
        style={{
          ...hole,
          // A theme tint, as the tour's dim: darker on a light theme, lighter
          // on a dark one.
          boxShadow: '0 0 0 100vmax color-mix(in oklab, var(--foreground) 30%, transparent)',
        }}
      />
      {caption && (
        <div
          role="note"
          className="absolute w-[280px] rounded-lg border border-border bg-popover p-3 text-sm text-popover-foreground shadow-lg"
          style={{ top: pos.top, left: pos.left }}
        >
          {caption}
        </div>
      )}
    </>
  );
}
