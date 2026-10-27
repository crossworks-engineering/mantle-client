/**
 * Whose face a chat draws (M4): the avatar each login or agent chose in
 * Appearance. Pure, so the precedence is tested without React.
 *
 * A person: the uploaded photo, then the generated avatar, then initials
 * (the rail's order). An agent: its chosen avatar, else its slug, the app's
 * own default seed for an agent; never initials or a photo.
 *
 * Where a face comes from:
 * - me: the shell (`avatar`; the photo through /api/profile/photo while the
 *   login holds the settings area, the route's owner, as on the rail);
 * - an agent: the agents list (`/api/agents`, the assistants area), the
 *   participant or the directory entry;
 * - another person: `avatar` and `photoVersion` on the participant or the
 *   directory entry, the photo from GET /api/messenger/photo/:loginId. A
 *   brain before those fields sends neither: initials.
 */
import { APP_TINTS, type AppTint } from '@mantle/client-types/app-nav';
import type { MessengerAvatar } from './dto';

/** What the renderer takes: a seed and the builder's parts. */
export type FaceAvatar = { seed: string; parts?: Record<string, string | null> };

export type ChatFace = {
  avatar: FaceAvatar | null;
  /** The photo to try first: its route and cache-buster. */
  photo: { path: string; version: string } | null;
  /** An agent's slug, its default seed. */
  slug?: string;
};

type Known = { avatar?: MessengerAvatar | null; photoVersion?: string | null; slug?: string };

export type FaceSources = {
  me: string | null;
  myAvatar: unknown;
  /** My photo's cache-buster, only while /api/profile/photo is mine to read. */
  myPhotoVersion: string | null;
  /** By login or agent id, from the directory. */
  directory: ReadonlyMap<string, Known>;
  /** By agent id, from the agents list. */
  agents: ReadonlyMap<string, Known>;
};

export type FaceOf = {
  kind: 'login' | 'agent';
  id: string | null;
  /** What the caller already holds (a participant's fields, an agent row's
   *  slug), used before the lookups. */
  avatar?: MessengerAvatar | null;
  photoVersion?: string | null;
  slug?: string | null;
};

export const MESSENGER_PHOTO_PATH = '/api/messenger/photo';

/** A stored avatar the renderer can use: a seed, and parts only as a map of
 *  part name to variant (or null). Anything else reads as none. */
export function cleanAvatar(a: unknown): FaceAvatar | null {
  if (!a || typeof a !== 'object') return null;
  const { seed, parts } = a as { seed?: unknown; parts?: unknown };
  if (typeof seed !== 'string' || !seed.trim()) return null;
  const ok =
    parts !== null &&
    typeof parts === 'object' &&
    !Array.isArray(parts) &&
    Object.values(parts as object).every((v) => v === null || typeof v === 'string');
  return ok ? { seed, parts: parts as Record<string, string | null> } : { seed };
}

const version = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export function faceFor(who: FaceOf, src: FaceSources): ChatFace {
  if (who.kind === 'agent') {
    const listed = who.id ? src.agents.get(who.id) : undefined;
    const dir = who.id ? src.directory.get(who.id) : undefined;
    return {
      avatar: cleanAvatar(who.avatar) ?? cleanAvatar(listed?.avatar) ?? cleanAvatar(dir?.avatar),
      photo: null,
      slug: who.slug || listed?.slug || dir?.slug || undefined,
    };
  }
  const dir = who.id ? src.directory.get(who.id) : undefined;
  const avatar = cleanAvatar(who.avatar) ?? cleanAvatar(dir?.avatar);
  const sent = version(who.photoVersion) ?? version(dir?.photoVersion);
  const theirs =
    who.id && sent
      ? { path: `${MESSENGER_PHOTO_PATH}/${encodeURIComponent(who.id)}`, version: sent }
      : null;
  if (who.id && who.id === src.me) {
    return {
      avatar: cleanAvatar(src.myAvatar) ?? avatar,
      photo: src.myPhotoVersion
        ? { path: '/api/profile/photo', version: src.myPhotoVersion }
        : theirs,
    };
  }
  return { avatar, photo: theirs };
}

/** A group's look as the tile takes it: the icon, and the colour only when
 *  it is one of the tints this client knows (a stale name reads as none). */
export type GroupLook = { icon: string | null; color: AppTint | null };

export function groupLook(g: { icon?: unknown; color?: unknown } | null | undefined): GroupLook {
  const icon = typeof g?.icon === 'string' && g.icon.trim() ? g.icon : null;
  const color =
    typeof g?.color === 'string' && (APP_TINTS as readonly string[]).includes(g.color)
      ? (g.color as AppTint)
      : null;
  return { icon, color };
}

/** Whether the brain keeps a group's look: it sends the fields (null when
 *  unset) once it does. */
export function keepsGroupLook(c: object | null | undefined): boolean {
  return !!c && ('icon' in c || 'color' in c);
}
