import { MAX_MESSAGES, mergeHistory } from '../src/chat/history';
import type { ChatMessage } from '../src/chat/types';

const msg = (timestamp: number, data = `m${timestamp}`): ChatMessage => ({ nick: 'a', data, timestamp });

describe('mergeHistory', () => {
  it('replaces stale saved scrollback with fetched history', () => {
    const cached = [msg(1), msg(2)];
    const history = [msg(10), msg(11)];
    expect(mergeHistory(history, cached)).toEqual(history);
  });

  it('keeps live messages that arrived after the newest history message', () => {
    const history = [msg(10), msg(11)];
    const current = [msg(1), msg(11), msg(12), msg(13)];
    expect(mergeHistory(history, current).map(m => m.timestamp)).toEqual([10, 11, 12, 13]);
  });

  it('keeps what is on screen when history comes back empty', () => {
    const current = [msg(5)];
    expect(mergeHistory([], current)).toBe(current);
  });

  it('caps the result to the newest MAX_MESSAGES', () => {
    const history = Array.from({ length: MAX_MESSAGES }, (_, i) => msg(i));
    const merged = mergeHistory(history, [msg(MAX_MESSAGES)]);
    expect(merged).toHaveLength(MAX_MESSAGES);
    expect(merged[merged.length - 1].timestamp).toBe(MAX_MESSAGES);
    expect(merged[0].timestamp).toBe(1);
  });
});
