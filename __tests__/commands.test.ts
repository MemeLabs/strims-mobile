import { parseWhisper } from '../src/chat/commands';

describe('parseWhisper', () => {
  it.each(['w', 'whisper', 'msg', 'tell', 't', 'notify', 'W'])('treats /%s as a whisper', cmd => {
    expect(parseWhisper(`/${cmd} Bob hey there`)).toEqual({ nick: 'Bob', data: 'hey there' });
  });

  it('keeps the rest of the message intact, including newlines', () => {
    expect(parseWhisper('/w bob line one\nline two')).toEqual({ nick: 'bob', data: 'line one\nline two' });
  });

  it('does not treat a whisper with no message as sendable', () => {
    expect(parseWhisper('/w bob')).toBeNull();
    expect(parseWhisper('/w bob   ')).toBeNull();
  });

  it('leaves ordinary messages and other commands alone', () => {
    expect(parseWhisper('w bob hi')).toBeNull();
    expect(parseWhisper('/me waves')).toBeNull();
    expect(parseWhisper('/wave bob hi')).toBeNull();
  });
});
