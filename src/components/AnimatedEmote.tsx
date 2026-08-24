import React, { useEffect, useState } from 'react';
import { Animated, Image, Text } from 'react-native';
import { getEmoteFrames } from '../chat/emoteFrames';
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

// Renders chat-gui's spritesheet-style "animated" emotes (see emotes.ts) —
// a horizontal strip of frames chat-gui flips through via CSS steps() +
// background-position, which RN has no equivalent for. Real per-frame
// image files (cropped once and cached — see emoteFrames.ts) sidestep
// that: cycling a plain Image's `source` needs no wrapping View or
// transform, so — unlike the clip-and-transform approach this replaced —
// it renders correctly even as an inline child of Text.
export default function AnimatedEmote({ emote, width, height, accessibilityLabel, modifiers = [] }: Props) {
  const [frames, setFrames] = useState<string[] | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const spinRotate = useSpinRotation(modifiers);

  useEffect(() => {
    let cancelled = false;
    setFrames(null);
    setFrameIndex(0);
    getEmoteFrames(accessibilityLabel ?? emote.uri, emote).then(result => {
      if (!cancelled) {
        setFrames(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [emote, accessibilityLabel]);

  const paused = modifiers.includes('pause');

  useEffect(() => {
    if (!emote.animation || !frames || frames.length <= 1 || paused) {
      return;
    }
    const { frameCount, durationMs } = emote.animation;
    const realFrameDuration = (durationMs / frameCount) * speedMultiplier(modifiers);
    const tickMs = Math.max(realFrameDuration, MIN_TICK_MS);
    const framesPerTick = Math.max(1, Math.round(tickMs / realFrameDuration));

    const interval = setInterval(() => {
      setFrameIndex(prev => (prev + framesPerTick) % frameCount);
    }, tickMs);
    return () => clearInterval(interval);
  }, [emote.animation, frames, paused, modifiers]);

  if (!frames) {
    // Cropping hasn't finished — falling back to the raw (uncropped) sheet
    // here would flash the same garbled wide-sheet render this component
    // exists to avoid. Name-as-text is a known-safe inline placeholder
    // (same fallback used while the whole emote index is still loading).
    return <Text style={{ fontStyle: 'italic' }}>{accessibilityLabel}</Text>;
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
