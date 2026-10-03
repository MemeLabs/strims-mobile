import { NativeModules } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { makeLogger } from '../log';
import { hashKey } from './emoteFrames';
import { reportStaleEmoteIndex, type EmoteInfo } from './emotes';

const log = makeLogger('emote-webp');

// Android only: animated emotes are encoded once into animated WebP files
// (android/.../EmoteWebpModule.kt) and played natively by Fresco. That keeps
// per-frame work out of JS entirely: stepping frames through React state
// cost a full React commit per frame per emote and kept a CPU core busy.
//
// Files are named deterministically from emote + variant, so the file's
// existence *is* the cache; no index to keep in sync. Bump FORMAT_VERSION
// whenever the encoder's output changes so old files are not reused.
const FORMAT_VERSION = 4;
const DIR = `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/emote-webp`;

interface EmoteWebpNative {
  encode(
    sourceUri: string,
    frameWidth: number,
    frameHeight: number,
    frameCount: number,
    durationMs: number,
    loopCount: number,
    reverse: boolean,
    destPath: string,
  ): Promise<string>;
}

const native = NativeModules.EmoteWebp as EmoteWebpNative;

export interface EmoteVariant {
  reverse: boolean;
  // Multiplier on the loop duration (:fast = 0.5, :slow = 2).
  speed: number;
  // :pause, freezes on the first frame.
  paused: boolean;
  // Settings → "Animate emotes forever" (storage/preferences.ts).
  forever: boolean;
}

// In-flight and finished encodes for this app run, so every instance of
// the same emote variant shares one encode and one file.
const cache = new Map<string, Promise<string | null>>();

export function getAnimatedEmoteUri(name: string, emote: EmoteInfo, variant: EmoteVariant): Promise<string | null> {
  const animation = emote.animation;
  if (!animation) {
    return Promise.resolve(emote.uri);
  }
  const variantKey = `${name}:${emote.uri}:${variant.reverse ? 'r' : ''}${variant.paused ? 'p' : ''}${variant.forever ? 'f' : ''}${variant.speed}`;
  let cached = cache.get(variantKey);
  if (!cached) {
    cached = (async () => {
      const destPath = `${DIR}/${hashKey(variantKey)}-v${FORMAT_VERSION}.webp`;
      if (await ReactNativeBlobUtil.fs.exists(destPath)) {
        return `file://${destPath}`;
      }
      const uri = await native.encode(
        emote.uri,
        emote.width * emote.scale,
        emote.height * emote.scale,
        // :pause keeps only the first frame.
        variant.paused ? 1 : animation.frameCount,
        animation.durationMs * variant.speed,
        // Same finite count chat-gui's CSS uses, after which it rests on the
        // last frame (see emotes.ts). Like chat-gui, :fast doubles the count
        // to keep total play time (NODDERS: 16 loops, :fast 32); :slow keeps
        // it. WebP loop count 0 means forever.
        variant.paused
          ? 1
          : variant.forever
            ? 0
            : Math.max(1, animation.iterations * (variant.speed < 1 ? 2 : 1)),
        variant.reverse,
        destPath,
      );
      log.info(`encoded ${name} (${animation.frameCount} frames)`);
      return uri;
    })().catch(err => {
      log.warn(`failed to encode ${name}`, err);
      if (err instanceof Object && 'code' in err && err.code === 'E_EMOTE_NOT_FOUND') {
        // Dead URL: keep the null cached so every mount doesn't re-request
        // it. The refreshed index carries new URLs, hence new cache keys.
        reportStaleEmoteIndex();
      } else {
        // Transient failure: drop it so a later mount can retry.
        cache.delete(variantKey);
      }
      return null;
    });
    cache.set(variantKey, cached);
  }
  return cached;
}

// Wired to Settings' "Refresh emotes" alongside refreshEmoteFrames.
export async function refreshEmoteWebps(): Promise<void> {
  cache.clear();
  try {
    if (await ReactNativeBlobUtil.fs.exists(DIR)) {
      await ReactNativeBlobUtil.fs.unlink(DIR);
    }
  } catch (err) {
    log.warn('failed to clear encoded emote files', err);
  }
}
