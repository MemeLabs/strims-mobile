# Architecture

## Top level

`App.tsx` owns three pieces of top-level state: the logged-in `jwt` (persisted via
`src/storage/session.ts`, backed by `react-native-keychain`), the active tab (`chat` | `streams`),
and whether the Settings screen is showing. `ChatScreen` and `StreamsScreen` are both mounted for
the lifetime of the logged-in session — switching tabs only toggles `display: 'none'` on their
wrapping `View`, it never unmounts them. This is deliberate: unmounting `ChatScreen` on every tab
swap used to tear down its websocket and force a full REST catch-up + reconnect each time you came
back to Chat, which was slow and visually jarring. Settings is a real overlay (conditionally
rendered, not display-toggled) since it has no state worth preserving across visits.

## `src/chat` — the Chat tab

- **`source.ts`** (`ChatSource`) — the websocket client. Owns connect/reconnect/backoff, heartbeat
  pause/resume (paused while the app is backgrounded, resumed on foreground — see `useChat.ts`),
  and frame parsing via `frame.ts` (chat.strims.gg's `EVENTNAME {json}` wire format). Emits events
  through `emitter.ts`, a small typed event emitter.
- **`api.ts`** — REST catch-up: `/api/chat/history`, `/api/chat/me`, `/api/chat/viewer-states`.
  Called on initial mount, on every websocket reconnect, and on app foreground.
- **`useChat.ts`** — the hook `ChatScreen` consumes. Merges REST catch-up with live websocket
  events into `messages`/`me`/`viewerStates`, and handles the two known Android-specific races
  documented inline: duplicate `AppState` `'active'` events firing for a single foreground, and
  overlapping catch-up requests resolving out of order (guarded with a monotonic request ID so a
  stale response can't clobber a fresher one).
- **`messageFormat.ts`** — turns a raw message string into typed segments (`text` | `link` |
  `emote`), porting chat-gui's `UrlFormatter` link-rewrite rules (strims.gg/youtube/twitch/etc
  short-form display, tracking-param stripping) and emote-with-modifier parsing (`NAME:modifier`).
- **`emotes.ts`**, **`emoteFrames.ts`**, **`emoteModifiers.ts`** — see
  [emotes.md](emotes.md).
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
- **`hlsResolver.ts`** — AngelThump-specific Chromecast support. AngelThump's master HLS manifest
  is served without CORS headers, which blocks the Cast receiver from fetching it directly; this
  does the token/manifest dance server-side-equivalent in-app and resolves through to a
  CORS-clean edge URL that `react-native-google-cast` can actually load. `StreamsScreen` also sets
  `hlsVideoSegmentFormat: 'FMP4'` on the `MediaInfo` — without that hint the (CMAF/fMP4) stream
  acknowledges `loadMedia()` but never actually starts playing (`playerState` stays `null`
  indefinitely).

## Native modules

| Module | Used for |
| --- | --- |
| `react-native-keychain` | session JWT storage |
| `react-native-webview` | OAuth login flow (`src/auth/LoginScreen.tsx`) |
| `@preeternal/react-native-cookie-manager` | extracting the `jwt` cookie after WebView login |
| `@react-native-async-storage/async-storage` | emote index cache, nick colors, follows |
| `@react-native-community/image-editor` | cropping animated-emote spritesheet frames (see emotes.md) |
| `react-native-google-cast` | Chromecast |
| `@notifee/react-native` | local "stream went live" notifications |

See [gotchas.md](gotchas.md) before touching any of the above on Android — several have
non-obvious build/runtime pitfalls that cost real debugging time to work out.
