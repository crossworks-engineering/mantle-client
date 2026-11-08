# Changelog

Notable changes per release of MantleOS Desktop: the owner UI, the desktop
shells and the UI kit in this repo. Releases are tagged `vX.Y.Z`; a tag
builds the image `titanwest/mantle-client:vX.Y.Z` and the desktop installers
(a draft GitHub release). Not every version was tagged: an untagged one has
no image or installers of its own, and its changes ship with the next tag.
Which brain release a client pairs with is recorded in the mantle repo's
`client-pair.tag`. The in-app Changelog screen reads the brain's own
changelog, not this file.

Entries begin at v0.7.0. Earlier history lives in git and in the mantle
repo's `CHANGELOG.md`.

## v0.9.18: the working bubble and the Chats window

- **New:** a bubble card shows what the assistant did in its first paragraph, a line of the tools it used, and buttons for the items it links.
- **New:** reply from the card: a one-line field. A thumbs up answers a person's line.
- **New:** a live card while a turn you sent runs: the talking face, the step, the text so far, Stop, then the final reply.
- **New:** the Assistant window is now the Chats window: the Chats screen's list of people, groups and agents, with search. A click opens the chat in the window, and Back returns to the list. The window stays open when you change screens, and a reload opens it again.
- It works with a brain from v0.500.37; with v0.500.38 the first sentence says what was done.

## v0.9.17: chat bubbles

- **New:** chat bubbles. A new assistant reply or a new chat message shows as a see-through card with its sender's face, over any screen. Cards stack newest first, stay until you pop them, and can be pinned. Drag the stack anywhere; the place is kept per login in this browser. A click opens the chat in the Assistant window.
- **New:** three pop sounds to choose from, and a silent mode.
- The brain needs no change: it works with v0.500.36.

## v0.9.16: person-only controls and clones

- **New:** sidebar Favorites: starred screens and workspace items, in your own order. The tabs are Favorites, Work and Admin.
- **New:** the in-app agent can look at the window, when the agent's model sees images. Secret fields are painted grey first.
- **Changed:** an area screenshot on the web redraws the page, so the browser asks for no screen share.
- **Changed:** the in-app agent cannot press a control only a person may press. This includes Save on a Recall prompt, and the tool forms when approval for agent-built tools is on.
- **Fixed:** selected cards, tag pills and workspace chips keep readable contrast in every theme.
- **Fixed:** a clone of an assistant or a responder keeps its role, one priority below its donor, and starts disabled.
- The contract packages move to 0.500.35. Workspace e2e allows 15 s on both runtimes.

## v0.9.14: the in-app agent, area screenshots and an update notice

- **New:** an in-app agent can read and use this window, when a person turns it on. The window asks once per turn, and Stop ends it. Lessons can drive the window too.
- **New:** area screenshots replace the element picker. A screenshot lands in a workspace as a plain upload.
- **New:** a notice shows before an update, and the window reloads after it.
- **Fixed:** selected rows have readable contrast in every theme. The Desk clock opens analogue for a new desk, and a digital clock never wraps.
- It needs a brain from v0.500.35 for these parts. An older brain answers 404, and they stay hidden.

## v0.9.13: the company sign-in setup screen

- **New:** Settings > Company sign-in, for an Admin user while the box's mode is on. With the mode `setup`, a client's Microsoft admin enters the client secret, sealed and never shown, tests it, and makes the SCIM token, shown once. Any other mode shows the same values read-only.
- It needs a brain with `GET /api/users/sso-setup`. An older brain answers 404, and the entry stays hidden.

## v0.9.12: Desk fixes, Quick task and a theme menu

- **New:** a Quick task Desk widget, the twin of Quick note. The first line is the title and the rest is the body. It shows only for a login that has Tasks.
- **New:** the Desk Theme card picks the theme from a menu, with clean swatches.
- **Fixed:** the tree's view tabs fold to icons when the list is narrow, so they no longer run into each other.
- **Fixed:** the Notes widget shows blank stickies, not dark blocks, while it loads and when it is empty.
- **Fixed:** Desk widgets no longer clip the top focus ring of the first control.

## v0.9.11: a canvas plays its media in the app

- **New:** the contract pins move to 0.500.30, so the canvas frame in Present and in a page answers `mantle.media`. A new e2e test uploads a clip and plays it, in the app and on the open link.

