import { DEFAULT_CONFIG, JWT_COOKIE_NAME } from '../config/env';
import type { HistoryResponse, MeResponse, ViewerState } from './types';

function cookieHeader(jwt: string): Record<string, string> {
  return { Cookie: `${JWT_COOKIE_NAME}=${jwt}` };
}

// The history endpoint has been seen taking 9-14s; past this a request is
// treated as failed so the caller's retry can take over.
const REQUEST_TIMEOUT_MS = 15000;

async function getJSON<T>(path: string, jwt: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${DEFAULT_CONFIG.apiUri}${path}`, {
      headers: cookieHeader(jwt),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`GET ${path} failed: ${response.status}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
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
