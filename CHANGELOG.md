# Changelog

All notable changes to this project are documented here. Format based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project follows
[Semantic Versioning](https://semver.org/) — see [docs/releasing.md](docs/releasing.md) for
the release process itself.

## [Unreleased]

## [0.3.0] - 2026-10-02

### Added
- Long-press a nick for a menu: the stream they're watching (with its color bar, tap to open
  it on strims.gg), Mention, Whisper, Highlight messages, Set name color, and Ignore. Ignored
  users' messages are hidden; they're listed in Settings, tap to unignore.
- Message timestamps, with a Settings choice of Off / `HH:MM` / `HH:MM:SS` (default `HH:MM`).
- Connection status: "Reconnecting…" after 5s without a connection, "Disconnected" with a
  Retry button after 15s (automatic retrying stops there), and a small green dot next to
  "Chat" while connected.
- Settings → "Animate emotes forever". Off by default: emotes play chat-gui's loop count and
  rest on their last frame, as on desktop.

### Changed
- Android: animated emotes are encoded once into animated WebP and played natively, instead
  of stepping frames from JS. Chat with animated emotes on screen went from keeping a CPU core
  busy (~55-77% in a release build) to ~7%.
- Chat rows only re-render when their own content changes, not on every new message.

### Fixed
- The Android back button always closed the app. It now closes Settings, then returns to the
  Chat tab, then exits.
- Leaving Settings rebuilt the chat (reconnect, history reload, jump to bottom). Chat now stays
  loaded underneath Settings.
- Auto-scroll could switch itself off without any touch (e.g. after switching tabs) and landed
  ~40px short of the newest message. It now only stops following when you drag, and scrolls to
  the exact end. Rows you're reading no longer drift as old messages are trimmed.
- On reopen, a failed history fetch was never retried, leaving the previous session's
  scrollback on screen. History now retries with backoff, is merged with live messages instead
  of replacing them, and a "History may be out of date ↻ Reload" note shows while it's stale.
- `/w nick message` (and chat-gui's other whisper aliases) was posted to public chat. It's now
  sent as a whisper.
- Animated emotes went blank after a chat-gui deploy changed asset URLs; a 404 now refetches
  the emote index once.

## [0.2.0] - 2026-08-24

### Added
- Daily update check: a tappable "update available" badge next to the title bar links to a
  modal with the release notes and downloads/installs the new APK directly.
- Emote picker button next to Send: sorted by the user's own lifetime usage (persisted) then
  by frequency in the current 200-message chat window, 5 rows visible with the rest reachable
  by scrolling. Picking an emote inserts it at the cursor, or sends immediately if the input
  is empty. The button itself previews the user's top emote, backed by a bundled LUL icon so
  it has something to show before the network-loaded emote index resolves.
- Streams tab: AngelThump cards now show "live for Xd Yh"/"Xh Ym"/"Xm" next to the watching
  count. Thumbnails expire after 30 minutes so a card doesn't keep showing a stale frame.
- First-time setup popup: fresh installs (no cached emote index yet) get a call-out that the
  first connect is slower than normal, cleared for good once the first catch-up completes.
- The last 200 chat messages are now cached to disk and repainted immediately on cold start,
  and the websocket now connects in parallel with the REST catch-up instead of waiting for it
  to finish first — catch-up alone could take several seconds. Together these make a cold
  start feel close to instant instead of showing a blank "Connecting…" screen the whole time.

### Fixed
- Emote typeahead now requires 3+ typed characters (was 1), and its suggestion bar renders
  animated emotes correctly cropped instead of the raw spritesheet.
- Cropped emote frames were being written to Android's OS-reclaimable cache dir and trusted
  forever once persisted — a cache sweep silently broke every animated emote until it
  re-fetched and re-cropped from scratch. Frames now move to permanent app storage right
  after cropping.
- Chat autoscroll ("More messages" pill, and the keyboard opening) had a race where a
  scrollToEnd's own follow-up scroll events could immediately re-freeze it right after
  resuming (or, after the caching change above, leave a freshly cold-started chat short of
  the bottom with no pill to recover with); all scrollToEnd calls now share one guarded path.

## [0.1.2] - 2026-08-23

### Added
- Casting a stream now shows a "Cast from" region picker (SFO/AMS/FRA/NYC/SGP) instead of
  always using AngelThump's default-routed edge server.

## [0.1.1] - 2026-08-23

### Fixed
- Animated emotes were re-downloading their full source spritesheet once per frame (up to
  158 times for a single emote occurrence) due to `@react-native-community/image-editor`'s
  native crop implementation having no request caching — a significant, avoidable source of
  data usage. Fixed by fetching each spritesheet exactly once and cropping every frame from
  that local copy.
- Cropped emote frames are now cached to disk (not just in memory), so they also survive app
  restarts instead of being re-fetched-and-cropped on every cold start.

### Changed
- Emote index and cropped-frame caches no longer expire automatically (previously a 24h TTL)
  — refreshing now only happens via the new "Refresh emotes" button in Settings, which also
  shows when the index was last updated.

## [0.1.0] - 2026-08-23

First tagged release.

### Added
- Chat tab: Twitch OAuth login (in-app WebView), REST catch-up + websocket sync, chat-gui
  emote rendering (including animated spritesheet emotes and a subset of chat-gui's emote
  modifiers), URL rewriting matching chat-gui's `UrlFormatter`, per-viewer nick coloring,
  custom nick colors, tap-to-focus, mention highlighting, message combos.
- Streams tab: Rustla2 stream list with follow/notify, viewer-color-matched channel names,
  Chromecast support for AngelThump streams.
- Settings screen (logout, app version), title bar.
- Background-fetch-driven live-stream notifications (~15min interval) while backgrounded or
  terminated; chat socket and streams poll now properly pause while backgrounded.
- CI: build verification for iOS on every push (`.github/workflows/ios-build.yml`).

### Fixed
- Chat reconnect storm caused by a reversed ping/pong protocol implementation.
- Logout not actually logging out (stale WebView cookies re-authenticating silently).
- Login screen's status bar overlap.
- Animated emotes: proper per-frame duration/iteration parsing (several emotes were
  previously undetected due to decimal-second CSS durations), synced shared playback for
  looping emotes vs. independent per-instance playback for one-shot emotes.
