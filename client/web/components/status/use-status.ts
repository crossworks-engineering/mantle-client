'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, apiFetch } from '@mantle/web-ui/api-fetch';
import { CONTRACT_VERSION } from '@mantle/web-ui/version';
import type {
  BackupConfig,
  BackupStatus,
  BrainCapacity,
  BrainCounts,
  DailySpend,
  EmailStats,
  GraphIntegrity,
  HeartbeatStats,
  IngestDay,
  RecentFailure,
  ServicesView,
  SystemHealth,
  TelegramStats,
  TopError,
  UpdateCheck,
  UpdaterStatus,
  VectorCounts,
} from '@mantle/client-types';
import { useProviderAlertsState } from '@/components/needs-you/use-provider-alerts';
import { useServerVersion } from '@/lib/server-version';
import {
  pushSample,
  processStates,
  sampleOf,
  sectionLevel,
  sidecarStates,
  statusIssues,
  type BoxStatusView,
  type Level,
  type SectionId,
  type VitalsSample,
} from '@/lib/status';

/** The /api/dashboard bundle (brain counts, 30 days of ingest and spend, the
 *  ops panels). */
export type DashboardBundle = {
  brain: BrainCounts;
  vectors: VectorCounts;
  ingest: IngestDay[];
  spend30: DailySpend[];
  email: EmailStats;
  telegram: TelegramStats;
  heartbeats: HeartbeatStats;
  pendingTools: number;
  errs: TopError[];
  fails: RecentFailure[];
  integrity: GraphIntegrity;
  capacity: BrainCapacity;
};

type UpdatesBundle = {
  check: UpdateCheck;
  available: boolean;
  status: UpdaterStatus | null;
};

type BackupsBundle = { config: BackupConfig; status: BackupStatus | null };

const HEALTH_MS = 10_000;
const BOX_MS = 30_000;
const SERVICES_MS = 30_000;
const DASHBOARD_MS = 60_000;

/** A brain before a route answers 404: that part is simply not shown. */
const no404 = (count: number, err: unknown) =>
  !(err instanceof ApiError && err.status === 404) && count < 2;

/**
 * Everything the Status screen reads, polled while it is open (react-query
 * stops polling in a hidden tab). The keys are the other screens' own
 * (`['/api/services']`, `['updates']`, `['backups']`, `['dashboard']`), so
 * opening Services or Updates from here costs nothing, and the reverse.
 */
export function useStatus() {
  const health = useQuery({
    queryKey: ['status', 'health'],
    queryFn: () => apiFetch<SystemHealth>('/api/health', { cache: 'no-store' }),
    refetchInterval: HEALTH_MS,
  });
  const box = useQuery({
    queryKey: ['status', 'box'],
    queryFn: () => apiFetch<BoxStatusView>('/api/box-status', { cache: 'no-store' }),
    refetchInterval: BOX_MS,
    retry: no404,
  });
  const services = useQuery({
    queryKey: ['/api/services'],
    queryFn: () => apiFetch<ServicesView>('/api/services'),
    refetchInterval: SERVICES_MS,
    retry: no404,
  });
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => apiFetch<DashboardBundle>('/api/dashboard'),
    refetchInterval: DASHBOARD_MS,
  });
  const updates = useQuery({
    queryKey: ['updates'],
    queryFn: () => apiFetch<UpdatesBundle>('/api/updates'),
    staleTime: 5 * 60_000,
  });
  const backups = useQuery({
    queryKey: ['backups'],
    queryFn: () => apiFetch<BackupsBundle>('/api/backups'),
    staleTime: 5 * 60_000,
  });
  const alerts = useProviderAlertsState();
  const version = useServerVersion();

  // Ten minutes of the live vitals, for the sparklines. Kept in this screen
  // only: the brain keeps no history of its load.
  const [history, setHistory] = useState<VitalsSample[]>([]);
  const h = health.data;
  useEffect(() => {
    if (h) setHistory((list) => pushSample(list, sampleOf(h)));
  }, [h]);

  const derived = useMemo(() => {
    const containers = box.data?.containers ?? null;
    const sidecars = sidecarStates({
      health: health.data ?? null,
      services: services.data ?? null,
      updaterUp: updates.data ? updates.data.available : null,
      containers,
    });
    const processes = processStates(containers);
    const contractMismatch =
      typeof version.data?.contractVersion === 'number' &&
      version.data.contractVersion !== CONTRACT_VERSION;
    const issues = statusIssues({
      health: health.data ?? null,
      box: box.data?.box ?? null,
      sidecars,
      processes: containers ? processes : [],
      capacityZone: dashboard.data?.capacity.zone ?? box.data?.box.capacity?.zone ?? null,
      providerAlerts: alerts.alerts,
      updateAvailable: updates.data?.check.updateAvailable ?? false,
      backup: backups.data?.status ?? null,
      backupsEnabled: backups.data ? backups.data.config.enabled : null,
      contractMismatch,
    });
    const known: Record<SectionId, boolean> = {
      overview: !!health.data,
      compute: !!health.data,
      brain: !!dashboard.data,
      spend: !!dashboard.data || !!box.data,
      queues: !!box.data || !!dashboard.data,
      sidecars: !!health.data || !!services.data,
      providers: alerts.loaded || !!health.data,
      version: !!version.data,
    };
    // Overview is the headline: the worst of everything, not only its own.
    const level = (s: SectionId): Level =>
      s === 'overview'
        ? sectionLevel(
            issues.map((i) => ({ ...i, section: 'overview' as const })),
            'overview',
            known.overview,
          )
        : sectionLevel(issues, s, known[s]);
    return { sidecars, processes, issues, level, contractMismatch };
  }, [
    health.data,
    box.data,
    services.data,
    dashboard.data,
    updates.data,
    backups.data,
    alerts.alerts,
    alerts.loaded,
    version.data,
  ]);

  return {
    health,
    box,
    services,
    dashboard,
    updates,
    backups,
    alerts: alerts.alerts,
    version,
    history,
    ...derived,
  };
}

export type StatusData = ReturnType<typeof useStatus>;
