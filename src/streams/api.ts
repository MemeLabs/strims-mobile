import type { Stream, StreamListResponse } from './types';

// Same endpoint strims-live-extension polls (js/objects/Strims.js) — a
// site-wide "who's watching what" list, not scoped to chat.strims.gg.
const STREAMS_API_URL = 'https://strims.gg/api';

export async function fetchStreamList(): Promise<Stream[]> {
  const response = await fetch(STREAMS_API_URL);
  if (!response.ok) {
    throw new Error(`GET ${STREAMS_API_URL} failed: ${response.status}`);
  }
  const data = (await response.json()) as StreamListResponse;
  return data.stream_list.filter(s => s.live && !s.hidden);
}

const ANGELTHUMP_STREAMS_API_URL = 'https://api.angelthump.com/v3/streams';

interface AngelThumpStream {
  createdAt: string;
  user: { username: string };
}

// strims.gg's own stream list (above) has no start-time field at all, for
// any service — this is a separate, AngelThump-specific API that does, used
// only to add "live for" to AngelThump cards (see StreamsScreen.tsx). No
// equivalent public per-stream start time is available for the other
// services this app lists.
export async function fetchAngelThumpStartTimes(): Promise<Map<string, number>> {
  const response = await fetch(ANGELTHUMP_STREAMS_API_URL);
  if (!response.ok) {
    throw new Error(`GET ${ANGELTHUMP_STREAMS_API_URL} failed: ${response.status}`);
  }
  const list = (await response.json()) as AngelThumpStream[];
  const startTimes = new Map<string, number>();
  for (const s of list) {
    startTimes.set(s.user.username.toLowerCase(), Date.parse(s.createdAt));
  }
  return startTimes;
}
