import AsyncStorage from '@react-native-async-storage/async-storage';
import { makeLogger } from '../log';
import type { ChatMessage } from './types';

const log = makeLogger('message-cache');

// Last-known messages, persisted so a cold start has something real to
// paint immediately instead of a blank list while catch-up/connect (which
// can take several seconds — REST history fetch + websocket handshake) are
// still in flight. Purely a "smooth over the wait" cache, not a source of
// truth: it's overwritten the moment real catch-up data arrives (see
// useChat.ts), same as the emote index and cropped-frame caches are
// superseded by fresher data rather than merged with it.
const STORAGE_KEY = 'gg.strims.mobile.chat.cached-messages';

export async function loadCachedMessages(): Promise<ChatMessage[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ChatMessage[]) : [];
  } catch (err) {
    log.warn('failed to load cached messages', err);
    return [];
  }
}

export async function saveCachedMessages(messages: ChatMessage[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch (err) {
    log.warn('failed to persist cached messages', err);
  }
}
