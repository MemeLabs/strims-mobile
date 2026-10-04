import { useEffect } from 'react';
import { JWT_COOKIE_NAME } from '../config/env';
import { makeLogger } from '../log';
import type { Stream } from './types';

const log = makeLogger('watching');

// strims.gg's own stream page keeps this websocket open (Rustla2's
// api/src/WSService.cpp) and sends `setStream` for the stream on screen.
// Rustla2 ties the socket to the account by the jwt cookie and publishes it
// as that user's viewer state: the colored bar next to their name in chat,
// and the stream's "watching" count. Closing the socket clears both.
const RUSTLA_WS_URL = 'wss://strims.gg/ws';
// Same keepalive as the site: an empty frame every 20s.
const KEEPALIVE_MS = 20_000;
const RETRY_MS = 5_000;

// RN's WebSocket takes handshake headers as a third argument (native sockets
// don't send cookies on their own, see chat/source.ts); the DOM typings
// don't know about it.
type HeaderWebSocket = new (
  url: string,
  protocols: string | string[] | undefined,
  options: { headers: Record<string, string> },
) => WebSocket;
const HeaderWebSocket = WebSocket as unknown as HeaderWebSocket;

// The site's arguments: a custom stream page (strims.gg/batstream) is set by
// its path, anything else as [channel, service].
function setStreamCommand(stream: Stream): string {
  const segments = stream.url.split('/').filter(Boolean);
  const args = segments.length === 1 ? [segments[0]] : [stream.channel, stream.service];
  return JSON.stringify(['setStream', ...args]);
}

// Reports `stream` as what this user is watching for as long as it's set.
export function useWatchingStream(jwt: string | null, stream: Stream | null): void {
  useEffect(() => {
    if (!jwt || !stream) {
      return;
    }
    const command = setStreamCommand(stream);
    let socket: WebSocket | null = null;
    let keepalive: ReturnType<typeof setInterval> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      const ws = new HeaderWebSocket(RUSTLA_WS_URL, undefined, {
        headers: { Cookie: `${JWT_COOKIE_NAME}=${jwt}` },
      });
      socket = ws;
      ws.onopen = () => {
        log.info(`watching ${command}`);
        ws.send(command);
        keepalive = setInterval(() => ws.send(''), KEEPALIVE_MS);
      };
      ws.onmessage = e => {
        if (typeof e.data === 'string' && e.data.startsWith('["ERR"')) {
          log.warn(`setStream rejected: ${e.data}`);
        }
      };
      ws.onclose = () => {
        if (keepalive !== null) {
          clearInterval(keepalive);
          keepalive = null;
        }
        retry = setTimeout(connect, RETRY_MS);
      };
    };
    connect();

    return () => {
      if (retry !== null) {
        clearTimeout(retry);
      }
      if (keepalive !== null) {
        clearInterval(keepalive);
      }
      if (socket) {
        socket.onclose = null;
        socket.onopen = null;
        socket.onmessage = null;
        socket.close();
      }
    };
  }, [jwt, stream]);
}
