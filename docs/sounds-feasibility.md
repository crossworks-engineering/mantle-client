# Sounds: feasibility and recommendation (2026-10-29)

**Verdict: feasible, and it belongs in the frontend.** Sound is played by the
device in front of the person, so the engine, the palette and the event wiring
all live in mantle-client (`client/web`). The brain needs one small piece: a
per-login preference so the on/off choice follows the person between browsers
and devices. That piece is now built (mantle branch `feat/profile-sounds`), and
the client falls back to the browser's copy on a brain without it.

## Where it belongs

- **Engine and palette: mantle-client.** `client/web/lib/sounds/` (recipes,
  `play(kind)`, preference store). It has no React or Next dependency, so it can
  move to `packages/web-ui` later if another surface needs it.
- **Events: mantle-client.** Every event worth a sound already reaches the
  client: the messenger stream, the call ringer, the assistant turn stream, the
  realtime stream (`pending_tool_call`, `run`, `task`, provider alerts). The
  brain does not need to emit anything new.
- **The preference: the brain.** `PUT /api/profile` validates with
  `z.object`, which strips unknown keys, so the sound choice has its own route,
  like `navFavorites`:

  - mantle `feat/profile-sounds`: `GET/PUT /api/profile/sounds`
    (`{ sounds: { enabled, volume } }`, `null` until first saved), a personal
    `sounds` field on `ProfilePreferences` (`SoundPreference` in
    `@mantle/client-types`), and `projectSounds` (volume clamped to 0..1). Open
    to every login, the same policy as the Desk.
  - mantle-client: `lib/sounds/sync.ts`. The app shell pulls the brain's copy
    once per page load. The Sounds settings push after each change. The browser
    keeps the last copy seen (`localStorage` `mantle_sounds_v1`), so a sound can
    play before the brain answers. On a brain without the route (404) it stays
    browser-only and sends nothing more for that visit.

  Last write wins: it is one person's switch. A per-device override, so a laptop
  can stay quiet while the phone rings, is not built. Add it if it is missed.

## Platform rules

- **Autoplay.** A browser keeps an `AudioContext` suspended until the page has
  had a click or key press. The app shell calls `installSoundUnlock()`, which
  creates or resumes the context on the first gesture anywhere. A sound asked
  for before that is dropped, not queued, so a chime never plays a minute late
  on the next click. This affects only a tab nobody has clicked in since it loaded.
- **Background tabs.** Once running, a context keeps playing in a hidden tab
  (Chrome, Safari, Firefox). Notes are scheduled on the audio clock, so timer
  throttling in hidden tabs does not smear them. A hidden *browser* tab gives up
  its messenger stream (`liveStreamWanted`), so it hears no chat chime until it
  is shown again. That is existing behaviour, not something sound changes.
- **Desktop (Electron).** The same code runs in the desktop window. When the
  window is hidden, messenger and call notices go to the OS (`shell.notify`), and
  macOS or Windows plays its own notification sound, so the in-app chime is
  skipped on that route to avoid a double sound. Electron could set
  `autoplayPolicy: 'no-user-gesture-required'` in `webPreferences` so the
  desktop app chimes even before the first click. That is a one-line change,
  left for later.
- **Mobile (mantle-mobile, out of scope).** The palette is data
  (`SOUND_RECIPES`: notes, durations, gains, waveforms). Two ways to share it:
  1. Render each recipe to a short `.wav` with an `OfflineAudioContext`, or with a
     small Node script that uses the same envelope maths, and ship the files as
     Flutter assets. The tones match exactly, and phones play short assets
     cheaply.
  2. Synthesise in Dart from the same JSON. This is more code for no real gain.

  Option 1 is the better choice. Push notifications on the phone would use the
  same `.wav` as their custom notification sound, so the family carries across
  devices.

## Why synthesis, not audio files

- **Size:** the whole engine plus all 15 sounds is about **5 KB minified**. No
  assets, no fetch, no CSP or caching concerns.
- **One family by construction:** every sound uses one scale (A major
  pentatonic, E5 to C#7), sine or triangle only, one envelope (6 ms attack,
  exponential fade), one shared room (a soft, darkened 110 ms echo), and a
  compressor so overlapping sounds never clip.
- **Easy to tune:** a sound is a few lines of data. Volume is a multiplier, not
  a re-export.
- **When files would win:** for rich, recorded or designed sounds (foley, voice,
  long musical stingers), or for platforms without Web Audio. Neither applies to
  the web app. Mobile gets files rendered *from* these recipes (above).

## The palette

