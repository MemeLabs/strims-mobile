import AsyncStorage from '@react-native-async-storage/async-storage';
import { makeLogger } from '../log';
import { followKey } from './follows';
import { notifyStreamLive } from './notifications';
import type { Stream } from './types';

const log = makeLogger('live-tracking');

// Persisted (not just kept in a component ref) because this needs to be
// read/written by three independent call sites that don't share JS state:
// the foreground poll (StreamsScreen), the background-fetch task while the
// app is backgrounded, and the Android headless task, which runs in its own
// JS context after the app has been fully terminated. Without a shared,
// persisted view of "what was live last time anyone checked", those paths
// could each notify independently for the same transition, or miss one
// that happened between whichever two checked most recently.
const STORAGE_KEY = 'gg.strims.mobile.previously-live';

async function loadPreviouslyLive(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch (err) {
    log.warn('failed to load previously-live state', err);
    return new Set();
  }
}

async function savePreviouslyLive(keys: Set<string>): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...keys]));
  } catch (err) {
    log.warn('failed to persist previously-live state', err);
  }
}

// Diffs an already-fetched stream list against the persisted previously-live
// snapshot, notifies for any followed channel that just transitioned into
// being live, and updates the snapshot. Takes the list rather than fetching
// it itself so the foreground poll (StreamsScreen) can reuse the same fetch
// it needs for rendering — the background-fetch task (backgroundFetch.ts),
// which has no UI to feed, fetches its own list and passes it in here too.
export async function checkForNewlyLiveFollows(list: Stream[], follows: Set<string>): Promise<Stream[]> {
  const previouslyLive = await loadPreviouslyLive();

  const nowLive = new Set(list.map(s => followKey(s.service, s.channel)));
  const newlyLive: Stream[] = [];
  for (const stream of list) {
    const key = followKey(stream.service, stream.channel);
    if (follows.has(key) && !previouslyLive.has(key)) {
      newlyLive.push(stream);
    }
  }

  await savePreviouslyLive(nowLive);
  for (const stream of newlyLive) {
    await notifyStreamLive(stream);
  }
  return newlyLive;
}
