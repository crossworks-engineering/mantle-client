# Calls: voice calls between people

Calls P1 (the plan is dev-brain page 886126b4, sections 5, 8, 9, 10, 11, 18
and 20): a voice call between the people of a direct chat or a group, over
the brain's self-hosted LiveKit server. The brain side (the call store, the
routes, the webhook, the reconciler, the LiveKit service and its ports) is
the mantle branch `feat/calls-p1-server` and is documented in that repo's
`docs/messenger.md` ("Calls"); this page covers the client, web and desktop.
The phone app is a later phase.

## What it does

- **Capabilities.** `GET /api/messenger/capabilities` says whether the Calls
  service is on (`{calls, callsAgent, video: false}`). The answer is cached a
  minute; a brain before calls answers 404 and is asked once per load. When
  calls are off there is no Call button anywhere.
- **Call.** The chat header (`chat-room.tsx`) has Call in its icon group
  when calls are on, the reader is still in the chat, and the chat has a
  person to call (a direct chat with an agent has none in P1). Call POSTs
  `/api/messenger/c/:id/call` with `{device: "web" | "desktop"}`: the brain
  starts the chat's call, or joins the open one, and answers
  `{callId, room, url, token, expiresAt, ice}`. The client connects to the
  LiveKit room with that token (the ICE rule below), publishes the
  microphone, and the dock shows the call. While this tab is in the chat's
  call the same slot reads Leave the call (Cancel the call while joining);
  while it is in another chat's call the slot is greyed ("leave it first").
- **The ring.** The brain writes a system line "Name started a call." with
  `event: {type: 'call_started', callId}`; it travels on the normal message
  stream like any line. Every other person's client fetches it and rings
  (`shouldRing`, `lib/calls/ring.ts`): a card in the dock stack with the
  caller's face (the group's tile for a group), Answer and Decline, for 45
  seconds; a soft two-tone ring on the web (the Web Audio API, nothing to
  download, silent until the page has had a click); inside the desktop
  shell the dock bounces (or the taskbar flashes) and, while the window is
  hidden, the OS notice "Name is calling" whose click opens the chat with
  the card still there. A muted chat never rings. Decline sends nothing (the
  brain has no decline in P1): the ring stops, in every tab of the login.
  Answer first asks the brain whether the call is still open
  (`GET .../calls?limit=1`), then joins; a ring that outlived its call says
  "The call ended." instead of starting a new one.
