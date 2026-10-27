# Chats: the messenger window

The Chats screen (`/chats`) is the web and desktop window of the brain's
messenger: direct chats and groups between the logins of one brain, with the
login's assistant threads in the same list. It is Messenger V1 Phase 2. The
brain side (the store, the API, the stream, the MCP tools) is Phase 1 and is
documented in the mantle repo's `docs/messenger.md`; this page covers the
client.

## What the screen does

One screen, two panes (the `MasterDetail` scaffold, `detailFills`), the
contacts pattern: `app/(app)/chats/layout.tsx` renders `ChatsClient`, and a
chat opens at its own address, `/chats/<conversation id>`, with the list
still mounted. An assistant thread opens at `/chats/agent:<agent id>`.

- **The list** (`chats-client.tsx`, `chat-row.tsx`): the item tree's column
  (Files, Notes, Contacts): the dim column surface edge to edge, no card and
  no title (the nav says Chats), the search and New (+) on one row at the
  top, then the rows (rounded, the accent fill on the open one, no rule
  between them). Each row has the avatar (see Avatars) with a green dot while
  the other person is online, the name, the relative
  time ("10 minutes", "Yesterday", "13 days"), the last line with a tick
  when it is mine (one sent, two read) and "You:" in a group, a pin, a mute
  and a mention mark, and the green unread badge (grey when muted). The
  brain orders it: pinned first, then the newest.
- **No chat open**: a centred empty state with Start new chat.
- **New message** (`new-chat-pane.tsx`): New (+) and Start new chat open it
  in the chat pane, where the transcript goes. There is no dialog. At the
  top the filter (All, People, Agents, Groups) and a search, then the pick
  list, then the composer, so the first message is written and sent in one
  go:
  - A person becomes the recipient ("To", with a remove button). Send makes
    our direct chat (the brain answers an existing one), the pane turns
    into the transcript, and the room shows the line at once and sends it
    through its outbox once its first page is in (the clock, Retry with the
    same `clientMsgId`). Until it goes out the screen keeps it by chat, so a
    chat left before its first page still sends it when opened again. Open chat goes there
    without a message. The people are the logins that share a workspace
    with me, online first.
  - An agent opens its thread at once: it is the assistant's own thread,
    not a messenger chat. A line typed here becomes that composer's draft
    (when it has none of its own), sent from there.
  - Groups (or New group under All): a name and the members. Send creates
    it with the line, Create group without one. I am its first admin; a
    group of one ("message yourself") is allowed.
  - Cancel in the header (the focus goes back to New), or opening any
    chat, closes it. A create still in flight then opens nothing and sends
    nothing.
- **A chat open** (`chat-room.tsx`): the standard `ItemHeader` (avatar,
  name, "Online" or "Offline", or a group's head count; Details as a tool;
  Mute and Pin in More), the transcript and the composer. The pane has no
  surface, border or rounded edge of its own: it sits flat on the shell's
  background, as Pages and Files do.
- **The transcript**: the last 20 messages on open; scrolling to the top
  loads 20 older ones and keeps the reader's place. Stamps between groups of
  messages, mine on the right in the primary fill, theirs on the left on the
  muted surface with the author's name and avatar in a group (beside the
  first bubble of a run), time and ticks under each
  bubble, "edited", "This message was deleted" in italics, reaction chips
  (a chip toggles mine), system lines centred. A jump-to-latest button shows
  while scrolled up.
- **The composer** (`chat-composer.tsx`): the boxed composer surface (style
  guide 6c). Enter sends, Shift+Enter starts a new line, an input method's
  Enter never sends. An emoji button, an @ button and Send. Typing "@" opens
  the mention picker (arrows, Enter or Tab, Escape); a send carries the
  mentions still written in it. A send shows at once with a clock, and a
  refused one (the 60 a minute limit, offline) offers Retry with the same
  `clientMsgId`, so a retry never doubles a message.
- **Message actions**: React (the emoji picker, chat set first), and on my
  own messages Edit in place and Delete; a group admin may delete any
  message. Delete confirms.
