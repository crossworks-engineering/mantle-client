/**
 * The messenger's DTOs: @mantle/client-types (`dto/messenger`, Phase 1,
 * released in 0.400.14), plus the fields agreed with the brain that its next
 * release adds (the avatar and photo of a person, a group's icon and
 * colour, the patch body, the people gate's card).
 *
 * LOCAL COPY: everything below the re-exports goes once the brain release
 * after 0.400.14 (mantle branches messenger-avatars and people-gate) ships
 * it in client-types. All of it is optional, so a brain without it works.
 *
 * LOCAL COPY (calls): the call types at the end (`MessengerEvent`,
 * `MessengerCapabilities`, `MessengerCallIce`, `MessengerCallJoinResponse`,
 * the call rows) and the `event` field on a message are copied from the
 * mantle branch feat/calls-p1-server (`dto/calls.ts`, `dto/messenger.ts`).
 * They go once that brain release ships them in client-types; `event` is
 * optional here so a brain before it still fits.
 */
import type {
  MessengerConversation as BaseConversation,
  MessengerCreateRequest as BaseCreateRequest,
  MessengerDirectoryEntry as BaseDirectoryEntry,
  MessengerListRow as BaseListRow,
  MessengerMessage as BaseMessage,
  MessengerMessagesResponse as BaseMessagesResponse,
  MessengerParticipant as BaseParticipant,
} from '@mantle/client-types/dto/messenger';

export type {
  MessengerAuthorKind,
  MessengerConversationKind,
  MessengerFavouriteKind,
  MessengerMention,
  MessengerMessageStatus,
  MessengerParticipantKind,
  MessengerPreview,
  MessengerReaction,
  MessengerRowKind,
  MessengerSendRequest,
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

/** A group's icon (an emoji, or `lucide:<name>`) and colour (an AppTint
 *  name), as a folder's. The brain sends both, null when unset. */
type GroupLookFields = {
  icon?: string | null;
  color?: string | null;
};

export type MessengerParticipant = BaseParticipant & Face;

export type MessengerListRow = Omit<BaseListRow, 'participants'> &
  GroupLookFields & { participants: MessengerParticipant[] };

export type MessengerListResponse = { rows: MessengerListRow[] };

export type MessengerConversation = Omit<BaseConversation, 'participants'> &
  GroupLookFields & { participants: MessengerParticipant[] };

/** POST /api/messenger/conversations; a brain before the look drops it. */
export type MessengerCreateRequest = BaseCreateRequest & { icon?: string; color?: string };

export type MessengerCreateResponse = {
  conversation: MessengerConversation;
  /** false when a direct chat with that login already existed. */
  created: boolean;
};

/** PATCH /api/messenger/c/:id: a group's title and look (its admins), my
 *  own mute. */
export type MessengerPatchRequest = {
  title?: string | null;
  icon?: string | null;
  color?: string | null;
  muted?: boolean;
};

export type MessengerDirectoryEntry = BaseDirectoryEntry & Face;

export type MessengerDirectoryResponse = { entries: MessengerDirectoryEntry[] };

/** GET /api/people (the people gate): one person as the team sees them. */
export type PersonCard = {
  /** The login id. */
  id: string;
  name: string;
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
export type MessengerEvent =
  | { type: 'call_started'; callId: string }
  | { type: 'call_ended'; callId: string; seconds: number; participants: number }
  | { type: 'call_cap'; callId: string; seconds: number; participants: number };

/** A message, with the event a call's system line carries (null on every
 *  other row; absent on a brain before calls). */
export type MessengerMessage = BaseMessage & { event?: MessengerEvent | null };

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
