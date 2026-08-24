// Port of chat-gui/assets/chat/js/autocomplete.js's word-detection and
// matching logic, adapted for a controlled RN TextInput (no keydown/keypress
// events to hook, no Tab-key cycling — selection happens by tapping a
// suggestion instead).

export interface WordAtCursor {
  start: number;
  end: number;
  word: string;
  useronly: boolean;
}

// Finds the whitespace-delimited word the cursor is currently inside of.
// A leading '@' marks a user-only search and is excluded from the word
// itself (mirrors chat-gui's buildSearchCriteria) so it stays in the text
// untouched when a suggestion is inserted.
export function findWordAtCursor(text: string, cursor: number): WordAtCursor {
  let start = text.lastIndexOf(' ', cursor - 1) + 1;
  let end = text.indexOf(' ', cursor);
  if (end === -1) {
    end = text.length;
  }
  let useronly = false;
  if (text[start] === '@') {
    start += 1;
    useronly = true;
  }
  return { start, end, word: text.slice(start, end), useronly };
}

export interface Suggestion {
  text: string;
  isEmote: boolean;
}

const MIN_WORD_LENGTH = 1;
const MAX_RESULTS = 20;

// Prefix match, case-insensitive, exact matches excluded (nothing to
// complete once you've already typed the whole word) — same rule chat-gui
// uses (`^prefix` regex with the "i" flag).
export function buildSuggestions(word: string, users: string[], emoteNames: string[], useronly: boolean): Suggestion[] {
  if (word.length < MIN_WORD_LENGTH) {
    return [];
  }
  const lower = word.toLowerCase();
  const matches = (candidate: string) => {
    const candidateLower = candidate.toLowerCase();
    return candidateLower !== lower && candidateLower.startsWith(lower);
  };

  const emoteMatches = useronly ? [] : emoteNames.filter(matches).sort((a, b) => a.localeCompare(b));
  const userMatches = users.filter(matches).sort((a, b) => a.localeCompare(b));

  // chat-gui ranks emotes ahead of users (see sortResults in autocomplete.js
  // — the comment there says "second" but the comparator actually puts them
  // first).
  return [
    ...emoteMatches.map(text => ({ text, isEmote: true })),
    ...userMatches.map(text => ({ text, isEmote: false })),
  ].slice(0, MAX_RESULTS);
}

export interface Completion {
  text: string;
  cursor: number;
}

// Replaces the word at [start, end) with the chosen suggestion, adding a
// trailing space if one isn't already there — matches chat-gui's select().
export function applyCompletion(text: string, range: { start: number; end: number }, completion: string): Completion {
  const before = text.slice(0, range.start);
  let after = text.slice(range.end);
  if (after.length === 0 || after[0] !== ' ') {
    after = ' ' + after;
  }
  return {
    text: before + completion + after,
    cursor: before.length + completion.length + 1,
  };
}
