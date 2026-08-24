# Emotes

## The problem

chat-gui's emote index (`emotes.<hash>.css`, fetched and parsed by `src/chat/emotes.ts`) describes
two kinds of emote:

- **Static** — a plain image, optionally with 1x/2x/4x variants (we prefer 2x for a crisp render
  without over-fetching).
- **"Animated"** — not an animated GIF/APNG at all. It's a single wide spritesheet image, and
  chat-gui plays it via a CSS `steps()` timing function stepping `background-position` through
  `@keyframes` (`ANIM_META_RE` in `emotes.ts` parses the frame count / duration out of that rule).
  React Native has no equivalent of CSS spritesheet animation — no timing function that can
  discretely jump `background-position`, and no CSS `steps()`.

The naive port — wrap the full spritesheet `Image` in a `View` with `overflow: 'hidden'` and
`translateX` it into position — was tried and rejected. It's the natural approach (CSS
`background-position` clipping is conceptually identical), but a wrapping `View` used purely for
clipping renders as a garbled smear when it's an inline child of `Text` **specifically on
Android** — confirmed empirically by freezing the animation at frame 0 (still garbled) to rule out
a timing/interpolation bug. This is a layout bug in Android's inline-Text-child handling of
transformed/clipped children, not something fixable from the animation-timing side.

## The solution: real per-frame files

`src/chat/emoteFrames.ts` crops each animated emote's spritesheet into one real image file per
frame, using `@react-native-community/image-editor`'s `ImageEditor.cropImage()`, then
`src/components/AnimatedEmote.tsx` cycles a plain `<Image>`'s `source` through those files on a
`setInterval`. A plain `Image` swapping `source` needs no wrapping `View` or transform, so — unlike
the clip-and-translate approach — it renders correctly inline.

Notes on the implementation:
- Frames are cropped once per `(emote name, source uri)` and cached in memory for the app's
  session (`frameCache` in `emoteFrames.ts`); repeat uses of the same emote in chat don't re-crop.
- Crops are throttled to 8 concurrent `cropImage()` calls (`CROP_CONCURRENCY`), not fired all at
  once. High-frame-count emotes (catJAM has 158 frames) were found to overwhelm the native bridge
  if all frames are cropped via a single `Promise.all` — some crops would silently hang, and the
  emote would flicker for a couple of frames then go blank.
- Playback uses `setInterval`, not `Animated.timing`. `Animated.timing({ duration: 0 })` does not
  reliably produce an instant frame jump across RN versions; a plain interval driving `useState`
  is the simplest thing that reliably jumps discretely.
- A `MIN_TICK_MS` (40ms) floor is enforced on the tick interval, since JS-timer-driven stepping
  can't reliably hit intervals faster than that (bridge/render round-trip overhead). For emotes
  whose real per-frame duration is faster than that (e.g. WAYTOODANK: 90 frames / 1800ms = 20ms/
  frame), multiple frames are advanced per tick (`framesPerTick`) rather than freezing — the loop
  still completes in roughly its real duration and visibly animates, just at a coarser step.

## Don't trust chat-gui's CSS cascade naively

An earlier attempt at reading a *more* accurate per-emote duration/direction from the CSS (some
emotes have later rules overriding `animation-duration`/`animation-direction`) turned out to be
parsing the wrong thing: those overrides live under `.generify-emote-NAME .fast .chat-emote-NAME`
etc. — an unrelated, rarely-used chat-gui feature (a meme "generify" randomizer mode) scoped under
an ancestor class that's essentially never present in real chat. A regex that matched
`.chat-emote-NAME{...animation-duration...}` without checking what preceded it picked these up as
if they were the real base animation, which broke playback speed/direction for the affected
emotes. **If you're tempted to read more than the base `animation: NAME-anim DURATION steps(N)`
rule out of the CSS, check what selector actually precedes the declaration first.**

## Modifiers (`:mirror`, `:fast`, etc.)

chat-gui supports suffixing an emote with one or more `:modifier`s (e.g. `NODDERS:mirror:fast`) —
the full list is `GENERIFY_OPTIONS` in chat-gui's `assets/chat/js/const.js`, about 25 of them.
They fall into three tiers by how well they map onto RN:

- **Ported** (`src/chat/emoteModifiers.ts`): `mirror`/`flip`/`smol`/`wide` are static
  `transform: scaleX/scaleY` (direct RN equivalents of chat-gui's flat CSS transform rules);
  `spin` is a fixed 0.8s×3 rotation loop (`useSpinRotation`, an `Animated.Value` interpolated to
  `deg`, using `useNativeDriver: false` — mixing `useNativeDriver: true` with inline-Text-child
  Images has shown rendering bugs before, see above); `fast`/`slow`/`reverse`/`pause` hook directly
  into `AnimatedEmote`'s existing frame-timing logic (`speedMultiplier`, index-from-the-end for
  reverse, skipping the interval entirely for pause).
- **Not ported**: everything else (`rain`, `snow`, `love`, `worth`, `jam`, `hyper`, `pride`,
  `noir`, `blur`, `gray`, `banned`, `virus`, `slide`, `peek`, ...). These are animated sprite
  overlays or CSS `filter` effects layered on top of the base emote — RN has no `filter` support
  at all, and each overlay is its own separate spritesheet animation, i.e. roughly the same
  category of work as the whole crop pipeline above, once per effect. Unrecognized modifiers are
  silently dropped (`SUPPORTED_MODIFIERS` in `emoteModifiers.ts`) rather than erroring, matching
  chat-gui's behavior where an unknown suffix is just a no-op.

Modifier parsing lives in `messageFormat.ts` (`word.split(':')`, then filtered against
`SUPPORTED_MODIFIERS`), attached to the `emote` message segment, and applied in both
`AnimatedEmote.tsx` (animated emotes) and `ChatScreen.tsx`'s `StaticEmote` component (static
emotes — needed as its own component rather than inlined, since `:spin` needs its own
`Animated.Value`/hook instance per rendered emote).
