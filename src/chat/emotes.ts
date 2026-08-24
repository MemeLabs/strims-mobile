import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_CONFIG } from '../config/env';
import { makeLogger } from '../log';

const log = makeLogger('emotes');

export interface EmoteInfo {
  uri: string;
  width: number;
  height: number;
  // `uri`'s actual pixel dimensions are `width`/`height` times this — we
  // pick the 2x asset when available for retina sharpness, but fall back
  // to 1x or 4x if that's all a given emote has, so it varies per emote.
  // Needed to crop animation frames at the right pixel offsets (cropping
  // with 1x offsets against a 2x image would grab the wrong region).
  scale: number;
  // Present for "animated" emotes (e.g. NODDERS) — these aren't animated
  // GIFs at all, `uri` points at a horizontal spritesheet and chat-gui
  // animates it in CSS via steps() + background-position keyframes.
  // frameCount evenly-spaced frames, each `width`x`height`, side by side;
  // durationMs is one full loop across all frames.
  animation?: {
    frameCount: number;
    durationMs: number;
    // How many times chat-gui plays the loop before resting on the last
    // frame (its default, non-`:hover` behavior — see ANIM_META_RE).
    iterations: number;
  };
}

// Bump the version suffix whenever the parsing logic changes shape, so a
// stale cache from an older parser (e.g. one that dropped emotes with
// non-standard resolution sets) doesn't linger indefinitely.
const STORAGE_KEY = 'gg.strims.mobile.emote-index.v7';

interface StoredIndex {
  fetchedAt: number;
  emotes: [string, EmoteInfo][];
}

// No TTL — this cache is never invalidated automatically. Every automatic
// re-check (even just "is this still fresh") means re-fetching and
// re-parsing the whole emotes.<hash>.css bundle, and re-cropping every
// animated emote touched since (see emoteFrames.ts, where that used to mean
// re-downloading full spritesheets over the network). chat-gui's index only
// changes on a deploy, which isn't often enough to justify that cost
// automatically — refreshing is a deliberate action now (Settings → Refresh
// emotes, see refreshEmoteIndex below), not something that happens on a
// timer or on every cold start.
async function readCache(): Promise<Map<string, EmoteInfo> | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const stored = JSON.parse(raw) as StoredIndex;
    log.info(`using cached emote index from ${new Date(stored.fetchedAt).toISOString()}`);
    return new Map(stored.emotes);
  } catch (err) {
    log.warn('failed to read cached emote index', err);
    return null;
  }
}

async function writeCache(emotes: Map<string, EmoteInfo>): Promise<void> {
  const stored: StoredIndex = { fetchedAt: Date.now(), emotes: [...emotes] };
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch (err) {
    log.warn('failed to persist emote index', err);
  }
}

// chat-gui doesn't expose a stable per-emote image URL — the PNGs are
// content-hashed at build time and only referenced from a generated
// `emotes.<hash>.css` bundle. We fetch the site's index page to find that
// bundle's current filename, then parse it for
// `.chat-emote-<name>{background-image:...url(...png) Nx, ...;height:Npx;width:Mpx}`
// rules. Not every emote ships the same resolution set — most have 1x/2x/4x,
// some only 1x/4x, a few (e.g. COGGERS) just 1x with no explicit dimensions
// at all — so this has to tolerate all of those rather than assume a fixed
// shape.
const EMOTE_BLOCK_RE = /\.chat-emote\.chat-emote-([^{\s.]+)\{([^}]*)\}/g;
const URL_SCALE_RE = /url\(([^)]+)\)\s*([\d.]+)x/g;
const DIMENSION_RE = /(?:^|;)height:(\d+)px;width:(\d+)px/;

