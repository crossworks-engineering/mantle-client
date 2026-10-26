'use client';

import { useState, type ReactNode } from 'react';
import type { HubNavTarget } from '@mantle/share-ui/app-bridge-protocol';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AppWindow, LayoutList, MessageSquare } from 'lucide-react';
import { AppSandbox } from '@mantle/share-ui/app-sandbox';
import { apiFetch, bounceToLogin } from '@mantle/web-ui/api-fetch';
import { Button } from '@mantle/web-ui/ui/button';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { SurfaceErrorBoundary } from '@mantle/web-ui/ui/error-boundary';
import { useToast } from '@mantle/web-ui/ui/toast';
import { SetPageTitle } from '@/components/layout/page-title';
import { AppLoader } from '@/components/app-nav/app-loader';
import { useAssistantDock } from '@/components/assistant/assistant-dock';
import { useListWorkspace } from '@/components/workspaces/use-list-workspace';
import { useShellWorkspaces } from '@/components/workspaces/use-shell-workspaces';
import {
  memberAppProblem,
  memberHubNav,
  workspaceHomeKey,
  workspaceHomeUrl,
  type WorkspaceHomeData,
} from '@/lib/member-apps';
import { ownerAppSandboxProps } from '@/lib/owner-app-sandbox';
import { noteListAnswer } from '@/lib/workspace-filter';
import { ALL_WORKSPACES_LABEL, currentWorkspaceLabel } from '@/lib/workspaces';
import { DeskHome } from './desk/desk-home';

/**
 * `/` for every login (task d78e7bde): the landing page of the current
 * workspace, and it follows the switcher. GET /api/home?ws= names the
 * workspace's home app, if any, and the data of the Built-in home, kept to
 * that workspace. "All my workspaces" asks for no workspace: the Built-in
 * home over all of them. Each workspace gets its own view (keyed by the
 * pick), so a switch never shows the last workspace's app or toggle.
 */
export function LandingHome() {
  const ws = useListWorkspace();
  return <LandingFor key={ws ?? 'all'} ws={ws} />;
}

function LandingFor({ ws }: { ws: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const shell = useShellWorkspaces();
  const { openAssistant } = useAssistantDock();
  const [failedAppId, setFailedAppId] = useState<string | null>(null);
  const [showBuiltIn, setShowBuiltIn] = useState(false);
  const home = useQuery({
    queryKey: workspaceHomeKey(ws),
    queryFn: async () =>
      noteListAnswer(await apiFetch<WorkspaceHomeData>(workspaceHomeUrl(ws)), ws),
    retry: false,
  });

  const workspaces = shell?.workspaces ?? [];
  const scope = shell?.hasWorkspaces
    ? ws
      ? currentWorkspaceLabel(ws, workspaces)
      : ALL_WORKSPACES_LABEL
    : undefined;
  const builtIn = (
    <DeskHome
      ws={ws}
      workspaces={workspaces}
      scope={scope}
      // A brain before the landing pages answers no /api/home: the desk
      // without the workspace's counts.
      hub={home.data?.hub ?? null}
      actions={
        <Button variant="outline" size="sm" onClick={() => openAssistant()}>
          <MessageSquare /> Ask the assistant
        </Button>
      }
    />
  );

  if (home.isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  const data = home.data;
  const homeApp = homeAppToShow(data, failedAppId);
  if (!data || !homeApp) return builtIn;

  const { hub } = data;
  return (
    <LandingAppView
      homeApp={homeApp}
      hub={hub}
      builtIn={builtIn}
      showBuiltIn={showBuiltIn}
      onShowBuiltIn={setShowBuiltIn}
      onNav={(target) => {
        const next = memberHubNav(hub, target);
        if (next?.kind === 'chat') openAssistant();
        else if (next?.kind === 'href') router.push(next.href);
      }}
      onError={(m) => {
        const problem = memberAppProblem(m);
        if ('signIn' in problem) bounceToLogin();
        else toast.error(problem.text);
      }}
      onLoadFailure={() => setFailedAppId(homeApp.appId)}
    />
  );
}

/** The home app the landing page shows: the workspace's, unless it failed
 *  to load in this view (then the Built-in home). Null: the Built-in home. */
export function homeAppToShow(
  data: Pick<WorkspaceHomeData, 'homeApp'> | undefined,
  failedAppId: string | null,
): WorkspaceHomeData['homeApp'] {
  return data?.homeApp && data.homeApp.appId !== failedAppId ? data.homeApp : null;
}

/**
 * The landing page with a home app: the app full-bleed, its `host.hub`
 * answered from the landing page's data, and a toggle to the Built-in home.
 * The app stays mounted while the Built-in home shows, so switching back
 * does not reload it.
 */
export function LandingAppView({
  homeApp,
  hub,
  builtIn,
  showBuiltIn,
  onShowBuiltIn,
  onNav,
  onError,
  onLoadFailure,
}: {
  homeApp: NonNullable<WorkspaceHomeData['homeApp']>;
  hub: WorkspaceHomeData['hub'];
  builtIn: ReactNode;
  showBuiltIn: boolean;
  onShowBuiltIn: (show: boolean) => void;
  onNav: (target: HubNavTarget) => void;
  onError: (message: string) => void;
  onLoadFailure: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {showBuiltIn ? null : <SetPageTitle title="Desk" />}
      <div className="flex shrink-0 justify-end gap-2 px-3 py-2">
        <Button
          variant={showBuiltIn ? 'ghost' : 'outline'}
          size="sm"
          aria-pressed={!showBuiltIn}
          onClick={() => onShowBuiltIn(false)}
        >
          <AppWindow className="size-4" aria-hidden />
          {homeApp.title || 'Home app'}
        </Button>
        <Button
          variant={showBuiltIn ? 'outline' : 'ghost'}
          size="sm"
          aria-pressed={showBuiltIn}
          onClick={() => onShowBuiltIn(true)}
        >
          <LayoutList className="size-4" aria-hidden />
          Desk
        </Button>
      </div>
      {showBuiltIn ? (
        // The desk scrolls itself.
        <div className="min-h-0 flex-1">{builtIn}</div>
      ) : null}
      <div className={showBuiltIn ? 'hidden' : 'min-h-0 flex-1'}>
        <SurfaceErrorBoundary label="the home app" resetKeys={[homeApp.appId]}>
          <AppSandbox
            appId={homeApp.appId}
            {...ownerAppSandboxProps(homeApp.appId)}
            loader={<AppLoader title={homeApp.title} icon={homeApp.icon} color={homeApp.color} />}
            frame="viewport"
            hub={{ getData: () => hub, onNav }}
            onError={onError}
            onLoadFailure={onLoadFailure}
          />
        </SurfaceErrorBoundary>
      </div>
    </div>
  );
}
