'use client';

/**
 * The workspace's landing page (task d78e7bde): what its users see at Home
 * while it is their current workspace. The Built-in home, or a home app the
 * workspace holds with a working published build. A Moderator of the
 * workspace picks it (PATCH /api/workspaces/:id `landingAppId`); everyone
 * else reads it. The picker's apps are the landing page's own app list
 * (GET /api/home?ws=), the apps this workspace holds that the Moderator may
 * run, plus the current home app. The brain refuses any other with 409 and
 * changes no grant.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LayoutTemplate } from 'lucide-react';
import { apiFetch } from '@mantle/web-ui/api-fetch';
import { Label } from '@mantle/web-ui/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@mantle/web-ui/ui/select';
import { useToast } from '@mantle/web-ui/ui/toast';
import type { WorkspaceLandingApp } from '@/lib/contract/workspaces';
import { canSetLanding, workspaceErrorText, type Workspace } from '@/lib/workspaces';
import { workspaceHomeKey, workspaceHomeUrl, type WorkspaceHomeData } from '@/lib/member-apps';
import { useWorkspaceActions } from './workspace-queries';
import { WorkspaceSection } from './workspace-section';

export const BUILT_IN_HOME = '__built_in__';
export const BUILT_IN_HOME_LABEL = 'Desk';
/** The picker's value for a set home app it cannot name: one the workspace
 *  no longer holds (audit M2). Picking the Built-in home from it clears it. */
export const UNNAMED_HOME = '__unnamed__';
export const NOT_HELD_TEXT = `An app this workspace no longer holds (users see ${BUILT_IN_HOME_LABEL})`;

/** What the screen says the landing page is, for a reader. */
export function landingText(app: WorkspaceLandingApp | null | undefined): string {
  if (!app) return BUILT_IN_HOME_LABEL;
  // A missing `held` counts as held (audit L-c).
  if (app.held === false) return NOT_HELD_TEXT;
  const name = app.title ?? 'A home app';
  return app.ready ? name : `${name} (no working build: users see ${BUILT_IN_HOME_LABEL})`;
}

/** The picker's value for the current landing page. */
export function landingValue(app: WorkspaceLandingApp | null | undefined): string {
  if (!app) return BUILT_IN_HOME;
  return app.held !== false && app.appId ? app.appId : UNNAMED_HOME;
}

/** The picker's choices: the Built-in home, the current home app, then the
 *  other apps the workspace holds, each once, in the order given. */
export function landingChoices(
  current: WorkspaceLandingApp | null | undefined,
  apps: ReadonlyArray<{ token: string; title: string }>,
): Array<{ value: string; label: string }> {
  const out = [{ value: BUILT_IN_HOME, label: BUILT_IN_HOME_LABEL }];
  if (current) out.push({ value: landingValue(current), label: landingText(current) });
  for (const a of apps) {
    if (a.token !== current?.appId) out.push({ value: a.token, label: a.title });
  }
  return out;
}

export function LandingSection({
  workspace,
  landingApp,
}: {
  workspace: Workspace;
  /** The detail's `landingApp` (absent from an older brain: no section). */
  landingApp: WorkspaceLandingApp | null | undefined;
}) {
  if (landingApp === undefined) return null;
  return (
    <WorkspaceSection
      title="Landing page"
      labelledBy="workspace-landing"
      description="What users see at Desk while this is their current workspace."
    >
      {canSetLanding(workspace) ? (
        <LandingPicker key={landingValue(landingApp)} workspace={workspace} current={landingApp} />
      ) : (
        <p className="text-sm">{landingText(landingApp)}</p>
      )}
    </WorkspaceSection>
  );
}

function LandingPicker({
  workspace,
  current,
}: {
  workspace: Workspace;
  current: WorkspaceLandingApp | null;
}) {
  const toast = useToast();
  const actions = useWorkspaceActions();
  const [value, setValue] = useState(landingValue(current));
  const [pending, setPending] = useState(false);
  const home = useQuery({
    queryKey: workspaceHomeKey(workspace.id),
    queryFn: () => apiFetch<WorkspaceHomeData>(workspaceHomeUrl(workspace.id)),
    retry: false,
  });
  const choices = landingChoices(current, home.data?.hub.apps ?? []);

  const apply = async (next: string) => {
    // The unnamed pointer is shown, never sent: only a clear goes out from it.
    if (next === UNNAMED_HOME) return;
    const prev = value;
    setValue(next);
    setPending(true);
    try {
      await actions.update(workspace.id, { landingAppId: next === BUILT_IN_HOME ? null : next });
      toast.success(
        next === BUILT_IN_HOME
          ? 'This workspace now lands on Desk.'
          : 'This workspace now lands on the app.',
      );
    } catch (err) {
      setValue(prev);
      toast.error(workspaceErrorText(err, 'Could not set the landing page.'));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label
        htmlFor="landingApp"
        className="flex items-center gap-1.5 text-xs text-muted-foreground"
      >
        <LayoutTemplate className="size-3.5" aria-hidden />
        Desk
      </Label>
      <Select value={value} onValueChange={(v) => void apply(v)} disabled={pending}>
        <SelectTrigger id="landingApp" size="xs" aria-label="Landing page">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {choices.map((c) => (
            <SelectItem key={c.value} value={c.value}>
              {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-[11px] leading-snug text-muted-foreground">
        A published app this workspace holds. Share an app with the workspace in its Access panel to
        list it here. Falls back to {BUILT_IN_HOME_LABEL} if the app breaks.
      </p>
    </div>
  );
}
