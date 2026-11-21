/**
 * The messenger's DTOs: @mantle/client-types (`dto/messenger`, Phase 1,
 * released in 0.400.14), plus the fields agreed with the brain that its next
 * release adds (the avatar and photo of a person, a group's icon and
 * colour, the patch body, the people gate's card).
 *
 * LOCAL COPY: everything below the re-exports goes once the brain release
 * after 0.400.14 (mantle branches messenger-avatars and people-gate) ships
 * it in client-types. All of it is optional, so a brain without it works.
 * The preview's `via` (plan section 24) is asked of the brain, not built
 * yet: the row shows "via" only once it is sent.
 *
 * LOCAL COPY (group info): `info` on a conversation, the create body and
 * the patch body (plan section 24, mantle migration 0343, task f6f2e5f4)
 * goes once client-types ships it. A brain before 0343 drops it.
 *
 * LOCAL COPY (calls): the call types at the end (`MessengerEvent`,
 * `MessengerCapabilities`, `MessengerCallIce`, `MessengerCallJoinResponse`,
 * the call rows) and the `event` field on a message are copied from the
 * mantle branch feat/calls-p1-server (`dto/calls.ts`, `dto/messenger.ts`).
 * They go once that brain release ships them in client-types; `event` is
 * optional here so a brain before it still fits.
 *
 * LOCAL COPY (description): a login's `description` on a participant, a
 * directory entry and a person card, and PERSON_DESCRIPTION_MAX, are copied
 * from the mantle branch feat/user-description (`dto/people.ts`,
 * `dto/messenger.ts`, `person-description.ts`). They go once that brain
 * release ships them in client-types; optional here, so a brain before it
 * shows no description.
 *
 * LOCAL COPY (fleet chat): handles, intake forms, IT desks and files on
 * lines (mantle branch claude/fleet-chat-3-579456, M1 to M3): the
 * `handle` and `desk` mentions, the fleet events, `files` on a message,
 * `handle` and `intake` on a group, the send's `answers` and `leftOut`,
 * the directory's handle and desk rows, `MessengerAttachment` and
 * `MessengerOpenToResponse`. Copied from that branch's `dto/messenger.ts`;
 * they go once a client-types release after 0.709.0 ships them. Every
 * field is optional, so a brain before it fits.
 *
 * client-types 0.400.34 ships these, with `event` on a message and `info` on
 * a conversation REQUIRED. Both are omitted from the base below so they stay
 * optional here: a brain before calls or 0343 still sends neither.
 */
import type { MessengerIntakeKind } from './intake';
import type {
  MessengerParticipantKind,
  MessengerSendRequest as BaseSendRequest,
  MessengerConversation as BaseConversation,
  MessengerCreateRequest as BaseCreateRequest,
  MessengerDirectoryEntry as BaseDirectoryEntry,
  MessengerListRow as BaseListRow,
  MessengerMessage as BaseMessage,
  MessengerMessagesResponse as BaseMessagesResponse,
  MessengerParticipant as BaseParticipant,
  MessengerPreview as BasePreview,
} from '@mantle/client-types/dto/messenger';

export type {
  MessengerAuthorKind,
  MessengerConversationKind,
  MessengerFavouriteKind,
  MessengerMessageStatus,
  MessengerParticipantKind,
  MessengerReaction,
  MessengerRowKind,
  MessengerSendResponse,
  MessengerStreamEvent,
  MessengerUnreadResponse,
} from '@mantle/client-types/dto/messenger';

/** A chosen avatar, the shape /api/shell gives for my own (`dto/shell.ts`):
 *  the brain's style, the seed and the builder's parts. */
export type MessengerAvatar = { style: string; seed: string; parts: unknown };

/** A person's face: the generated avatar (null = initials; an agent: its
 *  slug's default) and a login's uploaded photo (GET /api/messenger/photo/
 *  :loginId?v=, which outranks the avatar). */
type Face = {
  avatar?: MessengerAvatar | null;
  photoVersion?: string | null;
};

/** Who a login is to the team ("Developer", "Jason's wife"), as they or an
 *  admin wrote it: their card's description, open to every login and agent
 *  that may see the card. null or absent: none set (or a brain before it).
 *  A participant carries it on one conversation's view only. */
type DescriptionField = { description?: string | null };

/** The most characters of a description, after trimming (the brain refuses
 *  more). */
export const PERSON_DESCRIPTION_MAX = 500;

/** A group's icon (an emoji, or `lucide:<name>`) and colour (an AppTint
 *  name), as a folder's. The brain sends both, null when unset. */
type GroupLookFields = {
  icon?: string | null;
  color?: string | null;
};

export type MessengerParticipant = BaseParticipant & Face & DescriptionField;

/** A row's last line, with the credential it was sent through (the
 *  message's own `via`, plan section 24): the brain's row does not carry it
 *  yet; absent or null, the preview names the author alone. */