## v0.9.10: the Tables screen imports a file

- **New:** the Tables screen gets an import. An xlsx, xls or csv makes one Table in the switcher's workspace. It shows upload progress and plain words for a refused file.

## v0.9.9: new items land in the switcher's workspace

- **Fixed:** a new task, event, formula, canvas or recall map now lands in the switcher's workspace. Before, it took the fallback home, which is Admin for an Admin user. A duplicated or imported app does too.
- **Fixed:** a refused recall map create shows the brain's words, not the word forbidden.

## v0.9.8: the Status screen

- A Status screen replaces the Dashboard: `/status`, first in the System menu. `/dashboard` redirects to it. It uses the standard master-detail layout: on the left a card per section with health and one number, on the right what needs attention, tiles, compute, brain, spend, queues and workers, sidecars, providers, version, updates and backups.
- Each switchable sidecar links to its card in Settings > Services.
- Memory index bars no longer go red at 98%. The old Dashboard's journal gaps panel is gone.
- It reads `GET /api/box-status`, which comes with brain v0.500.20. Against an older brain it says what it cannot show.

## v0.9.7: company sign-in

- **Added:** when a brain has company sign-in on, the sign-in screen shows
  "Sign in with {label}", first on a browser whose login uses it. Password
  sign-in stays. With it off, nothing changes.
- **Added:** after a password sign-in, an unlinked login sees one card:
  "Sign in with {label} next time." One click links it. "Not now" hides the
  card for 7 days.
- **Added:** Settings > Profile links and removes the link. A login with no
  Profile screen finds the same thing in its account menu.
- **Added:** where the brain requires company sign-in, a login that is not
  linked gets one "Link your company sign-in" step and no other screen until it
  is done, at sign-in and on an invite.
- **Changed:** a linked login confirms a new API key with a new company
  sign-in in place of its password.
- **Added:** the desktop apps run company sign-in in the system browser and take
  it back through `mantle://oidc`. The Tauri app gets its first deep link and
  one instance at a time.

## v0.9.6: a folder's home move takes its contents

- **Added:** when you move a folder to another home, the move dialog
  offers "Also move the N items inside", ticked. The sub-folders and files
  below it with the same home move with it, at any depth. The dialog says
  how many items inside have another home and stay there. A big folder
  moves in several calls of 200 items; the dialog makes them for you. It
  needs a brain with `withContents` on the move (the next brain release):
  an older brain moves the folder alone, as before.

## v0.9.5: new help topics, from the 0.500.13 contract

- **Changed:** the client now uses the brain's 0.500.13 contract packages
  (`@crossworks/share-ui`, `client-types`, `content-core` and
  `voice-client`). Before, it used 0.400.56.
- **Added:** the help that opens from the `?` button has 6 new topics:
  Chats, Workspaces, Shared links, Telegram, Sessions and Changelog. New
  screens, such as `/chats` and `/changelog`, open the right topic. 42
  older topics were brought up to date (brain v0.500.5).

## v0.9.4: the decider shows its failures

- **Added:** the decider worker screen shows the last failure: when, which
  model, and why, and whether it is still failing (brain v0.500.7).
- **Changed:** the Test button sends one small real request, the same way a
  turn does. It only runs when you click it.
- **Fixed:** the privacy and zero-data-retention settings save together.
  The alert banner and card know the decision and model-policy alerts. An
  alert of an unknown kind no longer breaks the banner. Try again shows only
  for embedding and extraction.

## v0.9.3: docs

- **Changed:** the READMEs and docs describe the static UI, the Tauri app
  and Chats as they are now. No code changed.

## v0.9.2: the Tauri app is named MantleOS

- **Changed:** the Tauri desktop app is named MantleOS: the product name,
  the window and alert titles and the keychain notice. On macOS
  `client/tauri/scripts/build.sh` now builds an unsigned `MantleOS.app`
  bundle (tauri-cli 2.12.4, pinned), because macOS takes the menu bar name
  and the Dock icon from the bundle; a bare binary showed `mantle-desktop`
  and no icon. Linux still builds the binary alone. The identifier is
  unchanged, so saved brains and logins stay.

## v0.9.1: repo guidance

- **Docs:** `CLAUDE.md` for this repo: new code must work on Bun and on Node,
  and the public-repo rules for commits. No change to the app.

