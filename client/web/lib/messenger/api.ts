/**
 * The messenger's routes (Messenger V1 Phase 1, brain docs/messenger.md "The
 * API") and the react-query keys the chat screen keeps them under.
 */
import { apiFetch, apiSend } from '@mantle/web-ui/api-fetch';
import type {
  MessengerConversation,
  MessengerCreateRequest,
  MessengerCreateResponse,
  MessengerFavouriteKind,
  MessengerMessage,
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
  create: (body: MessengerCreateRequest) =>
    apiSend<MessengerCreateResponse>(`${BASE}/conversations`, 'POST', body),
  /** A group's title (admins) and my mute. */
  update: (id: string, body: { title?: string | null; muted?: boolean }) =>
    apiSend<{ conversation: MessengerConversation }>(one(id), 'PATCH', body).then(
      (r) => r.conversation,
    ),
  addPeople: (id: string, logins: string[]) =>
    apiSend<unknown>(`${one(id)}/participants`, 'POST', { logins }),
  removePerson: (id: string, loginId: string) =>
    apiSend<unknown>(`${one(id)}/participants/${encodeURIComponent(loginId)}`, 'DELETE'),
  leave: (id: string) => apiSend<unknown>(`${one(id)}/leave`, 'POST'),
  /** Clear for me: I see nothing older, nobody else is affected. */
  clear: (id: string) => apiSend<unknown>(`${one(id)}/clear`, 'POST'),
  /** Delete the history for everyone (a group's admins). */
  deleteHistory: (id: string) => apiSend<unknown>(`${one(id)}/history/delete`, 'POST', {}),
  edit: (id: string, seq: number, body: string) =>
    apiSend<{ message: MessengerMessage }>(`${one(id)}/messages/${seq}`, 'PATCH', { body }).then(
      (r) => r.message,
    ),
  remove: (id: string, seq: number) => apiSend<unknown>(`${one(id)}/messages/${seq}`, 'DELETE'),
  react: (id: string, seq: number, emoji: string) =>
    apiSend<unknown>(`${one(id)}/messages/${seq}/reactions`, 'POST', { emoji }),
  pin: (kind: MessengerFavouriteKind, id: string, on: boolean) =>
    apiSend<unknown>(
      `${BASE}/favourites/${kind}/${encodeURIComponent(id)}`,
      on ? 'PUT' : 'DELETE',
      on ? {} : undefined,
    ),
};
