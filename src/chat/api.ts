import { DEFAULT_CONFIG, JWT_COOKIE_NAME } from '../config/env';
import type { HistoryResponse, MeResponse, ViewerState } from './types';

function cookieHeader(jwt: string): Record<string, string> {
  return { Cookie: `${JWT_COOKIE_NAME}=${jwt}` };
}

async function getJSON<T>(path: string, jwt: string): Promise<T> {
  const response = await fetch(`${DEFAULT_CONFIG.apiUri}${path}`, {
    headers: cookieHeader(jwt),
  });
  if (!response.ok) {
    throw new Error(`GET ${path} failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export function fetchMe(jwt: string): Promise<MeResponse> {
  return getJSON<MeResponse>('/api/chat/me', jwt);
}

export function fetchHistory(jwt: string): Promise<HistoryResponse> {
  return getJSON<HistoryResponse>('/api/chat/history', jwt);
}

export function fetchViewerStates(jwt: string): Promise<ViewerState[]> {
  return getJSON<ViewerState[]>('/api/chat/viewer-states', jwt);
}

/**
 * Called on app open, foreground resume, and after any WS reconnect gap —
 * mirrors chat-gui's boot sequence (`assets/chat.js`) where history is
 * always fetched via REST rather than replayed over the socket.
 */
export async function catchUp(
  jwt: string,
): Promise<{ me: MeResponse; history: HistoryResponse; viewerStates: ViewerState[] }> {
  const [me, history, viewerStates] = await Promise.all([
    fetchMe(jwt),
    fetchHistory(jwt),
    fetchViewerStates(jwt).catch(() => []),
  ]);
  return { me, history, viewerStates };
}
