import type { EmoteInfo } from './emotes';
import type { ChatMessage } from './types';

// Port of chat-gui's combo behavior (chat.js onMSG + addMessage): when
// consecutive messages are each *only* a single known emote and match the
// previous one, they collapse into one row with an "xN" counter instead of
// repeating the same emote line over and over. A lone emote message (no
// repeat) still renders as a normal chat line with nick attribution — only
// 2+ in a row collapse.
export interface ComboGroup {
  key: string;
  emoteName: string;
  count: number;
}

export type DisplayItem =
  | { type: 'message'; key: string; message: ChatMessage; continued: boolean }
  | ({ type: 'combo' } & ComboGroup);

export function groupCombos(messages: ChatMessage[], emotes: Map<string, EmoteInfo>): DisplayItem[] {
  const result: DisplayItem[] = [];

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const text = message.data.trim();
    const isEmoteOnly = emotes.has(text);
    const prev = result[result.length - 1];

    if (isEmoteOnly && prev?.type === 'combo' && prev.emoteName === text) {
      prev.count += 1;
      continue;
    }
    if (isEmoteOnly && prev?.type === 'message' && prev.message.data.trim() === text && emotes.has(text)) {
      result[result.length - 1] = { type: 'combo', key: prev.key, emoteName: text, count: 2 };
      continue;
    }

    // Same-user consecutive messages (chat-gui's "msg-continue") collapse
    // the repeated nick/bar into a lighter continuation row — only applies
    // right after another plain message from the same nick, not after a
    // combo row breaks the run.
    const continued = prev?.type === 'message' && prev.message.nick.toLowerCase() === message.nick.toLowerCase();

    result.push({ type: 'message', key: `${message.timestamp}-${message.nick}-${i}`, message, continued });
  }

  return result;
}
