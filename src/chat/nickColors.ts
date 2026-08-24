import AsyncStorage from '@react-native-async-storage/async-storage';
import { makeLogger } from '../log';

const log = makeLogger('nick-colors');

const COLORS_KEY = 'gg.strims.mobile.nick-colors';
const TOOLTIP_SEEN_KEY = 'gg.strims.mobile.nick-color-tooltip-seen';

export async function loadNickColors(): Promise<Map<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(COLORS_KEY);
    if (!raw) {
      return new Map();
    }
    return new Map(JSON.parse(raw) as [string, string][]);
  } catch (err) {
    log.warn('failed to load nick colors', err);
    return new Map();
  }
}

async function persist(colors: Map<string, string>): Promise<void> {
  try {
    await AsyncStorage.setItem(COLORS_KEY, JSON.stringify([...colors]));
  } catch (err) {
    log.warn('failed to persist nick colors', err);
  }
}

export function setNickColor(colors: Map<string, string>, nick: string, color: string | null): Map<string, string> {
  const next = new Map(colors);
  const key = nick.toLowerCase();
  if (color === null) {
    next.delete(key);
  } else {
    next.set(key, color);
  }
  persist(next);
  return next;
}

export async function hasSeenNickColorTooltip(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(TOOLTIP_SEEN_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function markNickColorTooltipSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(TOOLTIP_SEEN_KEY, '1');
  } catch (err) {
    log.warn('failed to persist tooltip-seen flag', err);
  }
}
