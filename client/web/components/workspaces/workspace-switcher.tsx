'use client';

import { useWsFilterHonoured } from '@/lib/workspace-filter';
import Link from 'next/link';
import { ChevronsUpDown, Layers } from 'lucide-react';
import { cn } from '@mantle/web-ui/lib/utils';
import { Button } from '@mantle/web-ui/ui/button';
import { RowButton } from '@mantle/web-ui/ui/row-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@mantle/web-ui/ui/dropdown-menu';
import {
  ALL_WORKSPACES,
  ALL_WORKSPACES_LABEL,
  switcherNote,
  currentWorkspaceLabel,
  isPrivateWorkspace,
  resolveCurrentWorkspace,
  sortWorkspaces,
  workspaceLabel,
  type ShellWorkspace,
} from '@/lib/workspaces';
import { useCurrentWorkspace } from '@/lib/workspace-current';
import { useShellWorkspaces } from './use-shell-workspaces';
import { WorkspaceTile } from './workspace-tile';

export type SwitcherOption = { value: string; label: string; hint: string | null };

/** The menu's choices, top to bottom: All my workspaces, the login's private
 *  workspace ("Only you", W6b: unmarked, it is always the login's own), then
 *  each other workspace (Admin first, then by name), each Moderator one
 *  marked. */
export function switcherOptions(workspaces: readonly ShellWorkspace[]): SwitcherOption[] {
  const sorted = sortWorkspaces(workspaces.map((w) => ({ ...w, archived: false })));
  const own = sorted.filter(isPrivateWorkspace);
  const rest = sorted.filter((w) => !isPrivateWorkspace(w));
  return [
    { value: ALL_WORKSPACES, label: ALL_WORKSPACES_LABEL, hint: null },
    ...own.map((w) => ({ value: w.id, label: workspaceLabel(w), hint: null })),
    ...rest.map((w) => ({ value: w.id, label: w.name, hint: w.moderator ? 'Moderator' : null })),
  ];
}

/**
 * The workspace switcher (plan 7.1): in the rail under the profile row, and in
 * the phone bar. It lists the login's workspaces and keeps the choice per
 * login. The lists follow it (useListWorkspace, W5b).
 *
 * Renders nothing for a brain that sends no workspaces (before W5a).
 */
export function WorkspaceSwitcher({
  variant = 'rail',
  onNavigate,
}: {
  /** `rail`: a full-width row (an icon in the collapsed rail). `bar`: an
   *  icon button for the phone bar. */
  variant?: 'rail' | 'bar';
  onNavigate?: () => void;
}) {
  const info = useShellWorkspaces();
  const [stored, setStored] = useCurrentWorkspace(info?.login);
  const honoured = useWsFilterHonoured();
  if (!info?.hasWorkspaces) return null;
  const current = resolveCurrentWorkspace(stored, info.workspaces);
  return (
    <WorkspaceSwitcherView
      variant={variant}
      workspaces={info.workspaces}
      current={current}
      onChange={(id) => setStored(id === ALL_WORKSPACES ? null : id)}
      onNavigate={onNavigate}
      honoured={honoured}
    />
  );
}

export function WorkspaceSwitcherView({
  variant,
  workspaces,
  current,
  onChange,
  onNavigate,
  honoured = false,
}: {
  variant: 'rail' | 'bar';
  workspaces: readonly ShellWorkspace[];
  current: string;
  onChange: (id: string) => void;
  onNavigate?: () => void;
  /** The brain filters lists by workspace (seen in a list answer). */
  honoured?: boolean;
}) {
  const label = currentWorkspaceLabel(current, workspaces);
  const options = switcherOptions(workspaces);
  // Each workspace's tile (task 5edc9149); All my workspaces keeps the
  // stack glyph.
  const byId = new Map(workspaces.map((w) => [w.id, w]));
  const picked = byId.get(current);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === 'bar' ? (
          <Button variant="ghost" size="icon" aria-label={`Workspace: ${label}`} title={label}>
            {picked ? <WorkspaceTile workspace={picked} size="sm" /> : <Layers />}
          </Button>
        ) : (
          <RowButton
            data-tour="workspace-switcher"
            aria-label={`Workspace: ${label}`}
            title={label}
            className={cn(
              // `px-[7px]`, one under the profile row's `px-2`: the 1px border
              // makes up the difference, so both circles share one column.
              'flex w-full items-center gap-2.5 rounded-lg px-[7px] py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
              // Boxed: a bordered card, so the switcher reads as a control of
              // its own and not as a second account row under the profile.
              'border border-sidebar-border bg-background/50 shadow-xs',
              'hover:bg-foreground/[0.06] data-[state=open]:bg-foreground/[0.06]',
              // The collapsed rail drops the box: the circle alone sits under
              // the avatar, the same size, centred like it.
              'group-data-[nav-collapsed=true]/shell:justify-center group-data-[nav-collapsed=true]/shell:gap-0 group-data-[nav-collapsed=true]/shell:border-transparent group-data-[nav-collapsed=true]/shell:bg-transparent group-data-[nav-collapsed=true]/shell:px-0 group-data-[nav-collapsed=true]/shell:shadow-none',
            )}
          >
            {/* A circle the profile avatar's size (28px), so the two faces
                stack evenly in the band. */}
            {picked ? (
              <WorkspaceTile workspace={picked} size="avatar" />
            ) : (
              <span
                aria-hidden
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
              >
                <Layers className="size-4" />
              </span>
            )}
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground group-data-[nav-collapsed=true]/shell:hidden">
              {label}
            </span>
            <ChevronsUpDown
              className="size-3.5 shrink-0 text-muted-foreground group-data-[nav-collapsed=true]/shell:hidden"
              aria-hidden
            />
          </RowButton>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={variant === 'rail' ? 'start' : 'end'}
        side="bottom"
        className="w-64"
      >
        <DropdownMenuLabel>Workspace</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={current} onValueChange={onChange}>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value} className="gap-2">
              {byId.has(o.value) ? (
                <WorkspaceTile workspace={byId.get(o.value)} size="sm" />
              ) : (
                <Layers className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.hint ? (
                <span className="ml-2 shrink-0 text-xs text-muted-foreground">{o.hint}</span>
              ) : null}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-xs text-muted-foreground">{switcherNote(honoured)}</p>
        <DropdownMenuItem asChild>
          <Link href="/settings/workspaces" onClick={onNavigate}>
            Manage workspaces
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
