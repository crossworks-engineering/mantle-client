/**
 * The messenger's DTOs: @mantle/client-types (`dto/messenger`, Phase 1,
 * released in 0.400.14), plus the fields agreed with the brain that its next
 * release adds (the avatar and photo of a person, a group's icon and
 * colour, the patch body, the people gate's card).
 *
 * LOCAL COPY: everything below the re-exports goes once the brain release
 * after 0.400.14 (mantle branches messenger-avatars and people-gate) ships
 * it in client-types. All of it is optional, so a brain without it works.
 */
import type {
  MessengerConversation as BaseConversation,
  MessengerCreateRequest as BaseCreateRequest,
  MessengerDirectoryEntry as BaseDirectoryEntry,
  MessengerListRow as BaseListRow,
  MessengerParticipant as BaseParticipant,
} from '@mantle/client-types/dto/messenger';

export type {
  MessengerAuthorKind,
  MessengerConversationKind,
  MessengerFavouriteKind,
  MessengerMention,
  MessengerMessage,
  MessengerMessageStatus,
  MessengerMessagesResponse,
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
