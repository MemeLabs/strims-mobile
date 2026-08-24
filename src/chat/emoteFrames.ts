import ImageEditor from '@react-native-community/image-editor';
import { makeLogger } from '../log';
import type { EmoteInfo } from './emotes';

const log = makeLogger('emote-frames');

// chat-gui's "animated" emotes are a single wide spritesheet, flipped via
// CSS background-position — RN has no equivalent, and clipping a wide
// Image down to one frame via a wrapping View doesn't render correctly as
// an inline child of Text on Android (confirmed empirically: shows a
// garbled smear regardless of whether it's animating). Real per-frame
// image files sidestep that entirely — cycling a plain <Image>'s `source`
// needs no wrapping View or transform, so it's safe inline. Cropped once
// per emote name and cached in memory for the app's session; frames land
// in the OS image cache dir (see ImageEditor.cropImage docs) so repeat
// crops of the same region are cheap even across cache misses here.
const frameCache = new Map<string, Promise<string[]>>();

async function cropFrame(uri: string, frameIndex: number, framePixelWidth: number, framePixelHeight: number): Promise<string> {
  const result = await ImageEditor.cropImage(uri, {
    offset: { x: frameIndex * framePixelWidth, y: 0 },
    size: { width: framePixelWidth, height: framePixelHeight },
  });
  return result.uri;
}

// Firing every frame's crop at once (e.g. catJAM has 158) overwhelms the
// native bridge/IO — some crops never resolve and the emote goes blank
// after the first few frames. Cap how many crop calls are in flight at once.
const CROP_CONCURRENCY = 8;

async function cropAllFrames(emote: EmoteInfo): Promise<string[]> {
  const { animation } = emote;
  if (!animation) {
    return [emote.uri];
  }
  // Crop offsets/sizes are in the source image's actual pixel space, which
  // is `scale`x the logical width/height we render at (see EmoteInfo).
  const framePixelWidth = emote.width * emote.scale;
  const framePixelHeight = emote.height * emote.scale;
  const frames = new Array<string>(animation.frameCount);
  let next = 0;
  const worker = async () => {
    while (next < animation.frameCount) {
      const i = next++;
      frames[i] = await cropFrame(emote.uri, i, framePixelWidth, framePixelHeight);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CROP_CONCURRENCY, animation.frameCount) }, worker));
  log.info(`cropped ${frames.length} frames for animated emote`);
  return frames;
}

// Returns cropped per-frame image URIs for an animated emote (or a single-
// element array of the original uri for a static one) — cached per emote
// name/uri so repeat renders (the same emote used many times in chat)
// don't re-crop.
export function getEmoteFrames(name: string, emote: EmoteInfo): Promise<string[]> {
  const key = `${name}:${emote.uri}`;
  let cached = frameCache.get(key);
  if (!cached) {
    cached = cropAllFrames(emote).catch(err => {
      log.warn(`failed to crop frames for ${name}`, err);
      frameCache.delete(key);
      return [emote.uri];
    });
    frameCache.set(key, cached);
  }
  return cached;
}
