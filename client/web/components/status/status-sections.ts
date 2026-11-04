import {
  Activity,
  BrainCircuit,
  Coins,
  Cpu,
  Layers,
  ListChecks,
  PlugZap,
  Tag,
  type LucideIcon,
} from 'lucide-react';
import { formatCount } from '@mantle/web-ui/lib/format-bytes';
import { formatMicroUsd } from '@mantle/web-ui/traces-format';
import { overallText, sidecarTally, type SectionId } from '@/lib/status';
import type { StatusData } from './use-status';

export type SectionMeta = {
  id: SectionId;
  title: string;
  icon: LucideIcon;
  /** One line on what the section covers. */
  description: string;
};

/** The board's sections, in reading order: the list and the board share it. */
export const SECTIONS: readonly SectionMeta[] = [
  {
    id: 'overview',
    title: 'Overview',
    icon: Activity,
    description: 'The headline, and everything that needs attention.',
  },
  {
    id: 'compute',
    title: 'Compute',
    icon: Cpu,
    description: 'Processor, memory, disk and the database.',
  },
  {
    id: 'brain',
    title: 'Brain',
    icon: BrainCircuit,
    description: 'Capacity, nodes, facts and the memory index.',
  },
  {
    id: 'spend',
    title: 'Spend',
    icon: Coins,
    description: 'Model spend and calls, by day.',
  },
  {
    id: 'queues',
    title: 'Queues and workers',
    icon: ListChecks,
    description: 'Background jobs, the brain processes and syncs.',
  },
  {
    id: 'sidecars',
    title: 'Sidecars',
    icon: Layers,
    description: 'Every container beside the brain, on or off.',
  },
  {
    id: 'providers',
    title: 'Providers',
    icon: PlugZap,
    description: 'Embedding and extraction providers, and outages.',
  },
  {
    id: 'version',
    title: 'Version and updates',
    icon: Tag,
    description: 'What runs, what is new, and the backups.',
  },
];

const pct = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? 'n/a' : `${Math.round(v)}%`;

/** The one live reading a section's card carries, or null while unknown. */
export function sectionStat(id: SectionId, s: StatusData): string | null {
  const health = s.health.data;
  const box = s.box.data?.box;
  const dash = s.dashboard.data;
  switch (id) {
    case 'overview':
      return health ? overallText(s.issues) : null;
    case 'compute':
      return health
        ? `CPU ${pct(health.host.cpuLoadPct)} · memory ${pct(health.host.mem?.usedPct)} · disk ${pct(health.host.disk?.usedPct)}`
        : null;
    case 'brain':
      return dash
        ? `${dash.capacity.pctOfSplit}% of split · ${formatCount(dash.brain.nodesTotal)} nodes`
        : null;
    case 'spend': {
      if (box?.spend) {
        return `${formatMicroUsd(box.spend.last24hMicroUsd)} today · ${formatMicroUsd(box.spend.last30dMicroUsd)} in 30 days`;
      }
      if (!dash) return null;
      const week = dash.spend30.slice(-7).reduce((a, d) => a + d.costMicroUsd, 0);
      return `${formatMicroUsd(week)} in 7 days`;
    }
    case 'queues': {
      const ex = box?.extraction;
      const up = s.processes.filter((p) => p.level === 'ok').length;
      const reported = s.processes.filter(
        (p) => p.level !== 'unknown' && p.level !== 'idle',
      ).length;
      const parts: string[] = [];
      if (ex) parts.push(`${formatCount(ex.waiting + ex.retrying)} waiting`);
      if (reported > 0) parts.push(`${up} of ${reported} processes up`);
      return parts.length ? parts.join(' · ') : null;
    }
    case 'sidecars': {
      if (!health && !s.services.data) return null;
      const t = sidecarTally(s.sidecars);
      return `${t.up} of ${t.on} running${t.down ? ` · ${t.down} down` : ''}`;
    }
    case 'providers': {
      if (s.alerts.length > 0)
        return `${s.alerts.length} outage${s.alerts.length === 1 ? '' : 's'}`;
      const e = health?.embedder;
      if (!e) return null;
      return e.provider ? `No outages · embeds with ${e.provider}` : 'No outages';
    }
    case 'version': {
      const v = s.version.data?.version;
      if (!v) return null;
      if (!s.updates.data) return `v${v}`;
      return s.updates.data.check.updateAvailable
        ? `v${v} · update available`
        : `v${v} · up to date`;
    }
  }
}
