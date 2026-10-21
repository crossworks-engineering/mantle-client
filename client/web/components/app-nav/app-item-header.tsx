'use client';

import type { ComponentProps, ReactNode } from 'react';
import { ItemHeader } from '../layout/item-header';
import type { AppTint } from '@mantle/client-types';
import { AppTile } from './app-tile';

/**
 * The one header an app has: `ItemHeader` (item header contract,
 * 2026-10-21) with the app's tile as its glyph. The Apps pane passes the
 * fixed slots (Access, Info, Focus, Delete, Edit, More); the app editor
 * still passes its own icon group (`iconActions`) until the editors move
 * over. The test hooks the Apps screens pin stay.
 */
export function AppItemHeader({
  icon,
  color,
  title,
  tile,
  ...rest
}: Omit<ComponentProps<typeof ItemHeader>, 'visual' | 'title' | 'actionsLabel' | 'testIds'> & {
  /** In place of the plain tile (the editor's look picker). */
  tile?: ReactNode;
  icon: string | null;
  color: AppTint | null;
  title: string;
}) {
  return (
    <ItemHeader
      {...rest}
      visual={tile ?? <AppTile icon={icon} color={color} size="md" />}
      title={title || 'Untitled'}
      actionsLabel="App actions"
      testIds={{
        root: 'app-item-header',
        text: 'app-header-text-actions',
        icons: 'app-header-icon-actions',
      }}
    />
  );
}

// The header buttons live with the generic header; re-exported for Apps.
export { HeaderIconButton, HeaderInfoButton } from '../layout/item-header';
