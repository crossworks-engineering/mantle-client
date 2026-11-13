'use client';

import {
  ListCard,
  ListCardMeta,
  ListCardSnippet,
  ListCardTitle,
} from '@mantle/web-ui/ui/list-card';
import { cn } from '@mantle/web-ui/lib/utils';
import type { SectionId } from '@/lib/status';
import { LEVEL_INK, LevelDot } from './status-parts';
import { SECTIONS, sectionStat } from './status-sections';
import type { StatusData } from './use-status';

/**
 * The Status list column: one card per section of the board, each with its
 * level and the one reading worth knowing before you look. A click scrolls
 * the board to that section; the card of the section in view is selected
 * (the board reports it). A section that needs attention carries the
 * warning bar (§8: one marker per card, status tokens only).
 */
export function StatusNav({
  status,
  active,
  onPick,
  emptyText = 'Loading',
}: {
  status: StatusData;
  active: SectionId;
  onPick: (id: SectionId) => void;
  /** What a card says while its section has no reading. */
  emptyText?: string;
}) {
  return (
    <nav aria-label="Status sections" className="h-full overflow-y-auto p-3 scrollbar-thin">
      <ul className="space-y-2">
        {SECTIONS.map((sec) => {
          const level = status.level(sec.id);
          const stat = sectionStat(sec.id, status);
          const Icon = sec.icon;
          return (
            <li key={sec.id}>
              <ListCard
                selected={active === sec.id}
                accent={level === 'warn' || level === 'crit' ? 'warning' : undefined}
                aria-current={active === sec.id ? 'true' : undefined}
                onClick={() => onPick(sec.id)}
              >
                <div className="flex items-start gap-2.5">
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <ListCardTitle className="flex-1">{sec.title}</ListCardTitle>
                      <LevelDot level={level} />
                    </div>
                    <ListCardSnippet>{sec.description}</ListCardSnippet>
                    <ListCardMeta
                      className={cn(
                        'tabular-nums',
                        (level === 'warn' || level === 'crit') && LEVEL_INK[level],
                      )}
                    >
                      {stat ?? emptyText}
                    </ListCardMeta>
                  </div>
                </div>
              </ListCard>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
