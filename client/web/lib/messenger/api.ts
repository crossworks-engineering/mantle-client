/**
 * The messenger's routes (Messenger V1 Phase 1, brain docs/messenger.md "The
 * API") and the react-query keys the chat screen keeps them under.
 */
import { apiFetch, apiSend } from '@mantle/web-ui/api-fetch';
import type {
  MessengerAttachmentResponse,
  MessengerConversation,
  MessengerOpenToResponse,
  MessengerCreateRequest,
  MessengerCreateResponse,
  MessengerFavouriteKind,
  MessengerMessage,
  MessengerDirectoryResponse,
  MessengerListResponse,
  MessengerMessagesResponse,
  MessengerPatchRequest,
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

/** Where a chat file is read (an `<img src>` takes it through useAssetUrl,
 *  which adds the login's `?at=` token). */
export const attachmentPath = (attachmentId: string) =>
  `${BASE}/attachments/${encodeURIComponent(attachmentId)}`;

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
  /** A group's title and look (admins) and my mute. */
  update: (id: string, body: MessengerPatchRequest) =>
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
  /** A file for the next send (fleet chat): multipart, one `file`; at most
   *  10 MB (413). The send's `attachments` names its id. */
  upload: (id: string, file: File) => {
    const fd = new FormData();
    fd.set('file', file);
    // FormData body: apiFetch (not apiSend) so the multipart boundary survives.
    return apiFetch<MessengerAttachmentResponse>(`${one(id)}/attachments`, {
      method: 'POST',
      body: fd,
    }).then((r) => r.attachment);
  },
  /** Save to Files: a copy of a chat file into folder `parentPath`. */
  saveAttachment: (attachmentId: string, parentPath: string) =>
    apiSend<{ file: { id: string; filename: string } }>(
      `${BASE}/attachments/${encodeURIComponent(attachmentId)}/save`,
      'POST',
      { parentPath },
    ).then((r) => r.file),
  /** The chat a post to a handle or an IT desk goes in: the group for a
   *  member, else my own "To @qa" thread (made once). */
  to: (handle: string, site?: string) =>
    apiSend<MessengerOpenToResponse>(`${BASE}/to`, 'POST', site ? { handle, site } : { handle }),
  pin: (kind: MessengerFavouriteKind, id: string, on: boolean) =>
    apiSend<unknown>(
      `${BASE}/favourites/${kind}/${encodeURIComponent(id)}`,
      on ? 'PUT' : 'DELETE',
      on ? {} : undefined,
    ),
};
