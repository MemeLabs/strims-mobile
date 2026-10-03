import { parseFrame } from './frame';
import type { ChatMessage } from './types';

export const MAX_MESSAGES = 200;

export function decodeHistory(lines: string[]): ChatMessage[] {
  return lines
    .map(line => parseFrame(line))
    .filter((frame): frame is { event: string; data: ChatMessage } => frame.event === 'MSG')
    .map(frame => frame.data);
}

// History is authoritative up to its newest message. Anything newer in
// `current` arrived live while the fetch was in flight and is kept; older
// entries (including saved scrollback from the last session) are replaced.
export function mergeHistory(history: ChatMessage[], current: ChatMessage[]): ChatMessage[] {
  if (history.length === 0) {
    return current;
  }
  const newest = history[history.length - 1].timestamp;
  return [...history, ...current.filter(m => m.timestamp > newest)].slice(-MAX_MESSAGES);
}
