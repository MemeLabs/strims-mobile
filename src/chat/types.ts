export interface ChatUser {
  nick: string;
  features?: string[];
}

export interface ChatMessage {
  nick: string;
  data: string;
  timestamp: number;
}

export interface MeResponse {
  nick: string;
  features?: string[];
  settings?: [string, unknown][];
}

// Each entry is a raw protocol frame string, e.g. `MSG {"nick":...}` —
// decode with parseFrame() before use, same as the live WS stream.
export type HistoryResponse = string[];

export interface ViewerChannel {
  channel: string;
  service: string;
  path: string;
}

export interface ViewerState {
  nick: string;
  online: boolean;
  channel?: ViewerChannel;
}
