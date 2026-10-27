'use client';

import {
  History,
  Maximize2,
  MessageSquarePlus,
  Minus,
  PanelRight,
  PictureInPicture2,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@mantle/web-ui/ui/tooltip';
import type { AssistantAgentOption } from '@mantle/client-types';
import { useAssistantDock, type AssistantDisplay } from '@/components/assistant/assistant-dock';
import { switchableShapes } from './assistant-shapes';
import { AgentSelect } from './agent-select';
import { NEW_CHAT_LABEL, PREVIOUS_CHATS_LABEL } from './chat-threads-state';

/**
 * The assistant header's controls (Jason, 2026-10-13): no "..." menu any more.
 * One row of icon buttons, each naming itself in a tooltip on hover, then the
 * agent picker, the only dropdown left:
 *
 *   Previous chats · New chat · the panel shapes you can switch to (the
 *   current one is left out: in Side, Window and Full; wide screens only) ·
 *   Minimise · agent
 *
 * Previous chats and New chat are left out on a brain older than New chat.
 */
const SHAPE_ICONS: Record<AssistantDisplay, LucideIcon> = {
  docked: PanelRight,
  popout: PictureInPicture2,
  full: Maximize2,
};

export function AssistantHeaderControls({
  agents,
  selected,
  threads,
  showingPrevious,
  newChatDisabled,
  onPreviousChats,
  onNewChat,
  onMinimise,
  embedded = false,
}: {
  agents: AssistantAgentOption[];
  selected: string;
  /** False on a brain older than New chat: Previous chats and New chat are left out. */
  threads: boolean;
  showingPrevious: boolean;
  newChatDisabled: boolean;
  onPreviousChats: () => void;
  onNewChat: () => void;
  onMinimise: () => void;
  /** Inside the Chats screen (Messenger V1 Phase 2): no window shapes, no
   *  Minimise, no agent picker (the list picks the agent). */
  embedded?: boolean;
}) {
  const { display, setDisplay } = useAssistantDock();
  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-1">
        {threads && (
          <>
            <IconAction
              icon={History}
              label={PREVIOUS_CHATS_LABEL}
              pressed={showingPrevious}
              onClick={onPreviousChats}
            />
            <IconAction
              icon={MessageSquarePlus}
              label={NEW_CHAT_LABEL}
              disabled={newChatDisabled}
              onClick={onNewChat}
            />
          </>
        )}
        {(embedded ? [] : switchableShapes(display)).map((shape) => (
          <IconAction
            key={shape.value}
            icon={SHAPE_ICONS[shape.value]}
            label={shape.title}
            className="hidden lg:inline-flex"
            onClick={() => setDisplay(shape.value)}
          />
        ))}
        {embedded ? null : <IconAction icon={Minus} label="Minimise (Esc)" onClick={onMinimise} />}
        {agents.length > 0 && !embedded && (
          <AgentSelect
            agents={agents}
            selected={selected}
            size="xs"
            className="ml-1 w-auto max-w-44"
          />
        )}
      </div>
    </TooltipProvider>
  );
}

function IconAction({
  icon: Icon,
  label,
  pressed,
  disabled,
  className,
  onClick,
}: {
  icon: LucideIcon;
  /** The accessible name and the tooltip. */
  label: string;
  /** Set for a toggle: shows it held down while on. */
  pressed?: boolean;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={pressed ? 'secondary' : 'ghost'}
          size="icon-xs"
          aria-label={label}
          aria-pressed={pressed}
          disabled={disabled}
          className={className}
          onClick={onClick}
        >
          <Icon aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
