import React from 'react';
import { StyleSheet, View } from 'react-native';

// The classic Chromecast glyph — a screen outline with wifi-style signal
// arcs in the bottom-left corner — built from plain Views rather than an
// icon font/SVG library, since CastButton's native tap handling can't be
// intercepted for our resolve-then-load flow (see streams/cast.tsx), so we
// can't reuse its built-in icon.
// `active` (currently casting) fills the screen solid instead of just
// outlining it — same convention the real Cast icon uses to distinguish
// "connected/casting" from "idle".
export default function ChromecastIcon({ color, active }: { color: string; active?: boolean }) {
  return (
    <View style={styles.castIconBox}>
      <View style={[styles.castIconScreen, { borderColor: color }, active && { backgroundColor: color }]} />
      <View
        style={[styles.castIconArc, styles.castIconArcOuter, { borderBottomColor: color, borderLeftColor: color }]}
      />
      <View
        style={[styles.castIconArc, styles.castIconArcInner, { borderBottomColor: color, borderLeftColor: color }]}
      />
      <View style={[styles.castIconDot, { backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  // Taller box with a shorter screen than earlier attempts, specifically so
  // the arcs below (up to 9px tall) have clearance to sit under the screen
  // without overlapping it — that overlap was the bug in earlier attempts.
  castIconBox: { width: 22, height: 20 },
  castIconScreen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 11,
    borderWidth: 1.5,
    borderRadius: 2,
  },
  castIconDot: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: 3,
    height: 3,
    borderRadius: 1.5,
  },
  // Standard wifi-icon CSS trick: a circle with only its bottom+left border
  // colored (rest transparent) — that quadrant's visible stroke passes
  // right through the bounding box's bottom-left corner, so anchoring the
  // box at the same corner as the dot makes the arc read as radiating from
  // it, bowing up and to the right.
  castIconArc: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    borderColor: 'transparent',
    borderRadius: 50,
  },
  castIconArcOuter: { width: 9, height: 9, borderBottomWidth: 1.3, borderLeftWidth: 1.3 },
  castIconArcInner: { width: 5, height: 5, borderBottomWidth: 1.3, borderLeftWidth: 1.3 },
});
