import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { makeLogger } from '../log';

const log = makeLogger('preferences');

export type TimestampFormat = 'off' | 'hm' | 'hms';

export interface Preferences {
  // Off: emotes play chat-gui's finite loop count and rest, as on desktop.
  // On: loop forever, like desktop's hover / "-animate-forever".
  animateEmotesForever: boolean;
  timestampFormat: TimestampFormat;
  // Lowercased nicks whose messages are hidden (nick menu → Ignore).
  ignoredNicks: string[];
}

const DEFAULTS: Preferences = {
  animateEmotesForever: false,
  timestampFormat: 'hm',
  ignoredNicks: [],
};

const STORAGE_KEY = 'gg.strims.mobile.preferences';
// Where animateEmotesForever lived before this module existed.
const LEGACY_ANIMATE_FOREVER_KEY = 'gg.strims.mobile.animate-emotes-forever';

let current: Preferences = DEFAULTS;
const listeners = new Set<(prefs: Preferences) => void>();

function publish(next: Preferences) {
  current = next;
  listeners.forEach(fn => fn(next));
}

const loaded = (async () => {
  try {
    const [raw, legacy] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEY),
      AsyncStorage.getItem(LEGACY_ANIMATE_FOREVER_KEY),
    ]);
    const stored: Partial<Preferences> = raw ? JSON.parse(raw) : {};
    if (legacy !== null) {
      stored.animateEmotesForever ??= legacy === '1';
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ ...DEFAULTS, ...stored }));
      await AsyncStorage.removeItem(LEGACY_ANIMATE_FOREVER_KEY);
    }
    publish({ ...DEFAULTS, ...stored });
  } catch (err) {
    log.warn('failed to load preferences', err);
  }
})();

export async function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): Promise<void> {
  await loaded;
  const next = { ...current, [key]: value };
  publish(next);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (err) {
    log.warn(`failed to persist preference ${key}`, err);
  }
}

export function usePreference<K extends keyof Preferences>(key: K): Preferences[K] {
  const [value, setValue] = useState(current[key]);
  useEffect(() => {
    const listener = (prefs: Preferences) => setValue(prefs[key]);
    // Covers a load that finished between the initial render and this effect.
    listener(current);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [key]);
  return value;
}
