/**
 * The LiveKit room behind a small port, so the session (session.ts) and its
 * tests never touch the SDK. `livekitRoom` loads livekit-client with a
 * dynamic import on the client only: Next.js SSR never sees it (plan
 * section 10). Audio only in P1: the microphone out, every remote audio
 * track attached to a hidden element.
 */

export type RoomPerson = {
  /** LiveKit's identity: login:<id> or agent:<id> (plan section 11). */
  identity: string;
  loginId: string | null;
  agentId: string | null;
  me: boolean;
  speaking: boolean;
  /** No microphone published, or it is muted. */
  muted: boolean;
};

export type RoomDropReason = 'removed' | 'room_deleted' | 'duplicate' | 'left' | 'other';

export type RoomHandlers = {
  /** Someone joined, left, muted or started speaking: `people()` changed. */
  people: () => void;
  /** The room is gone for this tab (after LiveKit's own reconnects). */
  disconnected: (reason: RoomDropReason) => void;
  /** Playback held by the autoplay rule (true), or free again. */
  audioBlocked: (blocked: boolean) => void;
};

export type RoomPort = {
  connect: (
    url: string,
    token: string,
    opts: { rtcConfig?: { iceServers: RTCIceServer[] } },
  ) => Promise<void>;
  disconnect: () => Promise<void>;
  setMicrophoneEnabled: (on: boolean) => Promise<void>;
  startAudio: () => Promise<void>;
  /** A fresh token for a reconnect from scratch (optional on the port). */
  updateToken?: (token: string) => void;
  people: () => RoomPerson[];
  on: (handlers: RoomHandlers) => () => void;
};

export type RoomFactory = () => Promise<RoomPort>;

/** `login:abc` -> { loginId: 'abc' }; `agent:x` -> { agentId: 'x' }. */
export function parseIdentity(identity: string): {
  loginId: string | null;
  agentId: string | null;
} {
  if (identity.startsWith('login:')) return { loginId: identity.slice(6), agentId: null };
  if (identity.startsWith('agent:')) return { loginId: null, agentId: identity.slice(6) };
  return { loginId: null, agentId: null };
}

/** The real thing: livekit-client, loaded when the first call starts. */
export const livekitRoom: RoomFactory = async () => {
  const lk = await import('livekit-client');
  const room = new lk.Room({
    // Audio only: nothing adaptive to do, and no simulcast layers.
    adaptiveStream: false,
    dynacast: false,
    audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    // Audio is attached by hand below, to one element per track.
    webAudioMix: false,
  });
  const audioEls = new Map<string, HTMLMediaElement>();

  const person = (p: {
    identity: string;
    isSpeaking: boolean;
    isMicrophoneEnabled: boolean;
  }): RoomPerson => ({
    identity: p.identity,
    ...parseIdentity(p.identity),
    me: p === room.localParticipant,
    speaking: p.isSpeaking,
    muted: !p.isMicrophoneEnabled,
  });

  const dropReason = (reason: unknown): RoomDropReason => {
    switch (reason) {
      case lk.DisconnectReason.PARTICIPANT_REMOVED:
        return 'removed';
      case lk.DisconnectReason.ROOM_DELETED:
      case lk.DisconnectReason.ROOM_CLOSED:
        return 'room_deleted';
      case lk.DisconnectReason.DUPLICATE_IDENTITY:
        return 'duplicate';
      case lk.DisconnectReason.CLIENT_INITIATED:
        return 'left';
      default:
        return 'other';
    }
  };

  return {
    connect: (url, token, opts) =>
      room.connect(url, token, opts.rtcConfig ? { rtcConfig: opts.rtcConfig } : {}),
    disconnect: async () => {
      await room.disconnect(true);
      for (const el of audioEls.values()) el.remove();
      audioEls.clear();
    },
    setMicrophoneEnabled: async (on) => {
      await room.localParticipant.setMicrophoneEnabled(on);
    },
    startAudio: () => room.startAudio(),
    people: () => [
      person(room.localParticipant),
      ...[...room.remoteParticipants.values()].map(person),
    ],
    on: (h) => {
      const changed = () => h.people();
      const subscribed = (track: {
        kind: string;
        sid?: string;
        attach: () => HTMLMediaElement;
      }) => {
        if (track.kind !== lk.Track.Kind.Audio) return;
        const el = track.attach();
        el.style.display = 'none';
        document.body.appendChild(el);
        audioEls.set(track.sid ?? String(audioEls.size), el);
      };
      const unsubscribed = (track: { sid?: string; detach: () => HTMLMediaElement[] }) => {
        for (const el of track.detach()) el.remove();
        if (track.sid) audioEls.delete(track.sid);
      };
      const dropped = (reason?: unknown) => h.disconnected(dropReason(reason));
      const playback = () => h.audioBlocked(!room.canPlaybackAudio);
      room
        .on(lk.RoomEvent.ParticipantConnected, changed)
        .on(lk.RoomEvent.ParticipantDisconnected, changed)
        .on(lk.RoomEvent.ActiveSpeakersChanged, changed)
        .on(lk.RoomEvent.TrackMuted, changed)
        .on(lk.RoomEvent.TrackUnmuted, changed)
        .on(lk.RoomEvent.TrackPublished, changed)
        .on(lk.RoomEvent.TrackUnpublished, changed)
        .on(lk.RoomEvent.LocalTrackPublished, changed)
        .on(lk.RoomEvent.LocalTrackUnpublished, changed)
        .on(lk.RoomEvent.TrackSubscribed, subscribed)
        .on(lk.RoomEvent.TrackUnsubscribed, unsubscribed)
        .on(lk.RoomEvent.AudioPlaybackStatusChanged, playback)
        .on(lk.RoomEvent.Disconnected, dropped);
      return () => {
        room
          .off(lk.RoomEvent.ParticipantConnected, changed)
          .off(lk.RoomEvent.ParticipantDisconnected, changed)
          .off(lk.RoomEvent.ActiveSpeakersChanged, changed)
          .off(lk.RoomEvent.TrackMuted, changed)
          .off(lk.RoomEvent.TrackUnmuted, changed)
          .off(lk.RoomEvent.TrackPublished, changed)
          .off(lk.RoomEvent.TrackUnpublished, changed)
          .off(lk.RoomEvent.LocalTrackPublished, changed)
          .off(lk.RoomEvent.LocalTrackUnpublished, changed)
          .off(lk.RoomEvent.TrackSubscribed, subscribed)
          .off(lk.RoomEvent.TrackUnsubscribed, unsubscribed)
          .off(lk.RoomEvent.AudioPlaybackStatusChanged, playback)
          .off(lk.RoomEvent.Disconnected, dropped);
      };
    },
  };
};