- **The inspector** (`chat-inspector.tsx`, the "detail pane with an
  inspector" pattern): a resizable column beside the transcript, its width
  and open state remembered. In a room narrower than 680 px it lies over the
  transcript instead, opens only from Details (taking the focus) and closes
  on Escape or when the room widens. The title (an admin renames a group), the
  people with admin marks (an admin adds them inline, no dialog, and
  removes them), Mute and Pin,
  Clear for me, Leave group, Delete history (admins). Every destructive one
  confirms.
- **Assistant rows** open the login's own thread with that assistant: the
  dock's `AssistantThreadClient` in its `embedded` shape (no window
  controls, read while it shows), behind a dynamic import so the editor
  bundle does not ride onto every route. The brain lists an assistant once
  its thread has a message or it is pinned; New message offers all of them.

## Avatars

Every face in Chats (the rows, the header, the inspector's people, the
transcript's authors in a group, the mention picker, the New message list)
is the avatar its owner chose in Appearance, drawn by `ChatAvatar` from
`useChatFaces()` (`components/messenger/chat-faces.ts`, the rules in
`lib/messenger/faces.ts`), with the rail's precedence:

- **Me**: my uploaded photo (`/api/profile/photo` for a login with the
  settings area, the route's owner; else the messenger's photo route), then
  my generated avatar, then initials.
- **An agent**: its chosen avatar from the agents list (`/api/agents`, read
  only by a login with the assistants area), else one drawn from its slug,
  the app's own default for an agent. Never initials.
- **Another person**: the photo when the participant or the directory entry
  carries `photoVersion` (`GET /api/messenger/photo/:loginId?v=`), else the
  generated `avatar` it carries, else initials. A photo that fails to load
  steps down to the next rung.
- **A group**: the group glyph.

## Outside the screen

`components/messenger/messenger-shell.tsx`, mounted once by the shell:

- **The rail count**: `GET /api/messenger/unread`, the brain's one sum of
  people chats, groups and assistant replies, on the Chats nav entry.
- **No messenger, no entry**: a brain before Phase 1 answers that route 404;
  the Chats entry hides (`lib/messenger/nav.ts`) and nothing else runs. Any
  other failure leaves the entry and the live parts as they are.
- **Toasts**: a new message in a chat that is not on screen pops a toast
  with its author and first line; Open goes to the chat. Never for my own
  message, a system line, a muted chat (it still counts) or the chat the
  reader is looking at, and never for a chat the (fresh) list does not
  know. A notice decides on a list fetched again after the event, so a mute
  set anywhere is seen. While the stream is deaf (the gap, the polling
  fallback) the list itself says which chats moved, and those pop.
- **Desktop**: inside the desktop shell, while the window is hidden, the
  notice goes to the OS instead (`mantleDesktop.notify`, a click opens the
  chat), and the app badge follows the count (`mantleDesktop.setBadge`: the
  dock on macOS, the launcher on Linux); it clears when the window stops
  counting.
- **One stream slot per visible tab**: the brain allows a login five
  messenger streams. A browser tab in the background gives its stream back
  and fetches the gap when it is shown again; the desktop window keeps its
  stream for the OS notices.
- **Assistant replies count for every login**: the dock and an assistant
  row in Chats mark the shown thread read for an Admin user too, and only
  while the tab is visible, so the count clears as replies are read and a
  reply that lands in a background tab still counts. The assistant's reply
  stream is closed in a background browser tab as well.

## Live delivery

`GET /api/messenger/stream` sends ids and a seq, never text. The client reads
it through the shared realtime singleton
(`components/realtime/use-realtime.ts`, one connection per tab), and
`components/messenger/messenger-live.tsx` turns each event into what the
screen needs (`lib/messenger/live.ts`, `effectOf`):

| Event | What happens |
| --- | --- |
| `message` new | the list and the count refresh; the open chat fetches after its top seq; a notice may pop |
| `message` edit or delete, `reaction` | the open chat refetches that one seq |
| `read` | the receipt of that login moves (two ticks) |
| `typing` | "X is typing" for 5 seconds |
| `participants`, `history`, my own clear or mute | the open chat loads again |

**Seq is the order.** The open chat holds a window of messages sorted by seq
(`lib/messenger/transcript.ts`). Seqs have no gaps inside what a login may
read, so the catch-up asks for what is above the top of the unbroken run
held (`contiguousTop`), not the highest seq: my own send can come back
before the message under it. A refetched seq merges only inside the window
(`refetchPlacement`). A catch-up page that starts above the next seq means
the seqs between are gone (a history delete, a stint out of a group): the
chat loads again (`seqsCutAbove`). Every page load bumps an epoch, and a
catch-up, an older page or a refetch that a page load overtook is dropped.

**The gap.** On every connect of the stream, on tab focus and when the tab
becomes visible, the list refreshes and the open chat catches up.

**The polling fallback.** The brain writes a keep-alive comment every 25
seconds. A corporate proxy that buffers server-sent events swallows those and
every event with them, and the stream looks open but says nothing. The
reader reports every frame, keep-alives included (`eventStreamCore`'s
`onActivity`); `SilenceWatchdog` checks every 5 seconds, and once nothing was
heard for 35 seconds it refreshes the list and catches the open chat up every
5 seconds, until the stream speaks again.

**The read cursor** moves (`POST /c/:id/read`) only when the newest message
is on screen (the transcript at its bottom) and the tab is visible, at most
every 400 ms, never for my own newest message (a send moved my cursor
already), never before the first page or behind a failed first load.

**Typing** is sent at most once every 3 seconds while the composer has text.

**Receipts.** The brain keeps no column of other logins' read cursors for me
to read (a receipt is a stream event by design). Two ticks come from the
`read` events heard while the tab is open, and from the transcript itself:
a send moves its author's cursor, so a person has read up to their own
newest message. After a reload, a message of mine reads as "sent" until one
of those says otherwise.

## Limits of this version

- There is no "last seen": the directory says online or not (the brain's
  two-minute window).
- `avatar` and `photoVersion` on a participant and a directory entry, and
  the messenger photo route, are client-side additions to the DTO copy,
  agreed with the brain and not served yet: until the brain ships them,
  other people show initials. Both fields are optional, so a brain without
  them still works. A login without the assistants area sees an agent's
  slug avatar until the brain sends the agent's `avatar` there too.
- The DTOs are a temporary copy (`lib/messenger/dto.ts`) of the brain's
  `dto/messenger.ts` until a client-types release ships them.
- Out of scope here: attachments and voice notes (Phase 4), assistants
  answering in groups (Phase 3), the phone (Phase 5), calls.

## Testing

Unit tests, `pnpm test` (pure functions, no DOM):

- `lib/messenger/transcript.test.ts`: the seq window, paging, the unbroken
  run, refetch placement, the cut detection, the outbox, the rows drawn, the
  read rules.
- `lib/messenger/live.test.ts`: stream frames to effects, the gap on every
  connect, and the polling fallback against a fake silent stream (it polls
  every 5 seconds once silent past the heartbeat, never while keep-alives
  arrive, and stops when the stream speaks).
- `lib/messenger/format.test.ts`, `mentions.test.ts`, `notify.test.ts`,
  `nav.test.ts`, `faces.test.ts`: the words and times, mentions, when a
  notice pops and where, the rail count, the entry hiding on a 404, whose
  avatar each face draws.
- `packages/web-ui/src/event-stream-core.test.ts` and
  `components/realtime/use-realtime.test.ts`: keep-alives count as activity,
  every reconnect is a connect, and the shared stream hands both to each
  subscriber.

By hand, two logins chatting live: run a throwaway brain on the messenger
branch (never a real one for test data), point `pnpm dev:fe --port <port>`
at it (`docs/db-less-dev.md`), and sign in a second login on a second origin
(a second port: a production `next start` of the same tree works, since the
two origins keep separate sessions). Check: a message moves the other side's
row and badge with no reload; opening it turns the sender's tick to two;
typing shows; scrolling up keeps the place; a muted chat counts but does
not pop; a history delete clears the open chat on both sides.
