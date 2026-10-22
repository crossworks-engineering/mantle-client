// Relative, not '@/': the node test runner renders the share marks, which
// draw this (components/share/workspace-chips.test.ts).
import { AppTile } from '../app-nav/app-tile';
import { resolveWorkspaceLook, type LookSource } from '../../lib/workspace-look';

/**
 * A workspace's face (task 5edc9149): its icon on a tile in its colour, or
 * the default icon of its kind on the neutral tile. The switcher, the
 * workspace screens and the share marks draw this one tile.
 */
export function WorkspaceTile({
  workspace,
  size = 'sm',
  className,
}: {
  workspace: LookSource | null | undefined;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'avatar';
  className?: string;
}) {
  const look = resolveWorkspaceLook(workspace);
  return <AppTile icon={look.icon} color={look.color} size={size} className={className} />;
}
