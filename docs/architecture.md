# Architecture

## Top level

`App.tsx` owns three pieces of top-level state: the logged-in `jwt` (persisted via
`src/storage/session.ts`, backed by `react-native-keychain`), the active tab (`chat` | `streams`),
and whether the Settings screen is showing. `ChatScreen` and `StreamsScreen` are both mounted for
the lifetime of the logged-in session — switching tabs or opening Settings only toggles
`display: 'none'` on their wrapping `View`, it never unmounts them. This is deliberate: unmounting
`ChatScreen` used to tear down its websocket and force a full REST catch-up + reconnect (and a
forced scroll-to-end) each time you came back to Chat, which was slow and visually jarring.
Settings itself is conditionally rendered on top since it has no state worth preserving.

`App.tsx` also owns `nowPlaying`, the stream picked on the Streams tab. `StreamPlayer`
(`src/components/StreamPlayer.tsx`) renders it in a 16:9 box above `ChatScreen`: AngelThump via
`react-native-video` (native HLS, URL from `hlsResolver.ts`), Twitch via its embed player in a
WebView served as `https://strims.gg` (the embed's required `parent`). Other services still open
strims.gg in the browser. When the window is wider than tall, the player fills the screen and the
title bar, tabs and chat are hidden (chat with `display: 'none'`, same reason as above).

Navigation is plain state, so `App.tsx` maps Android's hardware back onto it: close Settings, else
return to the Chat tab, else close the playing stream, else let the app exit. Modals handle back via `onRequestClose`. On iOS,
`App.tsx` also gates the JS emote clock (`setEmoteAnimationsActive` in `src/chat/emoteClock.ts`) to
only run while the app is foregrounded and Chat is the visible screen; Android emotes are played
natively (see emotes.md) and need no gate.

## `src/chat` — the Chat tab

- **`source.ts`** (`ChatSource`) — the websocket client. Owns connect/reconnect/backoff (with
  `cancelRetries`/`stopRetrying`/`reconnect` for `useChat`; disconnected while backgrounded),
  and frame parsing via `frame.ts` (chat.strims.gg's `EVENTNAME {json}` wire format). Emits events
  through `emitter.ts`, a small typed event emitter.
- **`api.ts`** — REST catch-up: `/api/chat/history`, `/api/chat/me`, `/api/chat/viewer-states`
  (15s timeout each). Called on initial mount, on every websocket reconnect, and on app
  foreground. `useChat` fetches them independently: `/me` and viewer states are best-effort,
  history retries with backoff (2s…30s) until it lands, and is merged with live messages by
  timestamp (`history.ts` `mergeHistory`) instead of replacing them.
- **`commands.ts`** — client-side command parsing; `/w` and its chat-gui aliases are sent as
  `PRIVMSG` whispers.
- **`useChat.ts`** — the hook `ChatScreen` consumes. Merges REST catch-up with live websocket
  events into `messages`/`me`/`viewerStates`, and handles the two known Android-specific races
  documented inline: duplicate `AppState` `'active'` events firing for a single foreground, and
  overlapping catch-up requests resolving out of order (guarded with a monotonic request ID so a
  stale response can't clobber a fresher one). Also tracks the whole outage as a
  `ConnectionPhase` (`open` | `connecting` | `reconnecting` after 5s | `disconnected` after 15s),
  which drives `ChatScreen`'s banner and the tab bar's connected dot. At 15s it stops scheduling
  redials (an in-flight handshake may still finish) until the banner's Retry calls `reconnect()`.
- **`messageFormat.ts`** — turns a raw message string into typed segments (`text` | `link` |
  `emote`), porting chat-gui's `UrlFormatter` link-rewrite rules (strims.gg/youtube/twitch/etc
  short-form display, tracking-param stripping) and emote-with-modifier parsing (`NAME:modifier`).
- **`emotes.ts`**, **`emoteWebp.ts`** (Android), **`emoteFrames.ts`** (iOS),
  **`emoteModifiers.ts`** — see [emotes.md](emotes.md). User settings (animate-forever, timestamp
  format) live in `src/storage/preferences.ts` (`usePreference`/`setPreference`).
- **`combo.ts`** — collapses consecutive identical single-emote messages into an "xN" combo row,
  matching chat-gui's `chat.js` combo behavior.
- **`viewerColor.ts`** — deterministic per-channel color (FNV-1a hash seeded RNG), ported from
  chat-gui's `viewerstate.ts` so a viewer's nick-bar color in chat matches the color their channel
  name is shown in on the Streams tab (`StreamsScreen` imports this directly).
- **`nickColors.ts`** — per-user custom nick color overrides (long-press a nick), persisted to
  AsyncStorage.
- **`autocomplete.ts`** — `@mention` / `:emote` autocomplete suggestions for the compose box.

## `src/streams` — the Streams tab

- **`api.ts`** — fetches the aggregated stream list (Rustla2's API).
- **`follows.ts`** — follow/unfollow state, persisted to AsyncStorage, keyed by
  `${service}/${channel}`.
- **`notifications.ts`** — Notifee local notifications for followed channels going live; polling
  cadence matches strims-live-extension's `Background.js` (2 minutes).
- **`hlsResolver.ts`** — resolves an AngelThump channel to a playable HLS playlist, for both the
  in-app player and Chromecast. AngelThump's master HLS manifest is served without CORS headers,
  which blocks the Cast receiver from fetching it directly; this does the token/manifest dance
  in-app and resolves through to a CORS-clean playlist URL, optionally on a chosen regional server
  (`sfo1`, `ams1`, …), whose playlists list that server's own segment URLs.
- **`cast.tsx`** — `CastProvider` (wrapped around the app) owns the Cast session so the Streams list
  and the player share it: region picker, connect-then-load, and which stream is casting. It sets
  `hlsVideoSegmentFormat: 'FMP4'` on the `MediaInfo` — without that hint the (CMAF/fMP4) stream
  acknowledges `loadMedia()` but never actually starts playing (`playerState` stays `null`
  indefinitely).
- **`useWatchingStream.ts`** — while a stream is playing, keeps the same Rustla2 websocket
  (`wss://strims.gg/ws`) the site's stream page does open and sends `setStream`, so the user's
  viewer state in chat and the stream's rustler count reflect it, exactly as when watching on
  strims.gg. Closing the player closes the socket, which clears both.

## Native modules

| Module | Used for |
| --- | --- |
| `react-native-keychain` | session JWT storage |
| `react-native-webview` | OAuth login flow (`src/auth/LoginScreen.tsx`), Twitch embed player |
| `react-native-video` | in-app AngelThump playback |
| `react-native-keyboard-controller` (+ `react-native-reanimated`, `react-native-worklets`) | keyboard-synced chat layout |
| `@preeternal/react-native-cookie-manager` | extracting the `jwt` cookie after WebView login |
| `@react-native-async-storage/async-storage` | emote index cache, nick colors, follows |
| `@react-native-community/image-editor` | iOS: cropping animated-emote spritesheet frames (see emotes.md) |
| `com.facebook.fresco:animated-webp` / `webpsupport` (Gradle) | Android: native animated-emote playback |
| `react-native-google-cast` | Chromecast |
| `@notifee/react-native` | local "stream went live" notifications |

See [gotchas.md](gotchas.md) before touching any of the above on Android — several have
non-obvious build/runtime pitfalls that cost real debugging time to work out.
