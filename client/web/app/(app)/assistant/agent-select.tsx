'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@mantle/web-ui/ui/select';
import { cn } from '@mantle/web-ui/lib/utils';
import { shortModelName } from '@mantle/web-ui/lib/model-name';
import { useDockActions } from '@/components/assistant/assistant-dock';
import type { AssistantAgentOption } from '@mantle/client-types';

/** Agent picker for the assistant panel. Switching updates the selected agent
 *  in the app-wide dock (which re-keys the thread query in place AND keeps
 *  the choice in the `mantle_assistant_agent` pref, ui-prefs), with no
 *  navigation. */
export function AgentSelect({
  agents,
  selected,
  size,
  className,
}: {
  agents: AssistantAgentOption[];
  selected: string;
  size?: React.ComponentProps<typeof SelectTrigger>['size'];
  className?: string;
}) {
  const { setActiveAgentSlug } = useDockActions();
  function pick(slug: string) {
    setActiveAgentSlug(slug);
  }
  return (
    <Select value={selected} onValueChange={pick}>
      {/* The trigger shows the name only; role and model are for the list
          (and already sit under the name in the header). */}
      <SelectTrigger
        size={size}
        className={cn('w-60 [&_[data-agent-meta]]:hidden', className)}
        aria-label="Choose agent"
      >
        <SelectValue placeholder="Select agent" />
      </SelectTrigger>
      <SelectContent>
        {agents.map((a) => (
          <SelectItem key={a.slug} value={a.slug}>
            <span className="font-medium">{a.name}</span>
            <span data-agent-meta className="ml-2 text-xs text-muted-foreground">
              {a.role} · {shortModelName(a.model)}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
