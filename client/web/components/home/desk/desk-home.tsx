'use client';

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import type { HubData } from '@mantle/share-ui/app-bridge-protocol';
import type { TreeItem, TreeKind } from '@mantle/web-ui/types/tree';
import { Button } from '@mantle/web-ui/ui/button';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { SurfaceErrorBoundary } from '@mantle/web-ui/ui/error-boundary';
import { SetPageTitle } from '@/components/layout/page-title';
import { useIsAdminUser } from '@/components/workspaces/use-shell-workspaces';
import {
  countFor,
  isPin,
  kindOf,
  removeWidget,
  withPins,
  type DeskItem,
  type DeskPrefs,
  type DeskWidgetId,
} from '@/lib/home-desk';
import type { ShellWorkspace } from '@/lib/workspaces';
import { DeskGrid } from './desk-grid';
import {
  deskKindsOf,
  hubNewestOf,
  useDeskPins,
  useDeskPrefs,
  useDeskShell,
  type DeskPin,
} from './desk-data';
import { DeskSettings } from './desk-settings';
import { DeskIcon, KindWidget, StickyNotesWidget, TasksWidget } from './widgets/items';
import { DriftWidget, ThemeWidget } from './widgets/look';
import { GlanceWidget, QuickNoteWidget, WorkspacesWidget } from './widgets/misc';
import { CalendarWidget, ClockWidget, FocusWidget } from './widgets/time';

/**
 * The Built-in home as a desk (Jason, 2026-10-26): the whole screen is a grid
 * the person arranges like a real desk. Widgets for the kinds of workspace
 * items they work in (pins first), tools (clock, calendar, quick note, the
 * theme, Drift, a focus timer...) and every pinned item as a desk icon, each
 * dragged anywhere and resized, and remembered per login. The settings panel
 * on the right turns things on and off and sets how many items each kind
 * shows.
 */