export type MessengerPreview = BasePreview & { via?: string | null };

export type MessengerListRow = Omit<BaseListRow, 'participants' | 'preview'> &
  GroupLookFields & {
    participants: MessengerParticipant[];
    preview: MessengerPreview | null;
    /** A group's handle (fleet chat), shown as @qa; null or absent: none. */
    handle?: string | null;
  };

export type MessengerListResponse = { rows: MessengerListRow[] };

/** A group's info: what it is for and its rules, free text up to 2000
 *  characters (migration 0343); null when none, absent on a brain before
 *  it. Groups only. Agents read it too. */
type GroupInfoField = { info?: string | null };

export type MessengerConversation = Omit<BaseConversation, 'participants' | 'info'> &
  GroupLookFields &
  GroupInfoField &
  GroupHandleFields & { participants: MessengerParticipant[] };

/** A group's handle (its address on the box, shown as @qa; every login may
 *  post to it) and its intake form (fleet chat, migration 0394). null: none;
 *  absent: a brain before it. Groups only; its admins set them. */
type GroupHandleFields = {
  handle?: string | null;
  intake?: MessengerIntakeKind | null;
};

/** POST /api/messenger/conversations; a brain before the look drops the
 *  look, one before 0343 drops the info. */
export type MessengerCreateRequest = BaseCreateRequest & {
  icon?: string;
  color?: string;
  info?: string | null;
};

export type MessengerCreateResponse = {
  conversation: MessengerConversation;
  /** false when a direct chat with that login already existed. */
  created: boolean;
};

/** PATCH /api/messenger/c/:id: a group's title, look and info (its
 *  admins; null clears the info), my own mute. */
export type MessengerPatchRequest = {
  title?: string | null;
  icon?: string | null;
  color?: string | null;
  info?: string | null;
  /** null clears it; a taken handle is 409. */
  handle?: string | null;
  intake?: MessengerIntakeKind | null;
  muted?: boolean;
};

/** A directory row: a login, an agent, or (fleet chat) a handle, a group on
 *  this box every login may post to (`id` its conversation id, `name` its
 *  title, `member` whether I am in it), or an IT desk on a box linked to a
 *  Control Center (`id` its kind, `site` the Control Center's name). */
export type MessengerDirectoryEntry = Omit<BaseDirectoryEntry, 'kind'> &
  Face &
  DescriptionField & {
    kind: MessengerParticipantKind | 'handle' | 'desk';
    handle?: string;
    intake?: MessengerIntakeKind | null;
    member?: boolean;
    site?: string;
  };

export type MessengerDirectoryResponse = { entries: MessengerDirectoryEntry[] };

/** GET /api/people (the people gate): one person as the team sees them. */
export type PersonCard = {
  /** The login id. */
  id: string;
  name: string;
  /** Who the person is to the team; null: none set; absent on a brain
   *  before it. */
  description?: string | null;
  /** null: the client draws initials. */
  avatar: MessengerAvatar | null;
  /** The photo's version (GET /api/people/:id/photo?v=); null: none. */
  photoVersion: string | null;
  presence: {
    state: 'online' | 'idle' | 'busy' | 'offline';
    /** ISO: when its stream last beat; null when it never did. */
    lastActiveAt: string | null;
  };
  /** A status the person set; null until the brain stores one. */
  status: { text: string; until: string | null } | null;
};

/** What a system line marks (calls plan section 8): a call started, ended,
 *  or cut at the cap. `callId` names the call (GET .../calls). */
export type MessengerCallEvent =
  | { type: 'call_started'; callId: string }
  | { type: 'call_ended'; callId: string; seconds: number; participants: number }
  | { type: 'call_cap'; callId: string; seconds: number; participants: number };

/** Every event a system line carries: a call's, or (fleet chat) a copy
 *  line's, a line back's, a thread's first line. */
export type MessengerEvent =
  | MessengerCallEvent
  /** A copy line in a handle's group: message `from.seq` of chat
   *  `from.conversationId` named the handle. A Reply here goes back. */
  | { type: 'intake'; from: { conversationId: string; seq: number }; by: string | null }
  /** The line back in the first chat: a Reply on the copy line. */
  | {
      type: 'intake_answer';
      group: { conversationId: string; handle: string; seq: number };
      by: string | null;
    }
  /** In the group: the sender left the first chat, the answer stays here. */
  | { type: 'intake_sender_left'; seq: number }
  /** The first line of my own thread to a handle or an IT desk. */
  | { type: 'to_thread'; to: { conversationId: string } | { desk: MessengerDeskKind } }
  /** On a box: the IT desk's answer to the report this line replies to. */
  | { type: 'desk_answer'; desk: MessengerDeskKind; taskId: string }
  /** On the Control Center: a report from a box; a Reply here answers it. */
  | { type: 'desk_copy'; taskId: string; box: { id: string; name: string } };