## v0.9.0: the pair for mantle v0.500.0

- A version bump with no change of its own. v0.9.0 is the client the brain's
  major core update, mantle v0.500.0, was tested with. It carries the
  entries from v0.8.11 to v0.8.18 below.

## v0.8.18: the Tauri desktop shell, first stage

- **Added:** `client/tauri`, the desktop shell rebuilt on Tauri 2. It sits
  beside the Electron app (`client/desktop`) and does not change it. Each
  brain gets its own window with its own WebKit data store. The owner UI's
  static export is served on the app's own scheme, `mantle-ui://localhost`,
  to brain windows only. A small connect window adds a brain and probes it
  before saving. macOS 14 or later.
- **Added:** logins are kept in the OS keychain, and the keychain is the only
  copy. The page reaches them through a synchronous token vault with the
  Electron vault's shape and rules (`window.mantleDesktop.tokenVault`).
- **Added:** with no keychain (on Linux, no Secret Service), a sign-in lasts
  for that run only, held in memory, and a small notice window says so.
- **Fixed** (audit rounds): the navigation handlers only allow or refuse,
  and the main frame is sent back to the UI when it lands anywhere else; the
  shell's own requests check TLS against the OS trust store; `profiles.json`
  keeps the first of two profiles with one id; a window opened while its
  brain is being removed is closed; adding a brain probes it before taking
  the edits lock; logins the keychain would not delete are retried at the
  next start.
- **Tests:** a scripted sign-in test on Linux (two origins of one brain,
  with and without a keychain) in a pinned build image; the host contract
  as one shared table of cases that both hosts run.
- Not in this stage: deep links, notifications and the badge, downloads,
  the tray, updates, signing and installers. `client/tauri/README.md` has
  the list.

## v0.8.17: the UI keeps no cookies

- **Changed:** the UI's own small state (the signed-in presence flag, rail
  widths and collapse, the spend range, the assistant pick, panel layouts)
  lives in localStorage (`ui-prefs` in `packages/web-ui`), not in cookies.
  The brain never read them, and the Tauri app's scheme keeps no cookies at
  all, so there every load went back to `/login`.
- **Changed:** a value an older build left in a cookie moves over on first
  read and keeps its lifetime. The cookie is dropped only once the value is
  stored. A lint rule refuses `document.cookie` in client code outside
  `ui-prefs`.

## v0.8.16: the developer tools on Bun

- **Added:** `pnpm dev:bun`, `build:bun`, `test:bun`, `verify:bun` and
  `e2e:workspace:bun` run the same scripts on the Bun version `.bun-version`
  pins (`scripts/bun.sh`). A `:bun` run fails unless it really runs on that
  Bun. Node stays the default and the required gate; pnpm stays the
  installer.
- **Added:** `compare-export` says whether two static exports are the same
  UI. It ignores the random build id, and a reprinted inline theme script
  from a pinned pair.
- **Added:** the Bun lane in CI (report only): verify on Bun, the export
  built on Node and on Bun and compared, and the workspace specs on
  `next dev` under Bun. Details in `docs/bun-tooling.md`.

## v0.8.15: Present for every login

- **Fixed:** Present is in the rail for every login, as Draw is. A member,
  or a Moderator who is not an Admin user, saw no Present, and a typed
  `/present` said "You cannot manage this part of the brain".

## v0.8.14: Tool loading keeps Map

- **Fixed:** the agent form read every mode but Deferred as Full and never
  sent Full, so a save turned a Map agent into the brain's default. Tool
  loading is now a select: Default (it names the mode the brain picks for
  that role and model), Full, Deferred and Map, with a one-line hint. A
  save sends back exactly what was loaded.
- **Changed:** contract packages 0.400.34 to 0.400.56.

## v0.8.13: a password strength meter

- **Added:** the sign-up, invite, change-password, new-login and reset
  forms show a strength bar and each part of the brain's password rule,
  ticked as you type, and say the first unmet part before you send. The
  brain stays the judge: its list of common passwords is checked on save.
  A brain from before the rule sends none, and the forms keep its 8
  characters.
- **Fixed:** the meter counts symbols as the brain does (an invisible
  character is no symbol), and a screen reader hears its hint while the
  rule loads.

## v0.8.12: static UI follow-ups

