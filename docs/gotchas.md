# Gotchas

Non-obvious pitfalls hit during development — mostly Android/RN-specific, mostly costly to
re-discover, so read this before touching the related area.

## `newArchEnabled` in `android/gradle.properties` is not a no-op for third-party libraries

RN 0.82+ always runs Fabric/New Architecture regardless of this flag — it's a legacy no-op as far
as RN core is concerned. **However**, some third-party native modules' own `android/build.gradle`
still gate their own codegen plugin behind it, e.g.:

```groovy
if (isNewArchitectureEnabled()) {   // reads rootProject.getProperty("newArchEnabled")
    apply plugin: "com.facebook.react"
}
```

If this flag is `false`, that module's `generateCodegenArtifactsFromSchema` Gradle task never
gets registered at all, its `android/build/generated/source/codegen` directory never gets
populated, and the app build fails with a C++ `fatal error: 'XSpec.h' file not found` — a
confusing error, since it looks like a codegen bug in the *app's* build, not a config flag from
months-old Cast debugging. Keep this flag `true` unless you have a specific reason to flip it, and
if you do, expect to re-audit every third-party native dependency.

If you do flip it and hit stale-codegen errors afterward, a plain `cd android && ./gradlew clean`
is not always enough — the CMake configure step can cache "this generated directory doesn't exist"
from before the fix. Also clear `android/app/.cxx`.

## Inline `<Text>` children on Android: no clipping via wrapping `View`

A `View` with `overflow: 'hidden'` used purely to clip a child (no border/background of its own),
placed as an inline child of `<Text>`, renders as a garbled smear on Android — confirmed
empirically with the animated-emote crop-via-clip approach (see `docs/emotes.md`), even with the
clipped content completely static (no animation/transform involved at all). This appears to be
specific to Android's inline-Text-child layout, not a general RN bug. If you need to render
something clipped/cropped inline in a message row, do the cropping at the image-file level (real
separate files) rather than at the layout level.

Plain `transform` (no clipping) on an inline `Image` — e.g. the `:spin`/`:mirror` emote modifiers
— does **not** hit this bug; it's specifically the clip case.

## `useNativeDriver: true` can be unreliable for inline-Text-child Animated values

Seen while debugging the (now-abandoned) clip-and-transform animated-emote approach: switching an
`Animated.Value` between `useNativeDriver: true`/`false` via Fast Refresh threw "already moved to
native" errors, and native-driven transforms on inline-Text-child elements rendered garbled in a
way the JS-driven equivalent didn't. The emote-modifier `:spin` rotation
(`useSpinRotation` in `src/chat/emoteModifiers.ts`) deliberately uses `useNativeDriver: false` for
this reason — the perf cost is negligible for a rare modifier, and it avoids re-triggering
whatever this is.

## Fast Refresh + hook count changes

Standard RN caveat, but bit us repeatedly enough to note: adding a new `useState`/`useRef`/etc. to
an already-mounted component and relying on Fast Refresh to pick it up produces "Rendered more
hooks than during the previous render." Always do a full restart
(`adb shell am force-stop <pkg> && am start -n <pkg>/.MainActivity`) after adding a hook, don't
trust Fast Refresh for hook-count changes.

## AppState `'active'` can fire more than once for a single foreground event (Android)

`useChat.ts`'s `AppState` listener and its catch-up logic both guard against this explicitly
(`lastAppState` ref, monotonic `catchUpRequestId`) — without the guards, a single foreground
produces duplicate catch-up requests that can resolve out of order, visibly showing a "stuck
catching up" loop if a stale response arrives after a fresher one and overwrites it.

## Chromecast: `loadMedia()` resolving successfully doesn't mean playback started

The sender-side `loadMedia()` promise only confirms the receiver *received* the command, not that
it started playing. For CMAF/fMP4 HLS content specifically, the receiver can accept the command
and then sit at `playerState: null` forever unless `hlsVideoSegmentFormat: 'FMP4'` is set on
`MediaInfo` — there's no error surfaced, it just silently never starts. Subscribe to the
`RemoteMediaClient`'s player-state stream (not just the `loadMedia()` promise) if you need to know
whether playback actually began.

Separately, AngelThump's master HLS manifest has no CORS headers, which blocks the Cast receiver
(a separate device on the network, not our app) from fetching it — resolve to the CORS-clean edge
manifest URL first (`src/streams/hlsResolver.ts`) rather than passing the master manifest URL
straight to `loadMedia()`.

## iOS is unverified

Everything in this repo has been built and run on Android only. There's no reason it *shouldn't*
work on iOS — nothing here uses Android-only APIs deliberately — but CocoaPods has never been run
this project, and `react-native-google-cast` specifically needs `NSBonjourServices` /
local-network-usage entries in `Info.plist` that haven't been added. Don't assume "no code changes
needed," budget a real first-build pass (pod install, Xcode signing, Cast `Info.plist`) before
treating iOS as supported.
