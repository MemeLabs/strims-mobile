import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

// Port of chat-gui's GENERIFY_OPTIONS (assets/chat/js/const.js) — only the
// subset with a straightforward RN equivalent. The rest (rain/snow/love/
// worth/jam/hyper/pride/etc) are animated sprite overlays layered on top of
// the emote via CSS, which has no RN equivalent without its own asset/
// animation pipeline — a much bigger effort, left for later.
export const SUPPORTED_MODIFIERS = new Set(['mirror', 'flip', 'smol', 'wide', 'spin', 'fast', 'slow', 'reverse', 'pause']);

// Static scale transforms — ports of the flat `transform:` rules in
// chat-gui/assets/chat/css/generify.scss (.mirror/.flip/.smol/.wide).
export function staticTransforms(modifiers: string[]): { scaleX?: number; scaleY?: number }[] {
  const t: { scaleX?: number; scaleY?: number }[] = [];
  if (modifiers.includes('mirror')) {
    t.push({ scaleX: -1 });
  }
  if (modifiers.includes('flip')) {
    t.push({ scaleY: -1 });
  }
  if (modifiers.includes('smol')) {
    t.push({ scaleX: 0.5 }, { scaleY: 0.5 });
  }
  if (modifiers.includes('wide')) {
    t.push({ scaleX: 1.5 }, { scaleY: 0.8 });
  }
  return t;
}

// chat-gui's `.generify-spin` — a fixed 0.8s rotation, looped 3 times (its
// CSS `:hover` variant loops forever, which has no mobile equivalent since
// there's nothing to hover). Returns null when `spin` isn't present.
export function useSpinRotation(modifiers: string[]) {
  const spin = modifiers.includes('spin');
  const value = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!spin) {
      return;
    }
    value.setValue(0);
    // useNativeDriver is avoided here — mixing it with inline-Text-child
    // Images has shown garbled rendering before (see AnimatedEmote.tsx).
    const anim = Animated.loop(
      Animated.timing(value, { toValue: 1, duration: 800, easing: Easing.linear, useNativeDriver: false }),
      { iterations: 3 },
    );
    anim.start();
    return () => anim.stop();
  }, [spin, value]);

  if (!spin) {
    return null;
  }
  return value.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
}

// chat-gui halves/doubles an animated emote's playback speed via the
// `.fast`/`.slow` classes — applied on top of AnimatedEmote's own
// frame-duration calc.
export function speedMultiplier(modifiers: string[]): number {
  if (modifiers.includes('fast')) {
    return 0.5;
  }
  if (modifiers.includes('slow')) {
    return 2;
  }
  return 1;
}