- **Changed:** a desktop brain window grants only what the app uses: the
  clipboard, fullscreen, location, notifications, file save, Local Network
  Access (for a brain on a LAN or tailnet address) and the microphone, audio
  only, for a call. `openExternal` is for `mailto:` links only. A sub-frame
  gets nothing.
- **Fixed:** the shared appearance read makes one fetch per brain for
  callers that miss the cache together, stops at 64 KB and has the host's
  own deadline.
- **Fixed:** an upper-case `.HTML` is served as HTML; retired and public
  paths match in any case; a file name Windows reads as another file finds
  nothing.

## v0.8.11: the static UI

- **Changed:** the owner UI (`client/web`) builds to static files, a Next
  static export; no server renders it. A host serves the files and fills in
  the brain: `/env.js` with the brain's origin and public appearance, the
  CSP and the headers. `docs/static-ui-host.md` is the contract every host
  follows. A blocking boot script paints the brain's theme, fonts and
  backgrounds before the page shows, and sends a visitor with no session to
  `/login`.
- **Changed:** the box image serves the static UI with the shared host
  (`client/host`, one small bundled server) on Bun, with no `next start`.
  The box contract is unchanged: port 3000, `MANTLE_SERVER_ORIGIN`, and
  `/env.js` for the healthcheck.
- **Changed:** the Electron shell serves the static UI itself on
  `http://mantle-ui.localhost` in each brain window: no embedded server, no
  second process, no loopback port.
- **Fixed** (audit rounds): the desktop shell passes on only the window's
  own brain on plain http, with no cookies and no redirects, and refuses
  every other http request; both hosts refuse a brain origin that is not a
  plain http(s) origin and send `nosniff`; saved brain addresses are checked
  on every load; the appearance read stays on the brain (no redirect, no
  cookie, JSON under 64 KB); no-referrer covers `/invite` in any spelling;
  item screens open on a cold deep link.

## v0.8.10: dependencies

- **Changed:** contract packages 0.400.34, zod 4.6.7, KaTeX 0.19.1, and
  minor and patch updates.

## v0.8.9: the sounds save names its login

- **Fixed:** the sounds save sends the login it was made as (`loginId`), as
  the Desk's save does, so a tab now signed in as someone else no longer
  writes to the wrong login.

## v0.8.8: the list in focus mode

- **Fixed:** a list beside a detail pane stays collapsed in focus mode and
  comes back at its own width.
- **Tests:** the split e2e suite follows the item header, served links and
  data-only shares.

## v0.8.7: sounds for app events

- **Added:** the sound palette plays for real events: a mention, a question
  or tool call waiting, a decision, a commit (a warning on a conflict), a
  blocked microphone or speaker, a call that fails to join, a watched run
  ending, a provider outage, an upload batch done.
- **Added:** every save or commit a person clicks plays success once it went
  through, or danger when refused; autosaves stay quiet. The Activity column
  sounds when an item starts (a new start sound) and when it ends. One event sounds once, across
  tabs.

## v0.8.6: UI sounds and a person's description

- **Added:** a palette of 14 short sounds made live in the browser (no audio
  files), with a switch, a volume and a play button for each in Settings >
  Profile > Sounds. The choice is saved on the login, so it follows the
  person; a brain without the route keeps it in this browser. Calls get a
  ringback, a join and a hang-up sound.
- **Added:** a person's description (a job title, a role, a relationship)
  shows under their name in the new-chat picker, the add-people list and
  the chat details, and the picker's search matches it. A login sets its
  own on the Profile screen (or from the account menu); an admin sets
  anyone's on the Users screen.
- **Fixed:** an open row in the chat list is readable (a soft tint and a
  ring, not the full accent fill); the Admin scope in the nav shows the
  admin features only; the rail's version footer is one line, client and
  brain.

## v0.8.5: print options for a PDF

- **Added:** a print options panel under Download for the PDF of a page or
  a drawing: paper, orientation, margins (one value or each side), a header
  and a footer line, page numbers. The last options used are kept in this
  browser, with Reset. A brain older than the documents release ignores
  them. Details in `docs/export.md`.

## v0.8.4: Chats and calls

