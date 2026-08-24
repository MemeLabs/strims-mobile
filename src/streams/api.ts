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
