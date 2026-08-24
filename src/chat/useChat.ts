import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import ChatSource from './source';
import { catchUp } from './api';
import { parseFrame } from './frame';
import { DEFAULT_CONFIG } from '../config/env';
import { makeLogger } from '../log';
import type { ChatMessage, ChatUser, ViewerChannel, ViewerState } from './types';

const log = makeLogger('use-chat');

function decodeHistory(lines: string[]): ChatMessage[] {
  return lines
    .map(line => parseFrame(line))
    .filter((frame): frame is { event: string; data: ChatMessage } => frame.event === 'MSG')
    .map(frame => frame.data);
}

const MAX_MESSAGES = 500;

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

export function useChat(jwt: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [me, setMe] = useState<ChatUser | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  // Bumped on every successful catch-up (initial load + every reconnect) so
  // the screen can force-scroll to the latest message. We can't rely on
  // FlatList's onContentSizeChange for this: a reconnect's history batch is
  // often the same length as what's already rendered, so content size may
  // not change even though the messages themselves did.
  const [catchUpCount, setCatchUpCount] = useState(0);
  // Nick (lowercased) -> { nick (original casing), channel they're
  // watching, or null if online but not watching anything }. Absence from
  // the map means "unknown" (never seen a viewer-state for them), which the
  // UI treats the same as null. Keyed lowercase for case-insensitive lookup
  // (bar color, autocomplete matching) while keeping the real casing around
  // for display/insertion.
  const [viewerStates, setViewerStates] = useState<Map<string, { nick: string; channel: ViewerChannel | null }>>(
    new Map(),
  );
  const sourceRef = useRef<ChatSource | null>(null);
  // Guards against overlapping runCatchUp() calls landing out of order —
  // e.g. two catch-ups triggered close together (a real Android AppState
  // quirk fires 'active' more than once for a single foreground event) can
  // resolve in either order given how slow this endpoint sometimes is (we've
  // seen 9-14s). Without this, a stale response arriving after a newer one
  // can overwrite fresher state, and each one also bumps catchUpCount,
  // producing a visible repeated force-scroll ("stuck catching up" loop).
  const catchUpRequestId = useRef(0);
  const lastAppState = useRef<AppStateStatus>('active');

  const applyViewerState = useCallback((state: ViewerState) => {
    const key = state.nick.toLowerCase();
    setViewerStates(prev => {
      const next = new Map(prev);
      if (!state.online) {
        next.delete(key);
      } else {
        next.set(key, { nick: state.nick, channel: state.channel ?? null });
      }
      return next;
    });
  }, []);

  const runCatchUp = useCallback(async () => {
    const startedAt = Date.now();
    const requestId = ++catchUpRequestId.current;
    try {
      const { me: meResponse, history, viewerStates: fetchedViewerStates } = await catchUp(jwt);
      if (requestId !== catchUpRequestId.current) {
        log.info(`discarding stale catch-up response (request ${requestId}, latest is ${catchUpRequestId.current})`);
        return;
      }
      setMe({ nick: meResponse.nick, features: meResponse.features });
      setMessages(decodeHistory(history.slice(-MAX_MESSAGES)));
      setViewerStates(
        new Map(
          fetchedViewerStates
            .filter(s => s.online)
            .map(s => [s.nick.toLowerCase(), { nick: s.nick, channel: s.channel ?? null }]),
        ),
      );
      setCatchUpCount(n => n + 1);
      log.info(`catch-up ok in ${Date.now() - startedAt}ms (${history.length} history lines)`);
    } catch (err) {
      log.warn(`catch-up failed after ${Date.now() - startedAt}ms`, err);
    }
  }, [jwt]);

  useEffect(() => {
    const source = new ChatSource();
    sourceRef.current = source;

    source.on('CONNECTING', () => setStatus('connecting'));
    source.on('OPEN', () => setStatus('open'));
    source.on('CLOSE', () => setStatus('closed'));

    source.on('MSG', (data: ChatMessage) => {
      setMessages(prev => [...prev.slice(-(MAX_MESSAGES - 1)), data]);
    });
    source.on('PRIVMSG', (data: ChatMessage) => {
      setMessages(prev => [...prev.slice(-(MAX_MESSAGES - 1)), data]);
    });
    source.on('VIEWERSTATE', applyViewerState);

    // Reconnecting means we likely missed messages during the gap — refetch
    // history the same way the web client does on initial load.
    source.on('OPEN', () => {
      runCatchUp();
    });

    runCatchUp().finally(() => {
      source.connect(DEFAULT_CONFIG.websocketUri, jwt);
    });

    return () => {
      source.retryOnDisconnect = false;
      source.disconnect();
      sourceRef.current = null;
    };
  }, [jwt, runCatchUp, applyViewerState]);

  useEffect(() => {
    const onAppStateChange = (nextState: AppStateStatus) => {
      log.info(`app state -> ${nextState}`);
      // Android has been observed firing 'active' more than once for a
      // single foreground event — without this guard each duplicate
      // triggers its own catch-up/connect, racing against each other.
      if (nextState === lastAppState.current) {
        return;
      }
      lastAppState.current = nextState;
      const source = sourceRef.current;
      if (nextState === 'active') {
        runCatchUp();
        if (source) {
          if (!source.isConnected() && !source.isConnecting()) {
            source.connect(DEFAULT_CONFIG.websocketUri, jwt);
          } else {
            source.resumeHeartbeat();
          }
        }
      } else {
        source?.pauseHeartbeat();
      }
    };
    const sub = AppState.addEventListener('change', onAppStateChange);
    return () => sub.remove();
  }, [jwt, runCatchUp]);

  const sendMessage = useCallback((text: string) => {
    sourceRef.current?.send('MSG', { data: text });
  }, []);

  return { messages, me, status, sendMessage, catchUpCount, viewerStates };
}
