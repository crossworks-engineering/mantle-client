'use client';

import { Settings2 } from 'lucide-react';
import type { AppDetail } from '@mantle/client-types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@mantle/web-ui/ui/dialog';
import { hasAppSettings } from '@/lib/app-settings';
import { useIsAdminUser } from '@/components/workspaces/use-shell-workspaces';
import { HeaderIconButton } from './app-item-header';
import { AppInformationalSwitch } from './app-informational-switch';
import { AppTrustToolsSwitch } from './app-trust-tools-switch';

/**
 * The admin's switches on an app (Informational, Trust its tools), behind
 * one icon-only button in the app header, so the header stays one row. MCP
 * access and each workspace's Write are in the Access panel (W5b2). A dialog, not a popover: Trust its tools asks to confirm
 * in a dialog of its own, which a popover would close under it. Nothing
 * when the app has none of them to show, and nothing for a login that is
 * not an Admin user (W6b fix round: the switches are an Admin user's only).
 */
export function AppSettingsButton({ app }: { app: AppDetail }) {
  const admin = useIsAdminUser();
  if (!hasAppSettings(app, admin)) return null;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <HeaderIconButton label="App settings" tooltip="App settings: its data and tools">
          <Settings2 />
        </HeaderIconButton>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>App settings</DialogTitle>
          <DialogDescription>Who changes its data, and how far its tools go.</DialogDescription>
        </DialogHeader>
        <div className="divide-y divide-border">
          <AppInformationalSwitch app={app} />
          <AppTrustToolsSwitch app={app} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The same switches as a dialog the item header's "App settings" tool
 *  opens (item header contract, 2026-10-21). Show the tool only when
 *  `useAppSettingsShown(app)`. */
export function AppSettingsDialog({
  app,
  open,
  onOpenChange,
}: {
  app: AppDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>App settings</DialogTitle>
          <DialogDescription>Who changes its data, and how far its tools go.</DialogDescription>
        </DialogHeader>
        <div className="divide-y divide-border">
          <AppInformationalSwitch app={app} />
          <AppTrustToolsSwitch app={app} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Whether this login has any app settings to show for the app. */
export function useAppSettingsShown(app: AppDetail): boolean {
  const admin = useIsAdminUser();
  return hasAppSettings(app, admin);
}
