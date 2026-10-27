/**
 * The messenger's routes (Messenger V1 Phase 1, brain docs/messenger.md "The
 * API") and the react-query keys the chat screen keeps them under.
 */
import { apiFetch, apiSend } from '@mantle/web-ui/api-fetch';
import type {
  MessengerConversation,
  MessengerDirectoryResponse,
  MessengerListResponse,
  MessengerMessagesResponse,
  MessengerSendRequest,
  MessengerSendResponse,
  MessengerUnreadResponse,
} from './dto';
import { pageQuery } from './transcript';

const BASE = '/api/messenger';
const one = (id: string) => `${BASE}/c/${encodeURIComponent(id)}`;

export const messengerKeys = {
  all: ['messenger'] as const,
  list: ['messenger', 'list'] as const,
  conversation: (id: string) => ['messenger', 'conversation', id] as const,
  directory: ['messenger', 'directory'] as const,
  unread: ['messenger', 'unread'] as const,
};

export const messengerApi = {
  list: () => apiFetch<MessengerListResponse>(`${BASE}/conversations`).then((r) => r.rows ?? []),
  conversation: (id: string) =>
    apiFetch<{ conversation: MessengerConversation }>(one(id)).then((r) => r.conversation),
  messages: (id: string, q: Parameters<typeof pageQuery>[0] = {}) =>
    apiFetch<MessengerMessagesResponse>(`${one(id)}/messages${pageQuery(q)}`),
  send: (id: string, body: MessengerSendRequest) =>
    apiSend<MessengerSendResponse>(`${one(id)}/messages`, 'POST', body),
  read: (id: string, seq: number) => apiSend<unknown>(`${one(id)}/read`, 'POST', { seq }),
  typing: (id: string) => apiSend<unknown>(`${one(id)}/typing`, 'POST'),
  directory: (q = '') =>
    apiFetch<MessengerDirectoryResponse>(
      `${BASE}/directory${q ? `?q=${encodeURIComponent(q)}` : ''}`,
    ).then((r) => r.entries ?? []),
  unread: () => apiFetch<MessengerUnreadResponse>(`${BASE}/unread`),
};