- **Added:** Chats (`/chats`), the window of the brain's messenger: direct
  chats and groups between the logins of one brain, with the login's
  assistant threads in the same list. Live delivery, read ticks, typing,
  edits, deletes, reactions and @mentions; a details inspector (rename,
  people, mute, pin, leave, clear, delete history); a New message form in
  the chat pane with a filter (All, People, Agents, Groups); a group's icon,
  colour and info text. The Chats entry shows the unread count, a new
  message in another chat shows a toast, and the desktop app shows the OS
  notice and the badge. A line sent through a credential shows "via"
  and its label. Details in `docs/messenger-chats.md`.
- **Added:** voice calls in a chat, over LiveKit, when the brain has calls
  on. Call sits in the chat header; the other people get a ring card with
  Answer and Decline for 45 seconds; a call dock stays through route
  changes (who is in, Mute, Open chat, Leave), and a group's admin can end
  the call or drop a person. The transcript shows the call's lines. The
  desktop app grants the microphone, audio only, to the app's own page.
  Details in `docs/messenger-calls.md`.
- **Changed:** both chat composers are one box with one action row inside
  it, Send at the right end.

## v0.8.3: the Desk follows the person

- **Changed:** the built-in home screen is called Desk. Its layout is saved
  on the login's profile, so it follows the person to another browser,
  machine or the desktop app. When another device saved first, its desk
  shows with one quiet toast. A brain without the route keeps the desk in
  this browser, per brain and login.
- **Added:** a tree can be put in a custom order, the same for everyone:
  drag items and folders into place, or use Move up and Move down in the
  item menu. It needs Write on the folder and a brain that offers it.
- **Added:** under a traced P&ID canvas in Present, a folded panel with the
  circuit's image checks: the counts, each answer, the reason and the
  crops, and the note that image checks are no guarantee, so verify on the
  drawing.
- **Changed:** health shows a Parser pill and readiness row in place of
  Tika; the Media pill and line are gone. A brain older than the parser
  keeps its Tika pill.
- **Changed:** contract packages 0.400.14.

## v0.8.2: the Desk audit

- **Fixed:** the Desk's audit round: Notes no longer opens empty after Home,
  opening Customize no longer flips the desk to the phone layout, a carried
  widget stays under the pointer while the desk scrolls, and growing a
  widget by its right edge no longer slides it left.

## v0.8.1: Home is a desk

- **Added:** Home is a grid you arrange like a real desk: widgets and
  pinned items are dragged anywhere, resized by the corner and kept where
  you put them; nothing tidies itself until Tidy up. Widgets for the workspace's
  items (pins first, then the newest), notes as sticky notes, tasks ticked
  done from the desk. Tools: a clock, a calendar, a quick note, the theme, a
  live Drift window, a focus timer. Customize sets what shows. Phones stack
  the widgets.

## v0.8.0: Present

- **Added:** Present, a workspace of HTML canvases that agents write:
  `/present` on the standard folder view, each canvas live in its sandbox
  under the standard item header (Full screen, Replay, Source, Access,
  Info, Delete).
- **Added:** a page can embed a canvas. It shows the snapshot, and a click
  opens the live canvas over the page; Esc goes back.
- **Changed:** every surface paints Drift, from the brain's published
  engine; Neat is gone. Sign-in and invite show it in full colour, the app
  a subtle version.
- **Changed:** contract packages 0.400.0.

## v0.7.24: the Peers screen

- **Changed:** a linked brain's detail is in sections: Connection (an On
  switch, both directions at a glance, both addresses), Pairing tokens (one
  card each, saying who makes it and who uses it), and what it can reach
  here, with every risky tool of the brain as its own switch.

## v0.7.23: connector options from the brain

- **Changed:** a workspace's Add connector list comes from the brain, MCP
  and API alike, each labelled; a connector the workspace holds is not
  offered. An older brain falls back to its MCP connectors.

## v0.7.22: one item header

- **Changed:** every workspace item opens under one header row with fixed
  slots (More, Edit, Delete, Focus, Info, Access). A slot you may not use
  is greyed, never removed, so nothing moves. Every item has its own
  address.
- **Changed:** Recall's Cards view is three resizable columns: the cards,
  the text and an inspector.
- **Changed:** the workspace switcher sits under the login, boxed.

## v0.7.21: the MantleOS theme

- **Changed:** share-ui 0.239.36 to 0.300.127. The default theme is
  labelled MantleOS; Jackdaw Harvest is gone, and a saved choice of it
  falls back to MantleOS.

