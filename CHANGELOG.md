# Changelog

All notable changes to this project are documented here. Format based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project follows
[Semantic Versioning](https://semver.org/) — see [docs/releasing.md](docs/releasing.md) for
the release process itself.

## [Unreleased]

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
