import { DEFAULT_CONFIG } from '../config/env';
import { SUPPORTED_MODIFIERS } from './emoteModifiers';
import type { EmoteInfo } from './emotes';

export type MessageSegment =
  | { type: 'text'; value: string }
  | { type: 'link'; url: string; display: string }
  | { type: 'emote'; name: string; emote: EmoteInfo; modifiers: string[] };

// A pragmatic subset of chat-gui's UrlFormatter regex (assets/chat/js/formatters.js)
// — that one hand-rolls unicode character classes to match IRI hostnames;
// here we cover the common case (scheme:// or www.-prefixed URLs) rather than
// porting the full unicode-aware grammar.
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,!?)\]]/gi;

// Ports of chat-gui/assets/chat/js/formatters.js's UrlFormatter link
// rewrites — same regexes, same display text, so a strims.gg/youtube/etc
// link reads identically here as it does in chat-gui. Matches current
// master (as of "use existing embed rewrite for internal links"), which
// folds strims.gg links into the same embedSubstitutions table as
// youtube/twitch/etc rather than giving them a distinct "Name - Strim"
// label (an earlier, since-reverted approach — see chat-gui git history).
const REF_LINK_RE = /^(https?:\/\/)?(www\.)?(((smile\.)?amazon)|twitter|(open\.)?spotify)\.[a-z]{2,3}/i;

// e.g. youtube ids include "-" and "_".
const EMBED_ID = '([\\w-]{1,30})';
const EMBED_SUBSTITUTIONS: { pattern: RegExp; template: (id: string) => string }[] = [
  // strims.gg links already are embed routes, so the path is the label.
  // Two-segment first, so `angelthump/foo` wins over a bare name.
  { pattern: /strims\.gg\/([a-z0-9_-]+\/[^\s/?#]+)\/?(?:[?#]|$)/i, template: v => v },
  { pattern: /strims\.gg\/([a-z0-9_-]+)\/?(?:[?#]|$)/i, template: v => v },
  { pattern: new RegExp(`twitch\\.tv/videos/${EMBED_ID}`, 'i'), template: v => `twitch-vod/${v}` },
  { pattern: new RegExp(`twitch\\.tv/${EMBED_ID}/?$`, 'i'), template: v => `twitch/${v}` },
  { pattern: new RegExp(`angelthump\\.com/(?:embed/)?${EMBED_ID}$`, 'i'), template: v => `angelthump/${v}` },
  { pattern: new RegExp(`player\\.angelthump\\.com/.*?[&?]channel=${EMBED_ID}`, 'i'), template: v => `angelthump/${v}` },
  { pattern: new RegExp(`youtube\\.com/watch.*?[&?]v=${EMBED_ID}(?:&(?!t)|$| )`, 'i'), template: v => `youtube/${v}` },
  { pattern: new RegExp(`youtu\\.be/${EMBED_ID}(?:&(?!t)|$| )`, 'i'), template: v => `youtube/${v}` },
  { pattern: new RegExp(`youtube\\.com/embed/${EMBED_ID}(?:&(?!t)|$| )`, 'i'), template: v => `youtube/${v}` },
  { pattern: new RegExp(`facebook\\.com/.*?/videos/${EMBED_ID}/?`, 'i'), template: v => `facebook/${v}` },
];

// chat-gui shows two links for a recognized stream/video URL: a visible one
// styled/labelled as the short "service/id" form that opens strims.gg's own
// player (RUSTLA_URL), and an invisible one keeping the real href around for
// hover/right-click. We only get one tappable element, so — like tapping
// that visible link in chat-gui — we point it at the strims.gg player.
function rewriteLink(rawUrl: string): { url: string; display: string } {
  let url = rawUrl;
  if (REF_LINK_RE.test(url)) {
    if (url.includes('?ref')) {
      url = url.split('?ref')[0];
    } else if (url.includes('?si')) {
      url = url.split('?si')[0];
    }
  }

  for (const sub of EMBED_SUBSTITUTIONS) {
    const m = url.match(sub.pattern);
    if (m) {
      const embed = sub.template(m[1]);
      return { url: `${DEFAULT_CONFIG.rustlaUrl}/${embed}`, display: embed };
    }
  }

  return { url, display: url };
}

// chat-gui's GreenTextFormatter: a user message is greentext only if the
// *raw* (unformatted) message starts with '>' — checked against the whole
// message, not per-line, so this only ever applies to the first line.
export function isGreenText(rawMessage: string): boolean {
  return rawMessage.indexOf('>') === 0;
}

// chat-gui's highlight rule (chat.js's regexhighlightself): the current
// user's own messages never highlight, and otherwise it's a plain
// word-boundary, case-insensitive match of their nick anywhere in the text
// — not just when @-mentioned.
export function isMention(rawMessage: string, authorNick: string, selfNick: string | null): boolean {
  if (!selfNick || authorNick.toLowerCase() === selfNick.toLowerCase()) {
    return false;
  }
  const escaped = selfNick.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b(?:${escaped})\\b`, 'i').test(rawMessage);
}

// chat-gui's EmoteFormatter matches emote names as whole words (surrounded
// by start/end of string or whitespace), optionally followed by one or more
// `:modifier` suffixes (e.g. `NODDERS:mirror:fast`) — we only recognize the
// modifiers with a real RN equivalent (see emoteModifiers.ts); anything else
// is silently dropped, same as an unrecognized modifier is a no-op in
// chat-gui.
export function formatMessage(text: string, emotes: Map<string, EmoteInfo>): MessageSegment[] {
  const segments: MessageSegment[] = [];

  for (const word of splitPreservingWhitespace(text)) {
    const [base, ...suffixes] = word.split(':');
    const emote = emotes.get(base);
    if (emote) {
      const modifiers = [...new Set(suffixes)].filter(m => SUPPORTED_MODIFIERS.has(m));
      segments.push({ type: 'emote', name: base, emote, modifiers });
      continue;
    }
    pushWithLinks(segments, word);
  }

  return mergeAdjacentText(segments);
}

function splitPreservingWhitespace(text: string): string[] {
  return text.split(/(\s+)/).filter(s => s.length > 0);
}

function pushWithLinks(segments: MessageSegment[], text: string): void {
  URL_RE.lastIndex = 0;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    const raw = match[0];
    const rawUrl = raw.startsWith('www.') ? `https://${raw}` : raw;
    const { url, display } = rewriteLink(rawUrl);
    segments.push({ type: 'link', url, display });
    lastIndex = match.index + raw.length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }
}

function mergeAdjacentText(segments: MessageSegment[]): MessageSegment[] {
  const merged: MessageSegment[] = [];
  for (const seg of segments) {
    const prev = merged[merged.length - 1];
    if (seg.type === 'text' && prev?.type === 'text') {
      prev.value += seg.value;
    } else {
      merged.push(seg);
    }
  }
  return merged;
}
