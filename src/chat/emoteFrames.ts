import AsyncStorage from '@react-native-async-storage/async-storage';
import ImageEditor from '@react-native-community/image-editor';
import { makeLogger } from '../log';
import type { EmoteInfo } from './emotes';

const log = makeLogger('emote-frames');

// Persists cropped-frame file URIs across app restarts — without this, the
// in-memory-only frameCache below (which *does* dedupe within one run) gets
// wiped on every cold start, so every animated emote touched in a session
// gets re-fetched-and-cropped again the next time the app opens. Combined
// with how costly the fetch side of that used to be (see fetchAsDataUri),
// persisting this was worth doing regardless. Like the emote index (see
// emotes.ts), this has no automatic expiry — it only clears via
// refreshEmoteFrames, wired to Settings' "Refresh emotes" button.
const FRAME_STORAGE_PREFIX = 'gg.strims.mobile.emote-frames.';

async function readPersistedFrames(key: string): Promise<string[] | null> {
  try {
    const raw = await AsyncStorage.getItem(FRAME_STORAGE_PREFIX + key);
    return raw ? (JSON.parse(raw) as string[]) : null;
  } catch (err) {
    log.warn(`failed to read persisted frames for ${key}`, err);
    return null;
  }
}

async function writePersistedFrames(key: string, frames: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(FRAME_STORAGE_PREFIX + key, JSON.stringify(frames));
  } catch (err) {
    log.warn(`failed to persist frames for ${key}`, err);
  }
}

// chat-gui's "animated" emotes are a single wide spritesheet, flipped via
// CSS background-position — RN has no equivalent, and clipping a wide
// Image down to one frame via a wrapping View doesn't render correctly as
// an inline child of Text on Android (confirmed empirically: shows a
// garbled smear regardless of whether it's animating). Real per-frame
// image files sidestep that entirely — cycling a plain <Image>'s `source`
// needs no wrapping View or transform, so it's safe inline. Cropped once
// per emote name and cached in memory for the app's session, so repeat uses
// of the same emote within one run of the app don't re-fetch or re-crop
// (see fetchAsDataUri below for why the *fetch* only happening once per
// emote, not once per frame, matters a lot more than it sounds).
const frameCache = new Map<string, Promise<string[]>>();

// @react-native-community/image-editor's native crop implementation opens a
// fresh network connection to `uri` on *every* cropImage() call for a
// remote source (Android: ImageEditorModuleImpl.kt's openBitmapInputStream
// does a plain `URL(uri).openConnection()`, with no caching at all) — it
// only skips the network for `data:` URIs and local file URIs. Cropping a
// 158-frame emote (catJAM) the naive way — one cropImage() call per frame,
// all pointed at the same remote spritesheet URL — re-downloads that same
// spritesheet's full bytes 158 times to render *one* occurrence of it.
// That's the kind of thing that quietly burns through a mobile data plan.
// Fetching the spritesheet exactly once ourselves and handing every crop
// call a local `data:` URI instead avoids the native layer ever touching
// the network more than once per emote.
async function fetchAsDataUri(uri: string): Promise<string> {
  const response = await fetch(uri);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

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
  const sourceUri = await fetchAsDataUri(emote.uri);
  // Crop offsets/sizes are in the source image's actual pixel space, which
  // is `scale`x the logical width/height we render at (see EmoteInfo).
  const framePixelWidth = emote.width * emote.scale;
  const framePixelHeight = emote.height * emote.scale;
  const frames = new Array<string>(animation.frameCount);
  let next = 0;
  const worker = async () => {
    while (next < animation.frameCount) {
      const i = next++;
      frames[i] = await cropFrame(sourceUri, i, framePixelWidth, framePixelHeight);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CROP_CONCURRENCY, animation.frameCount) }, worker));
  log.info(`cropped ${frames.length} frames for animated emote`);
  return frames;
}

// Shared with emoteClock.ts, so the synced-playback clock for a looping
// emote and its cropped-frame cache always agree on identity.
export function emoteFramesKey(name: string, emote: EmoteInfo): string {
  return `${name}:${emote.uri}`;
}

// Returns cropped per-frame image URIs for an animated emote (or a single-
// element array of the original uri for a static one) — cached both in
// memory (frameCache, for repeat renders within one app run) and on disk
// (readPersistedFrames/writePersistedFrames, for repeat *sessions* — see
// above) so a given emote is only ever fetched-and-cropped once, full stop,
// until someone explicitly refreshes.
export function getEmoteFrames(name: string, emote: EmoteInfo): Promise<string[]> {
  const key = emoteFramesKey(name, emote);
  let cached = frameCache.get(key);
  if (!cached) {
    cached = (async () => {
      const persisted = await readPersistedFrames(key);
      if (persisted) {
        return persisted;
      }
      const frames = await cropAllFrames(emote);
      await writePersistedFrames(key, frames);
      return frames;
    })().catch(err => {
      log.warn(`failed to crop frames for ${name}`, err);
      frameCache.delete(key);
      return [emote.uri];
    });
    frameCache.set(key, cached);
  }
  return cached;
}

// The only way persisted/in-memory cropped frames ever get cleared — wired
// to Settings' "Refresh emotes" button, alongside refreshEmoteIndex (see
// emotes.ts). A stale frame with no matching emote-index entry anymore
// (e.g. after a chat-gui deploy changes an emote's URL) would just never
// get looked up again either way, so this doesn't need to be smarter than
// "clear everything, let it re-crop on next use."
export async function refreshEmoteFrames(): Promise<void> {
  frameCache.clear();
  try {
    const keys = await AsyncStorage.getAllKeys();
    const frameKeys = keys.filter(k => k.startsWith(FRAME_STORAGE_PREFIX));
    if (frameKeys.length > 0) {
      await AsyncStorage.removeMany(frameKeys);
    }
  } catch (err) {
    log.warn('failed to clear persisted emote frames', err);
  }
}
