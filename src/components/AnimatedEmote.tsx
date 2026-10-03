import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, Platform, Text } from 'react-native';
import { emoteFramesKey, getEmoteFrames } from '../chat/emoteFrames';
import { getAnimatedEmoteUri } from '../chat/emoteWebp';
import { usePreference } from '../storage/preferences';
import {
  getEmoteAnimationsActive,
  subscribeToEmoteAnimationsActive,
  subscribeToEmoteClock,
} from '../chat/emoteClock';
import { speedMultiplier, staticTransforms, useSpinRotation } from '../chat/emoteModifiers';
import type { EmoteInfo } from '../chat/emotes';

interface Props {
  emote: EmoteInfo;
  width: number;
  height: number;
  accessibilityLabel?: string;
  modifiers?: string[];
}

// JS-timer-driven frame stepping can't reliably hit intervals faster than
// this (bridge/render round-trip overhead) — for emotes faster than it
// (e.g. WAYTOODANK: 90 frames/1800ms = 20ms/frame), we advance multiple
// frames per tick instead of freezing, so the loop still completes in
// roughly its real duration and visibly animates, just at a coarser step.
const MIN_TICK_MS = 40;

// Shown while an emote's frames/file aren't ready yet.
const placeholderStyle = { fontStyle: 'italic' } as const;