/** The kind of an IT desk: its Send to IT kind. */
export type MessengerDeskKind = MessengerIntakeKind;

/** Where a report to an IT desk stands. */
export type MessengerDeskStatus = 'sent' | 'received' | 'answered';

/** A mention: a person or agent of the chat; a handle (`id` the group, the
 *  send fills `handle` and `seq`, the copy line); an IT desk (`id` its kind,
 *  the send fills `taskId`, a read fills `status`). A client sends `kind`
 *  and `id` only. */
export type MessengerMention =
  | { kind: MessengerParticipantKind; id: string }
  | { kind: 'handle'; id: string; handle?: string; seq?: number }
  | { kind: 'desk'; id: MessengerDeskKind; taskId?: string; status?: MessengerDeskStatus };

/** A file on a line: open it at GET /api/messenger/attachments/:id; an
 *  image shows inline. */
export type MessengerAttachment = {
  id: string;
  name: string;
  mime: string;
  bytes: number;
  kind: 'image' | 'file';
};

/** POST /api/messenger/c/:id/attachments. */
export type MessengerAttachmentResponse = { attachment: MessengerAttachment };

/** POST /api/messenger/to {handle, site?}: the chat a post to the handle
 *  goes in (the group for a member, else my own "To @qa" thread). */
export type MessengerOpenToResponse = {
  conversationId: string;
  groupId: string | null;
  member: boolean;
  desk?: MessengerDeskKind;
};

/** A send, with the fleet chat fields: the answers to the intake form of
 *  the one handle or desk named, and the files over the cap left out. */
export type MessengerSendRequest = Omit<BaseSendRequest, 'mentions'> & {
  mentions?: MessengerMention[];
  answers?: Record<string, string>;
  leftOut?: { name: string; bytes: number }[];
};

/** A message, with the event a system line carries (null on every other
 *  row; absent on a brain before calls), and its files (absent on a brain
 *  before fleet chat). */
export type MessengerMessage = Omit<BaseMessage, 'event' | 'mentions'> & {
  event?: MessengerEvent | null;
  mentions: MessengerMention[];
  files?: MessengerAttachment[];
};

export type MessengerMessagesResponse = Omit<BaseMessagesResponse, 'messages'> & {
  messages: MessengerMessage[];
};

/** GET /api/messenger/capabilities (404 on a brain before calls). */
export type MessengerCapabilities = {
  /** The Calls service is on for this brain: show the Call button. */
  calls: boolean;
  /** The agent worker is registered on this box (P2). */
  callsAgent: boolean;
  /** Always false in P1. */
  video: false;
};

/**
 * The ICE override (calls plan section 20). LiveKit tells a browser to reach
 * its TURN/TLS server on port 443, which Caddy holds; the brain hands the
 * client the same credential pair with the port LiveKit really listens on.
 * The client passes this as `rtcConfig.iceServers` (and nothing else) when
 * it connects; null when the box has no calls host or TURN is off: connect
 * with LiveKit's own list then.
 */
export type MessengerCallIce = {
  /** turns:<host>:5349?transport=tcp first, then turn:<host>:3478?transport=udp. */
  urls: string[];
  username: string;
  credential: string;
};

/** POST /api/messenger/c/:id/call and .../call/token. */
export type MessengerCallJoinResponse = {
  /** The call row; null for a call with your own assistant (P2). */
  callId: string | null;
  /** The LiveKit room: msgr-<conversationId>. */
  room: string;
  /** The signalling URL (wss://<site>/livekit behind Caddy). */
  url: string;
  /** A one-hour JWT for this login in this room. Refresh before `expiresAt`. */
  token: string;
  expiresAt: string;
  ice: MessengerCallIce | null;
};

/** POST .../call takes this body. */
export type MessengerCallStartRequest = {
  /** What this client is ("web", "desktop", "phone"), at most 32 chars. */
  device?: string | null;
};

export type MessengerCallEndedReason =
  'finished' | 'cap_reached' | 'closed_by_admin' | 'service_off' | 'reconciled';

export type MessengerCallParticipant = {
  kind: 'login' | 'agent';
  id: string;
  joinedAt: string;
  /** Null while the stay is open. */
  leftAt: string | null;
  device: string | null;
};

/** One call of a conversation. */
export type MessengerCall = {
  id: string;
  conversationId: string;
  kind: 'audio' | 'video';
  startedBy: string | null;
  /** The seq of its "call started" line. */
  startedSeq: number;
  startedAt: string;
  /** Null while the call is open. */
  endedAt: string | null;
  endedReason: MessengerCallEndedReason | null;
  durationS: number | null;
  /** The most people in it at once. */
  maxParticipants: number;
  participants: MessengerCallParticipant[];
};

/** GET /api/messenger/c/:id/calls?before=<ISO>&limit=: newest first. */
export type MessengerCallsResponse = {
  calls: MessengerCall[];
  hasMore: boolean;
};