// Animated emotes get a second, separate rule (single class, not the
// `.chat-emote.chat-emote-<name>` compound selector above) carrying the
// authoritative per-frame width/height plus the steps() animation timing —
// `uri`/spritesheet comes from the block above, everything about how to
// play it comes from here.
// Duration is `Nms` for most emotes but `N.Ms`/`Ns` (decimal seconds) for
// others (e.g. Aware, AlienPls, CLASSIC) — both forms appear throughout the
// stylesheet, so both have to match or those emotes silently fall through
// to the static-image path (rendering the raw, uncropped spritesheet).
// The trailing number is the base (non-`:hover`) iteration count — chat-gui
// plays every animated emote this many times and then rests on its last
// frame; only hovering (which has no mobile equivalent) makes it loop
// forever, so this finite count is what we should actually match.
const ANIM_META_RE =
  /\.chat-emote-([^{\s.]+)\{width:(\d+)px;height:(\d+)px;[^}]*?animation:[A-Za-z0-9_-]+-anim ([\d.]+)(ms|s) steps\((\d+)\) (\d+) /g;

// Emotes without explicit dimensions in the CSS fall back to this — close to
// the median size across the emote set.
const DEFAULT_SIZE = 28;

let cache: Promise<Map<string, EmoteInfo>> | null = null;

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} failed: ${res.status}`);
  }
  return res.text();
}

async function load(): Promise<Map<string, EmoteInfo>> {
  const cached = await readCache();
  if (cached) {
    return cached;
  }

  const base = DEFAULT_CONFIG.apiUri;
  const html = await fetchText(base);
  const match = html.match(/href="(emotes\.[a-f0-9]+\.css)"/);
  if (!match) {
    throw new Error('could not find emotes.<hash>.css link in chat-gui index page');
  }
  const css = await fetchText(`${base}/${match[1]}`);

  const emotes = new Map<string, EmoteInfo>();
  for (const block of css.matchAll(EMOTE_BLOCK_RE)) {
    const [, name, body] = block;
    if (emotes.has(name)) {
      continue;
    }

    // Some emotes list two URLs per scale (e.g. a holiday reskin alongside
    // the normal art) — the first one declared is the one chat-gui actually
    // shows, so keep it and ignore later duplicates for the same scale.
    const byScale = new Map<number, string>();
    for (const m of body.matchAll(URL_SCALE_RE)) {
      const scale = Number(m[2]);
      if (!byScale.has(scale)) {
        byScale.set(scale, m[1]);
      }
    }
    // Prefer 2x for a crisp render at native size without over-fetching;
    // fall back to whatever's actually available otherwise.
    const preferredScale = byScale.has(2) ? 2 : byScale.has(1) ? 1 : byScale.has(4) ? 4 : [...byScale.keys()][0];
    const url = preferredScale !== undefined ? byScale.get(preferredScale) : undefined;
    if (!url || preferredScale === undefined) {
      continue;
    }

    const dims = body.match(DIMENSION_RE);
    const width = dims ? Number(dims[2]) : DEFAULT_SIZE;
    const height = dims ? Number(dims[1]) : DEFAULT_SIZE;

    emotes.set(name, {
      uri: new URL(url.replace(/^\.\//, ''), `${base}/`).toString(),
      width,
      height,
      scale: preferredScale,
    });
  }
  let animatedCount = 0;
  for (const m of css.matchAll(ANIM_META_RE)) {
    const [, name, width, height, durationValue, durationUnit, frameCount, iterations] = m;
    const emote = emotes.get(name);
    if (!emote) {
      continue;
    }
    const durationMs = durationUnit === 's' ? Number(durationValue) * 1000 : Number(durationValue);
    // The per-frame dimensions here are authoritative for animated emotes —
    // the compound-selector rule for these usually has no width/height of
    // its own at all (falls back to DEFAULT_SIZE), since sizing is meant to
    // come from this rule instead.
    emote.width = Number(width);
    emote.height = Number(height);
    emote.animation = { frameCount: Number(frameCount), durationMs, iterations: Number(iterations) };
    animatedCount++;
  }

  log.info(`fetched ${emotes.size} emotes from network (${animatedCount} animated)`);
  await writeCache(emotes);
  return emotes;
}

// Cached for the app's lifetime — emotes.<hash>.css only changes on a
// chat-gui deploy, not worth refetching per chat session.
export function loadEmoteIndex(): Promise<Map<string, EmoteInfo>> {
  if (!cache) {
    cache = load().catch(err => {
      log.warn('failed to load emote index', err);
      cache = null;
      return new Map<string, EmoteInfo>();
    });
  }
  return cache;
}

// For Settings' "Emotes last updated" label — reads the persisted
// timestamp directly rather than going through loadEmoteIndex()/cache, so
// checking it never triggers a network fetch itself.
export async function getEmoteIndexUpdatedAt(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return (JSON.parse(raw) as StoredIndex).fetchedAt;
  } catch {
    return null;
  }
}

// The only way the emote index (and, via refreshEmoteFrames, the cropped
// frame cache) ever gets refetched — wired to Settings' "Refresh emotes"
// button. Clears the persisted cache and forces a fresh network fetch,
// bypassing readCache entirely.
export async function refreshEmoteIndex(): Promise<Map<string, EmoteInfo>> {
  await AsyncStorage.removeItem(STORAGE_KEY);
  cache = null;
  return loadEmoteIndex();
}
