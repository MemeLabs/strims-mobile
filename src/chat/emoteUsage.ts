import AsyncStorage from '@react-native-async-storage/async-storage';
import { makeLogger } from '../log';
import type { EmoteInfo } from './emotes';

const log = makeLogger('emote-usage');

// Lifetime, not per-session — counts every emote the user has sent through
// this app, across restarts, forever (no expiry/refresh, same as the emote
// index and cropped-frame caches). Only ever incremented from onSend in
// ChatScreen — messages from other people, or emotes just seen scrolling
// by, don't count here (see EmotePicker's separate "seen in chat" count for
// that half of the sort).
const STORAGE_KEY = 'gg.strims.mobile.emote-usage-counts';

let cache: Promise<Map<string, number>> | null = null;

async function readCounts(): Promise<Map<string, number>> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? new Map(Object.entries(JSON.parse(raw) as Record<string, number>)) : new Map();
  } catch (err) {
    log.warn('failed to load emote usage counts', err);
    return new Map();
  }
}

async function writeCounts(counts: Map<string, number>): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(counts)));
  } catch (err) {
    log.warn('failed to persist emote usage counts', err);
  }
}

export function loadEmoteUsageCounts(): Promise<Map<string, number>> {
  if (!cache) {
    cache = readCounts();
  }
  return cache;
}

// Called from onSend with the message text as actually sent — tokenizes the
// same way buildSuggestions/formatMessage do (whitespace-split, `:modifier`
// suffix stripped) so a sent "NODDERS:mirror" still counts as one use of
// NODDERS. Every occurrence counts, so "NODDERS NODDERS" in one message
// counts as two.
export async function recordEmoteUsage(text: string, emotes: Map<string, EmoteInfo>): Promise<Map<string, number>> {
  const counts = new Map(await loadEmoteUsageCounts());
  for (const word of text.split(/\s+/)) {
    const [base] = word.split(':');
    if (emotes.has(base)) {
      counts.set(base, (counts.get(base) ?? 0) + 1);
    }
  }
  cache = Promise.resolve(counts);
  await writeCounts(counts);
  return counts;
}
