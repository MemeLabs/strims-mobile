import AsyncStorage from '@react-native-async-storage/async-storage';
import { makeLogger } from '../log';

const log = makeLogger('follows');

const STORAGE_KEY = 'gg.strims.mobile.followed-streams';

export function followKey(service: string, channel: string): string {
  return `${service}/${channel}`;
}

export async function loadFollows(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch (err) {
    log.warn('failed to load follows', err);
    return new Set();
  }
}

export function toggleFollow(follows: Set<string>, key: string): Set<string> {
  const next = new Set(follows);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...next])).catch(err =>
    log.warn('failed to persist follows', err),
  );
  return next;
}