## v0.7.20: the repo is mantle-client

- **Changed:** the repo was renamed from `jackdaw` to `mantle-client`. The
  desktop update feed asks the new name; apps installed before reach it
  through GitHub's redirect.

## v0.7.19: one brand, MantleOS

- **Changed:** Jackdaw and Mantle become one brand, MantleOS, and this
  client is MantleOS Desktop. The MantleOS icon and wordmark replace the
  Jackdaw marks on sign-in, the rail, the mobile bar and the desktop icons.
- **Added:** Drift, an animated background engine of our own to replace
  Neat (WebGL, five styles, still when off-screen, hidden or with reduced
  motion).

## v0.7.18: a snapshot copy says so

- **Fixed:** a snapshot copy's Code and History tabs say it is a copy.

## v0.7.17: the agent editor's tabs

- **Changed:** the agent editor's Behaviour tab splits into Tool groups,
  Skills and Delegation; the system prompt moves to the end of General.

## v0.7.16: refusals that say why

- **Fixed:** a bulk delete says each refusal in its own words, and a
  cascade says what it kept; a refused folder indexing change says why.
- **Changed:** saving, discarding, previewing or committing an app's code
  needs the app's manage right. On the Admin workspace the Moderator switch
  is on and fixed, and Add user there needs the Users area.

## v0.7.15: pending approvals

- **Fixed:** Approve is hidden on an elevated call that names no asker.

## v0.7.14 and v0.7.13: the release script

- **Changed:** `scripts/tag-release.sh` runs the verify before it tags,
  reads HEAD once and refuses when it moved, and asks origin whether the
  push landed. Its tests run in `pnpm verify`. No change to the app.

## v0.7.12: the reason on an elevated call

- **Added:** the pending card shows an elevated call's reason as a badge,
  warns when the asking turn read text a client wrote, and hides Approve
  from the call's own asker (the owner may always approve).

## v0.7.11: contract types

- **Changed:** the workspace search types come from `client-types`
  0.300.63.

## v0.7.10: an Anthropic workspace id on a key

- **Added:** an optional Anthropic workspace id on an Anthropic key, shown
  when the brain stores one. A workspace alert points to Settings > Keys.
- **Changed:** a direct model in the agent form shows its context window
  from the provider's own list.

## v0.7.9: search across workspaces

- **Added:** search finds items in every workspace you can read, tags a hit
  from another workspace, and switches and opens it in one step. An empty
  folder says where its items are.

## v0.7.8: model lists with the picked key

- **Fixed:** the model picker lists the models of the key you picked, and
  the agent form and the models page say why a list is empty.

## v0.7.7: the assistant's chat header

- **Changed:** the chat header is one row of icon buttons with tooltips;
  the agent picker shows the name only.

## v0.7.6: the share panel in columns

- **Changed:** "Who can see this" lists each workspace in aligned columns:
  its tile, a Home radio, a Writable switch and Revoke. A control you cannot
  use stays in place, dimmed, with the reason as its tooltip and for screen
  readers.
- **Changed:** the workspace screen shows Users and Connectors in labelled
  columns; Moderator and Writable are switches.

## v0.7.5: Moderator is set by Admin users

- **Changed:** only Admin users turn Moderator on or off, and only they
  remove another Moderator. Team is a normal workspace.

## v0.7.4: workspace colours and icons

- **Added:** a workspace has a colour and an icon, drawn in the switcher,
  the workspace list and the screen header. The users list is aligned, and
  the tree marks what is shared.

## v0.7.3: tags in the current workspace

- **Fixed:** the tag menu counts in the workspace the switcher picked.

## v0.7.2: Home is the workspace's landing page

- **Changed:** `/` shows the landing page of the current workspace: its
  home app, or the built-in home with that workspace's items. A Moderator
  picks it on the workspace screen. The brain health Dashboard moves to
  `/dashboard`, first in the System menu.

## v0.7.1: the workspace switch

- **Fixed:** a pick made in another tab wins over a held one, and a pick
  the browser's storage refuses still switches.

## v0.7.0: no client login, no email code

- **Removed:** the client login, sign-in by email code and access levels,
  as on the brain. Sign-in is the password form only.
- **Changed:** contract packages 0.300.0.