// Renders chat-gui's spritesheet-style "animated" emotes (see emotes.ts) —
// a horizontal strip of frames chat-gui flips through via CSS steps() +
// background-position, which RN has no equivalent for. Both paths below
// end up as a plain inline <Image> (no wrapping View or clip transform),
// which is what renders correctly as an inline child of Text.
//
// Android: the sheet is encoded once into an animated WebP (emoteWebp.ts)
// and Fresco plays it natively, so no JS runs per frame — like the browser
// compositor playing chat-gui's CSS. Each instance plays from its own mount,
// as on desktop. :fast/:slow/:reverse/:pause are baked into the file.
function NativeAnimatedEmote({ emote, width, height, accessibilityLabel, modifiers = [] }: Props) {
  const spinRotate = useSpinRotation(modifiers);
  const [uri, setUri] = useState<string | null>(null);
  const reverse = modifiers.includes('reverse');
  const paused = modifiers.includes('pause');
  const speed = speedMultiplier(modifiers);
  const forever = usePreference('animateEmotesForever');

  useEffect(() => {
    let cancelled = false;
    setUri(null);
    getAnimatedEmoteUri(accessibilityLabel ?? emote.uri, emote, { reverse, paused, speed, forever }).then(result => {
      if (!cancelled) {
        setUri(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [emote, accessibilityLabel, reverse, paused, speed, forever]);

  if (!uri) {
    // Still encoding (or failed): the name is a known-safe inline
    // placeholder; the raw wide sheet would render as a garbled smear.
    return <Text style={placeholderStyle}>{accessibilityLabel}</Text>;
  }
  const transform = [...staticTransforms(modifiers), ...(spinRotate ? [{ rotate: spinRotate }] : [])];
  return (
    <Animated.Image
      source={{ uri }}
      style={[{ width, height }, transform.length ? { transform } : null] as never}
      accessibilityLabel={accessibilityLabel}
    />
  );
}

// iOS: per-frame image files (cropped once and cached — see emoteFrames.ts),
// cycled by swapping the Image's `source` from JS.
//
// Playback splits into two distinct modes:
//  - One-shot (e.g. Aware: plays once, rests on its last frame) — each
//    mounted instance plays independently, so an old message's Aware stays
//    frozen once finished while a brand new one starts its own fresh
//    playthrough.
//  - Looping (everything else) — every on-screen instance of the same
//    emote shares one synced clock (emoteClock.ts) instead of each running
//    its own independent interval, so all copies of e.g. catJAM visibly
//    stay in phase with each other rather than drifting or resetting
//    independently on unrelated re-renders.
function FrameAnimatedEmote({ emote, width, height, accessibilityLabel, modifiers = [] }: Props) {
  const [frames, setFrames] = useState<string[] | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const spinRotate = useSpinRotation(modifiers);
  const [animationsActive, setAnimationsActive] = useState(getEmoteAnimationsActive);
  useEffect(() => subscribeToEmoteAnimationsActive(setAnimationsActive), []);
  // Set once a one-shot has reached its resting frame, so re-running the
  // effect (e.g. animations resuming) doesn't replay it from the start.
  const oneShotDoneRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setFrames(null);
    setFrameIndex(0);
    getEmoteFrames(accessibilityLabel ?? emote.uri, emote).then(async result => {
      // Swapping `source` to a frame file RN hasn't decoded yet shows a
      // blank flash until it finishes loading — at a fast tick rate (Aware
      // ticks every ~70ms) that reads as a flicker. Warming every frame
      // into RN's image cache before playback starts makes each swap
      // effectively instant instead.
      await Promise.all(result.map(uri => Image.prefetch(uri).catch(() => {})));
      if (!cancelled) {
        setFrames(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [emote, accessibilityLabel]);

  const paused = modifiers.includes('pause');
  // `modifiers` is a fresh array instance every render (messageFormat.ts
  // builds a new one per formatMessage call, and MessageRow re-runs that on
  // every parent re-render — e.g. any new message arriving in the chat).
  // Depending on the array itself below would restart whichever effect
  // reads it on nearly every unrelated re-render. Depending on its content
  // instead keeps things stable across those re-renders.
  const modifiersKey = modifiers.join(',');
  const isOneShot = !!emote.animation && emote.animation.iterations <= 1;

  // One-shot: play through once, independently per instance, then freeze.
  useEffect(() => {
    if (!emote.animation || !frames || frames.length <= 1 || paused || !isOneShot || oneShotDoneRef.current) {
      return;
    }
    const { frameCount, durationMs } = emote.animation;
    // Hidden/backgrounded: skip straight to the resting frame instead of
    // ticking off-screen (and instead of replaying it on resume).
    if (!animationsActive) {
      oneShotDoneRef.current = true;
      setFrameIndex(frameCount - 1);
      return;
    }
    // Only the one-shot path applies :fast/:slow — it's per-instance, so
    // there's no "which instance's speed wins" conflict like there is for
    // a synced looping clock (see the looping effect below).
    const realFrameDuration = (durationMs / frameCount) * speedMultiplier(modifiers);
    const tickMs = Math.max(realFrameDuration, MIN_TICK_MS);
    const framesPerTick = Math.max(1, Math.round(tickMs / realFrameDuration));

    let advanced = 0;
    const interval = setInterval(() => {
      advanced += framesPerTick;
      if (advanced >= frameCount) {
        oneShotDoneRef.current = true;
        setFrameIndex(frameCount - 1);
        clearInterval(interval);
        return;
      }
      setFrameIndex(advanced);
    }, tickMs);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- modifiersKey stands in for modifiers, see above
  }, [emote.animation, frames, paused, isOneShot, modifiersKey, animationsActive]);

  // Looping: subscribe to (and, if needed, start) the shared clock for this
  // emote — every mounted instance ends up rendering the same frameIndex.
  useEffect(() => {
    if (!emote.animation || !frames || frames.length <= 1 || paused || isOneShot) {
      return;
    }
    const { frameCount, durationMs } = emote.animation;
    // The shared clock runs at the emote's base speed regardless of any
    // one instance's :fast/:slow modifier — a per-instance speed on a
    // synced clock is a contradiction (which speed would the other
    // instances use?), so those modifiers are a no-op for looping emotes.
    const realFrameDuration = durationMs / frameCount;
    const tickMs = Math.max(realFrameDuration, MIN_TICK_MS);
    const framesPerTick = Math.max(1, Math.round(tickMs / realFrameDuration));
    const key = emoteFramesKey(accessibilityLabel ?? emote.uri, emote);
    return subscribeToEmoteClock(key, frameCount, framesPerTick, tickMs, setFrameIndex);
  }, [emote, emote.animation, frames, paused, isOneShot, accessibilityLabel]);

  if (!frames) {
    // Cropping hasn't finished — falling back to the raw (uncropped) sheet
    // here would flash the same garbled wide-sheet render this component
    // exists to avoid. Name-as-text is a known-safe inline placeholder
    // (same fallback used while the whole emote index is still loading).
    return <Text style={placeholderStyle}>{accessibilityLabel}</Text>;
  }
  // `reverse` just flips which end of the (shared, cached) frame list we
  // index from rather than mutating it.
  const displayIndex = modifiers.includes('reverse') ? frames.length - 1 - frameIndex : frameIndex;
  const transform = [...staticTransforms(modifiers), ...(spinRotate ? [{ rotate: spinRotate }] : [])];
  return (
    <Animated.Image
      source={{ uri: frames[displayIndex] }}
      style={[{ width, height }, transform.length ? { transform } : null] as never}
      accessibilityLabel={accessibilityLabel}
    />
  );
}

const AnimatedEmote = Platform.OS === 'android' ? NativeAnimatedEmote : FrameAnimatedEmote;
export default AnimatedEmote;
