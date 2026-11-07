import {
  AppWindow,
  Brain,
  CalendarDays,
  Contact,
  File,
  FileText,
  KeyRound,
  ListChecks,
  PenTool,
  Presentation,
  Sigma,
  StickyNote,
  Table2,
  type LucideIcon,
} from 'lucide-react';
import type { AppTint } from '@mantle/client-types/app-nav';
import type { TreeKind } from '@mantle/web-ui/types/tree';

/**
 * How an item of a kind looks when it has no icon of its own: the kind's
 * icon on the kind's tint. One place, so a Desk icon and a favorite in the
 * sidebar read the same.
 */
export const KIND_ICONS: Record<TreeKind, LucideIcon> = {
  files: File,
  notes: StickyNote,
  pages: FileText,
  draw: PenTool,
  tables: Table2,
  formulas: Sigma,
  apps: AppWindow,
  tasks: ListChecks,
  events: CalendarDays,
  contacts: Contact,
  secrets: KeyRound,
  recall: Brain,
  present: Presentation,
} as Record<TreeKind, LucideIcon>;

/** An item's tile colour when it has none: one per kind, so the icons read
 *  at a glance (pages blue, tasks green, apps violet...). */
export const KIND_TINT: Record<TreeKind, AppTint> = {
  files: 'slate',
  notes: 'amber',
  pages: 'blue',
  draw: 'pink',
  tables: 'teal',
  formulas: 'indigo',
  apps: 'violet',
  tasks: 'green',
  events: 'orange',
  contacts: 'cyan',
  secrets: 'slate',
  recall: 'sky',
  present: 'red',
} as Record<TreeKind, AppTint>;
