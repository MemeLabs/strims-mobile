export interface Stream {
  live: boolean;
  nsfw: boolean;
  hidden: boolean;
  afk: boolean;
  promoted: boolean;
  rustlers: number;
  afk_rustlers: number;
  service: string;
  channel: string;
  title: string;
  thumbnail: string;
  url: string;
  viewers: number;
}

export interface StreamListResponse {
  stream_list: Stream[];
}