- **The dock** (`components/calls/call-dock.tsx`): one card in the dock
  stack beside the uploads, mounted once by the app shell, so a call
  survives every route change. The chat's name and the running time; who is
  in the room, with the faces the chat knows, green while speaking, a muted
  mark; Mute, Open chat, Leave; a group's admin (either person of a direct
  chat) has End for all (confirmed) and, in a group, Remove beside each
  person. "Tap to hear the call" shows while the browser holds playback back
  until a tap; "No microphone" says the others cannot hear you when the
  microphone was refused (you are in the call, listening). What ended the
  last call is said once as a toast ("The call ended.", "You are no longer
  in this call here.", "The call was cut off."). The card collapses to one
  row.
- **The transcript.** A call's lines show with a phone mark: the start as
  the brain wrote it, the end with the duration and the head count ("Call
  ended (13 min, 3 people)."; at the cap "Call ended at the time limit
  (4 h, 1 person)."). The start line of a call still open in the loaded
  window offers Join, which checks with the brain first like Answer.
- **Leaving.** Leave disconnects the room and POSTs `.../call/leave`, a
  courtesy so the brain closes the stay fast; the brain's webhook and its
  reconciler are the truth. A tab that closes or reloads sends the same leave
  with a keepalive request on `pagehide` (best effort; cross-origin it needs
  a preflight some browsers drop, and the reconciler closes the stay then).
  A room dropped by the network sends the leave too; a room closed by the
  brain (an admin's remove, the call ending, a join from another device)
  does not, because a leave from the old device would close the stay the new
  one just opened.
- **One call at a time.** A login is in one call across its tabs and
  devices: a second join swaps the device server-side, and the old one sees
  its room drop. The login's tabs on one origin share a `BroadcastChannel`
  (`lib/calls/tabs.ts`): answered or declined in one stops the ring in the
  rest, and a call started in one is "mine" in the rest, so none of them
  rings for it.
- **The token.** A token is an hour's; the client asks for a fresh one five
  minutes before (`POST .../call/token`), which re-checks that the login is
  still in the chat (403: it leaves; 404: the call ended). LiveKit refreshes
  the token of a live connection itself; the brain's is the participation
  check.
- **Desktop.** The main process grants the microphone (audio only) to the
  app's own main frame on the renderer origin and nothing else
  (`permissionAllowed`, `client/desktop/src/main/brain-fence.ts`); every
  other permission keeps the answer it had before a handler existed. The CSP
  names the brain's `wss://` twin in `connect-src` for the signalling socket.

## The ICE rule (plan section 20, decision D2 amended)

LiveKit advertises its TURN/TLS server to browsers as `turns:<domain>:443`,
a fixed string in the binary, and Caddy holds 443. So the brain hands the
client the room's own TURN credential with the ports LiveKit really listens
on: `ice` is `{urls: ['turns:<host>:5349?transport=tcp',
'turn:<host>:3478?transport=udp'], username, credential}` or null.

The client's rule, exact (`lib/calls/ice.ts`, pinned by `ice.test.ts` and
the session test):

- When `ice` is not null, connect with `rtcConfig: {iceServers: [ice]}` and
  NOTHING else: no LiveKit default server beside it, no other `rtcConfig`
  key, no TURN URL derived on the client.
- When `ice` is null (the box has no calls host, or TURN is off), pass no
  `rtcConfig` at all, so LiveKit connects with its own list.

livekit-client keeps the override for its own reconnects (it rebuilds the
RTC configuration from the same connect options).

## The pieces

- `lib/messenger/dto.ts`: the call DTOs (a local copy of the brain branch's
  `dto/calls.ts` and the `event` field of `dto/messenger.ts`; they go once
  that brain release ships them in `@crossworks/client-types`).
- `lib/calls/api.ts`: the routes; `leaveOnUnload` (the keepalive leave).
- `lib/calls/ice.ts`: the ICE rule.
- `lib/calls/room.ts`: the LiveKit room behind a small port (`RoomPort`);
  `livekitRoom` loads `livekit-client` with a dynamic import on the client
  only, so Next.js SSR never sees it. Audio only: the microphone out, each
  remote audio track attached to a hidden element.
- `lib/calls/session.ts`: the machine (idle, ringing, joining, live,
  ending: `reduce`) and `CallSession`, which drives it against the routes
  and the port. Everything a user or the brain can cause is an arrow;
  anything that does not fit the phase changes nothing. Pinned by
  `session.test.ts` with a fake room and a fake clock.
- `lib/calls/ring.ts`: `shouldRing`, the caller's name from the line, the
  words, the transcript's call lines, `openCallSeq`, and `RingBook` (one seq
  handled once across the event path and the gap path).
- `lib/calls/tabs.ts`: the login's other tabs.
- `components/calls/call-store.tsx`: the one session per tab and
  `useCallState()`; `CallUnloadGuard`.
- `components/calls/call-ringer.tsx`: headless, beside the messenger
  notices while the tab has the stream: fetches each new line, rings or
  ends. The lines of one chat are handled in order, so an end heard right
  after a start is seen before the start rings; after a gap the ringing
  chat is read past its start line for an end.
- `components/calls/ring-card.tsx`, `call-dock.tsx`,
  `use-calls-capabilities.ts`.

## Not in P1

- Agents in a call (the assistant's Call button, Ask the agent, captions)
  and the agent routes: P2. The brain answers those routes 501 until then.
- Video: `video` is always false.
- A device menu (the browser's default microphone is used), speaking
  visualisers beyond the green name, the Calls history filter (the route
  exists; the lines already show the calls).
- A decline the caller sees: a decline is local, the brain records nothing.
- The phone app: it shows a call as a line and joins from a foreground app
  in P5; ringing proper (CallKit, ConnectionService) with it.
- Presence "in a call": rides the presence step of the messenger plan.
- The caller's identity on the `call_started` event: the line names the
  caller by name only, so the client tells its own call apart by what it
  started itself (this tab, its sibling tabs) and by the name on the line.
  A `by` field on the event is the brain-side follow-up that makes this
  exact.

## How to run it

Point the frontend at a brain on the calls branch with calls on (never a
real brain for test data): `client/web/.env.detached.local` with
`MANTLE_REMOTE=<brain origin>`, `pnpm dev:fe --port 3002`
(`docs/db-less-dev.md`), open `/chats`. Two tabs of one login prove the
tabs channel (the second tab never rings for the first's call, and swaps
the device when it joins); two logins on two origins prove the ring.
