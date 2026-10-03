// chat-gui's whisper command aliases.
const WHISPER_RE = /^\/(?:w|whisper|msg|tell|t|notify)\s+(\S+)\s+(\S[\s\S]*)$/i;

// chat-gui parses whisper commands client-side and sends PRIVMSG; sent raw
// as MSG, "/w nick hi" would be posted to public chat verbatim.
export function parseWhisper(text: string): { nick: string; data: string } | null {
  const m = text.match(WHISPER_RE);
  return m ? { nick: m[1], data: m[2] } : null;
}