| Sound | Length | Shape | Used for |
| --- | --- | --- | --- |
| success | 330 ms | E6 then A6, a fourth up, bell | something you did worked |
| warning | 320 ms | F#5 twice, triangle | mic or speaker blocked, a limit near |
| danger | 370 ms | E5 then C#5, minor third down, triangle | **assistant turn failed (wired)**, action refused |
| notification | 360 ms | one E6 bell | a general notice |
| commit | 230 ms | A6 gliding to C#6 over a low A4 body | page or table committed, draft kept |
| action | 50 ms | one A6 tick | small confirm: approved, moved, toggled |
| attention | 700 ms | A5, E6, A6 rising, held bell | a tool call waits for approval |
| message | 260 ms | B5 then E6, quick bubble | **new chat line (wired)** |
| mention | 330 ms | A6 then C#7, bright bell taps | someone names you |
| reply | 380 ms | C#6 settling to A5 | **assistant finished its reply (wired)** |
| complete | 395 ms | A5, C#6, E6, A6 arpeggio | task, run or export done |
| ring | 990 ms | two E6/A6 bell pairs, repeated every 2.5 s | **incoming call (wired)** |
| ringback | 900 ms | one low E5/A5 dyad, no bell, repeated every 3 s | **your call ringing the other side (wired)** |
| join | 320 ms | A5 then E6, a fifth up | **call answered, someone came in (wired)** |
| leave | 360 ms | A5 then E5, down, quieter | **hung up, someone left, call ended (wired)** |

All except attention, ring and ringback are under 400 ms. `sounds.test.ts` enforces the
lengths and caps every note's level at 0.2.

## Events in the app, and where to hook them

Wired in this prototype:

- **Chat message received:** `messenger-shell.tsx` `pop`, on the in-app toast
  route only (the OS notice route has its own sound) → `message`.
- **Incoming call ring:** `lib/calls/ring-tone.ts` now plays the palette's
  `ring` through `play()`, so the mute switch silences it too. Before this
  change it had its own `AudioContext` and two plain beeps.
- **Assistant reply finished / failed:** `use-turn-stream.ts` on the `done` and
  `error` events → `reply` / `danger`.
- **Calling out, answered, hang-up:** `components/calls/call-sounds.tsx`,
  mounted by the messenger shell, reads the call state's changes. `ringback`
  plays while a call I started waits alone in the room (for at most the ring's
  45 s, and never again once anyone has answered). `join` plays when someone
  comes in, and `leave` when someone goes or the call ends for me.

Found, not wired (each is a one-line `play()` at a place that already exists):

- **Mention:** the messenger has mention nodes. A `shouldPop` that knows the
  line names me → `mention` instead of `message`.
- **Tool call waiting for approval:** `pending_tool_call` realtime event
  (`use-pending-questions.ts`, `sidebar-nav.tsx`) → `attention`.
- **Mic or speaker blocked:** call `mic_blocked` / `audio_blocked` → `warning`.
- **Run or task finished:** `active-runs-strip.tsx` (`run`), `tasks-client.tsx`
  (`task`) → `complete`, only for runs or tasks the login started.
- **Provider alert (a model provider failing):** `use-provider-alerts.ts` →
  `danger`.
- **Page or table commit:** the commit actions → `commit`.
- **Export ready:** the export download → `complete`.
- **Upload done or failed:** the upload dock → `success` / `danger`.
- **Toasts in general:** deliberately *not* wired. Sounding every
  `toast.success` would be noise. Sound should follow events the person is
  waiting on, not every confirmation.

## Rules the module keeps

- One `play(kind)` API with a global mute. `force: true` (the preview buttons)
  plays even when muted, because the click is the request.
- The same sound twice within 120 ms plays once, so a burst of chat lines is
  one chime.
- Best effort: no Web Audio, a closed context or a thrown error is silent,
  never an error.

## How to listen

- **In the app:** Settings → Profile, the new *Sounds* section at the bottom
  (switch, volume, a play button per sound, *Play all*).
- **Without a brain:** the published page "MantleOS Sound Palette"
  (https://claude.ai/artifact/P98gVm2zSrQr8Muovq7XWe), built from the same
  `lib/sounds` code with esbuild. Each row shows its notes to scale.

## Next steps

1. Land mantle `feat/profile-sounds` (its database sweeps run on CI or the
   workstation), release it, then bump `@mantle/client-types` here when the
   client wants the shared `SoundPreference` type. The client keeps its own copy
   of the type until then.
2. Wire the "found, not wired" events above, in this order: approval waiting,
   mention, run or task done.
3. Electron `autoplayPolicy` for the desktop window.
4. Render the recipes to `.wav` for mantle-mobile.