export function DeskHome({
  ws,
  scope,
  hub,
  workspaces,
  actions,
}: {
  /** The switcher's workspace; null = all of them. */
  ws: string | null;
  /** The current workspace's name, or "All my workspaces". */
  scope?: string;
  hub: Pick<HubData, 'counts' | 'sections' | 'apps'> | null;
  workspaces: readonly ShellWorkspace[];
  /** Text buttons beside the settings toggle (ask the assistant). */
  actions?: ReactNode;
}) {
  const shell = useDeskShell();
  const kinds = useMemo(() => deskKindsOf(shell.data), [shell.data]);
  const { prefs, update, reset } = useDeskPrefs(
    shell.data?.loginId ?? null,
    shell.isSuccess ? kinds : null,
  );
  const pins = useDeskPins(kinds, prefs?.icons ?? false);
  const isAdmin = useIsAdminUser();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const hubNewest = useMemo(() => hubNewestOf(hub), [hub]);
  const pinById = useMemo(() => new Map((pins?.pins ?? []).map((p) => [p.item.id, p])), [pins]);
  const items = useMemo(
    () =>
      prefs
        ? withPins(
            // A stored widget of a kind this brain no longer serves this
            // login is not drawn or asked for (it drops off at the next save).
            prefs.items.filter((i) => {
              const k = kindOf(i.id);
              return k === null || kinds.includes(k);
            }),
            pins?.pins.map((p) => p.item.id),
            prefs.icons,
            pins?.complete ?? true,
          )
        : [],
    [prefs, pins, kinds],
  );

  const setItems = useCallback(
    (next: DeskItem[]) => update((p) => ({ ...p, items: next })),
    [update],
  );
  const remove = useCallback(
    (id: DeskWidgetId) => () => update((p) => ({ ...p, items: removeWidget(p.items, id) })),
    [update],
  );

  return (
    <div className="relative flex h-full min-h-0">
      <SetPageTitle title="Desk" />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 pt-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold leading-tight">Desk</h1>
            {scope ? <p className="truncate text-xs text-muted-foreground">{scope}</p> : null}
          </div>
          <div className="flex items-center gap-2">
            {actions}
            <Button
              variant={settingsOpen ? 'secondary' : 'outline'}
              size="sm"
              aria-pressed={settingsOpen}
              onClick={() => setSettingsOpen((o) => !o)}
            >
              <SlidersHorizontal /> Customize
            </Button>
          </div>
        </header>
        <div className="min-h-0 flex-1">
          {prefs ? (
            <DeskGrid
              items={items}
              onChange={setItems}
              renderItem={(item) => (
                <SurfaceErrorBoundary label="this widget" resetKeys={[item.id]}>
                  {renderWidget(item, {
                    prefs,
                    ws,
                    hub,
                    hubNewest,
                    kinds,
                    workspaces,
                    isAdmin,
                    name: shell.data?.displayName ?? null,
                    pin: isPin(item.id) ? pinById.get(item.id.slice(4)) : undefined,
                    onRemove: remove(item.id),
                    onClock: (clock) => update((p) => ({ ...p, clock })),
                  })}
                </SurfaceErrorBoundary>
              )}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <Spinner />
            </div>
          )}
        </div>
      </div>
      {settingsOpen && prefs ? (
        <DeskSettings
          // Beside the desk on a wide screen; over its right edge on a laptop,
          // so opening it never squeezes the desk.
          className="absolute inset-0 z-20 animate-in fade-in slide-in-from-right-8 duration-200 md:inset-y-0 md:left-auto md:right-0 md:shadow-2xl 2xl:static 2xl:shadow-none"
          prefs={prefs}
          kinds={kinds}
          onChange={update}
          onReset={reset}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </div>
  );
}

type WidgetEnv = {
  prefs: DeskPrefs;
  ws: string | null;
  hub: Pick<HubData, 'counts'> | null;
  hubNewest: Partial<Record<TreeKind, TreeItem[]>>;
  kinds: readonly TreeKind[];
  workspaces: readonly ShellWorkspace[];
  isAdmin: boolean;
  name: string | null;
  pin: DeskPin | undefined;
  onRemove: () => void;
  onClock: (face: DeskPrefs['clock']) => void;
};

function renderWidget(item: DeskItem, env: WidgetEnv): ReactNode {
  const { id } = item;
  if (isPin(id)) return env.pin ? <DeskIcon id={id} pin={env.pin} /> : null;
  const kind = kindOf(id);
  if (kind === 'notes') {
    return (
      <StickyNotesWidget
        id={id}
        count={countFor(env.prefs, kind)}
        ws={env.ws}
        onRemove={env.onRemove}
      />
    );
  }
  if (kind === 'tasks') {
    return (
      <TasksWidget id={id} count={countFor(env.prefs, kind)} ws={env.ws} onRemove={env.onRemove} />
    );
  }
  if (kind) {
    return (
      <KindWidget
        id={id}
        kind={kind}
        count={countFor(env.prefs, kind)}
        ws={env.ws}
        hubNewest={env.hubNewest[kind]}
        onRemove={env.onRemove}
      />
    );
  }
  switch (id) {
    case 'clock':
      return (
        <ClockWidget
          id={id}
          name={env.name}
          face={env.prefs.clock}
          onFace={env.onClock}
          onRemove={env.onRemove}
        />
      );
    case 'calendar':
      return (
        <CalendarWidget id={id} withEvents={env.kinds.includes('events')} onRemove={env.onRemove} />
      );
    case 'quick-note':
      return <QuickNoteWidget id={id} ws={env.ws} onRemove={env.onRemove} />;
    case 'theme':
      return <ThemeWidget id={id} onRemove={env.onRemove} />;
    case 'drift':
      return <DriftWidget id={id} canSave={env.isAdmin} onRemove={env.onRemove} />;
    case 'focus':
      return <FocusWidget id={id} onRemove={env.onRemove} />;
    case 'glance':
      return (
        <GlanceWidget
          id={id}
          counts={env.hub?.counts ?? null}
          kinds={env.kinds}
          onRemove={env.onRemove}
        />
      );
    case 'workspaces':
      return <WorkspacesWidget id={id} workspaces={env.workspaces} onRemove={env.onRemove} />;
    default:
      return null;
  }
}
