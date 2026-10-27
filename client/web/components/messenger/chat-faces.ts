'use client';

/**
 * `useChatFaces()`: the chosen avatars the chat screen draws (lib/messenger/
 * faces.ts says where each comes from). Reads queries the app already keeps:
 * the shell, the messenger directory, and the agents list when this login
 * holds the assistants area (the route answers 403 otherwise).
 */
import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@mantle/web-ui/api-fetch';
import type { Shell } from '@/lib/contract/shell';
import { hasArea } from '@/lib/workspaces';
import { messengerApi, messengerKeys } from '@/lib/messenger/api';
import type { MessengerAvatar } from '@/lib/messenger/dto';
import { faceFor, type ChatFace, type FaceOf, type FaceSources } from '@/lib/messenger/faces';

export type { ChatFace };

type AgentFace = { id: string; slug?: string; avatar?: MessengerAvatar | null };

export function useChatFaces(): (who: FaceOf) => ChatFace {
  // The shell is fetched once by the app frame; this only reads it.
  const shell = useQuery({
    queryKey: ['shell'],
    queryFn: () => apiFetch<Shell>('/api/shell'),
    enabled: false,
  }).data;
  // The chats screen polls the directory; this reads the same cache.
  const directory = useQuery({
    queryKey: messengerKeys.directory,
    queryFn: () => messengerApi.directory(),
  }).data;
  const assistants = !!shell && hasArea(shell.areas, 'assistants');
  // The settings screen's own query (same key, same answer): the agents with
  // the avatar each was given.
  const agents = useQuery({
    queryKey: ['agents'],
    queryFn: () => apiFetch<{ agents: AgentFace[] }>('/api/agents').then((r) => r.agents),
    enabled: assistants,
    staleTime: 5 * 60_000,
    retry: false,
  }).data;

  const sources = useMemo<FaceSources>(
    () => ({
      me: shell?.loginId || null,
      myAvatar: shell?.avatar ?? null,
      myPhotoVersion:
        shell && hasArea(shell.areas, 'settings') ? (shell.avatarPhotoVersion ?? null) : null,
      directory: new Map((directory ?? []).map((e) => [e.id, e])),
      agents: new Map((agents ?? []).map((a) => [a.id, a])),
    }),
    [shell, directory, agents],
  );
  return useCallback((who: FaceOf) => faceFor(who, sources), [sources]);
}
