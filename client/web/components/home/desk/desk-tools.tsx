import type { ComponentType } from 'react';
import {
  BarChart3,
  CalendarDays,
  Clock,
  Layers,
  NotebookPen,
  Palette,
  Timer,
  Waves,
} from 'lucide-react';
import type { DeskTool } from '@/lib/home-desk';

/** Each desk tool's glyph, in the settings panel and on its widget. */
export const TOOL_ICONS: Record<DeskTool, ComponentType<{ className?: string }>> = {
  clock: Clock,
  calendar: CalendarDays,
  'quick-note': NotebookPen,
  theme: Palette,
  drift: Waves,
  focus: Timer,
  glance: BarChart3,
  workspaces: Layers,
};
