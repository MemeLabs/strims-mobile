import type { ViewerChannel } from './types';

// Port of chat-gui/assets/chat/js/viewerstate.ts — the color of a viewer's
// name bar is deterministically derived from the channel they're watching,
// so it's the same color for everyone across every client.
function fnv1a(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

function createRng(seed: string): () => number {
  let n = 0;
  return () => fnv1a(`${n++}${seed}`) / 0xffffffff;
}

function generateColor(rng: () => number): string {
  const h = Math.round(rng() * 360);
  const s = Math.round(rng() * 80 + 20);
  const l = Math.round(rng() * 50 + 20);
  return `hsl(${h}, ${s}%, ${l}%)`;
}

// Dim gray for "not watching anything" — matches chat-gui's default so the
// bar reads as "off" rather than drawing attention.
export const NO_CHANNEL_COLOR = '#292929';

export function viewerChannelColor(channel: ViewerChannel | null | undefined): string {
  if (!channel) {
    return NO_CHANNEL_COLOR;
  }
  return generateColor(createRng(channel.channel + channel.service));
}
