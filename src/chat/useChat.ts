import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import ChatSource from './source';
import { fetchHistory, fetchMe, fetchViewerStates } from './api';
import { loadCachedMessages, saveCachedMessages } from './messageCache';
import { decodeHistory, MAX_MESSAGES, mergeHistory } from './history';
import { parseWhisper } from './commands';
import { DEFAULT_CONFIG } from '../config/env';
import { makeLogger } from '../log';
import type { ChatMessage, ChatUser, ViewerChannel, ViewerState } from './types';

const log = makeLogger('use-chat');

const HISTORY_RETRY_DELAYS_MS = [2000, 5000, 10000, 20000, 30000];

// The whole outage, not just the socket's current attempt: the socket
// flips between connecting/closed on every retry, which used to restart
// the banner timer each time so it never showed.
//  open         — connected
//  connecting   — lost (or not yet up) for < RECONNECTING_AFTER_MS
//  reconnecting — still retrying, shown to the user
//  disconnected — gave up after GIVE_UP_AFTER_MS; reconnect() starts over
export type ConnectionPhase = 'open' | 'connecting' | 'reconnecting' | 'disconnected';

const RECONNECTING_AFTER_MS = 5000;
const GIVE_UP_AFTER_MS = 15000;

export function useChat(jwt: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [me, setMe] = useState<ChatUser | null>(null);
  const [connection, setConnection] = useState<ConnectionPhase>('connecting');
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
  // True once real data (a catch-up response or a live message) has landed
  // — guards the cached-messages load below from clobbering it if that
  // async read resolves after the real thing already arrived.
  const hasRealDataRef = useRef(false);
  const lastAppState = useRef<AppStateStatus>('active');
  // A history fetch has failed and is being retried; what's on screen may be
  // the saved scrollback from the last session.
  const [historyStale, setHistoryStale] = useState(false);
  const outageTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const inOutageRef = useRef(false);

  const clearOutage = useCallback(() => {
    outageTimers.current.forEach(clearTimeout);
    outageTimers.current = [];
    inOutageRef.current = false;
  }, []);

  // Starts the outage clock unless one is already running, so repeated
  // retry failures don't push the deadlines back.
  const startOutage = useCallback(() => {
    if (inOutageRef.current) {
      return;
    }
    inOutageRef.current = true;
    setConnection('connecting');
    outageTimers.current = [
      setTimeout(() => setConnection('reconnecting'), RECONNECTING_AFTER_MS),
      setTimeout(() => {
        log.warn(`no connection after ${GIVE_UP_AFTER_MS}ms, giving up until retried`);
        sourceRef.current?.cancelRetries();
        setConnection('disconnected');
      }, GIVE_UP_AFTER_MS),
    ];
  }, []);

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
    const requestId = ++catchUpRequestId.current;
    const isCurrent = () => requestId === catchUpRequestId.current;

    // Best-effort and independent of history: previously all three went
    // through one Promise.all, so a /me hiccup threw away good history too.
    fetchMe(jwt)
      .then(r => isCurrent() && setMe({ nick: r.nick, features: r.features }))
      .catch(err => log.warn('fetching /me failed', err));
    fetchViewerStates(jwt)
      .then(
        states =>
          isCurrent() &&
          setViewerStates(
            new Map(
              states
                .filter(s => s.online)
                .map(s => [s.nick.toLowerCase(), { nick: s.nick, channel: s.channel ?? null }]),
            ),
          ),
      )
      .catch(err => log.warn('fetching viewer states failed', err));

    // History retries until it lands (or a newer catch-up / backgrounding
    // supersedes this one). A failed fetch used to just log, leaving the
    // saved scrollback from the last session on screen indefinitely with
    // live messages appended after it.
    for (let attempt = 0; ; attempt++) {
      const startedAt = Date.now();
      try {
        const history = decodeHistory(await fetchHistory(jwt));
        if (!isCurrent()) {
          log.info(`discarding stale catch-up response (request ${requestId}, latest is ${catchUpRequestId.current})`);
          return;
        }
        hasRealDataRef.current = true;
        setMessages(prev => mergeHistory(history, prev));
        setHistoryStale(false);
        setCatchUpCount(n => n + 1);
        log.info(`catch-up ok in ${Date.now() - startedAt}ms (${history.length} history messages)`);
        return;
      } catch (err) {
        if (!isCurrent()) {
          return;
        }
        setHistoryStale(true);
        const delay = HISTORY_RETRY_DELAYS_MS[Math.min(attempt, HISTORY_RETRY_DELAYS_MS.length - 1)];
        log.warn(`history fetch failed after ${Date.now() - startedAt}ms, retrying in ${delay}ms`, err);
        await new Promise<void>(resolve => setTimeout(resolve, delay));
        if (!isCurrent()) {
          return;
        }
      }
    }
  }, [jwt]);

  useEffect(() => {
    const source = new ChatSource();
    // The counter object itself, not its value: cleanup bumps it.
    const catchUpRequests = catchUpRequestId;
    sourceRef.current = source;

    source.on('OPEN', () => {
      clearOutage();
      setConnection('open');
    });
    source.on('CLOSE', () => {
      // Deliberate disconnects (backgrounding, giving up, unmount) turn
      // retrying off first; those aren't outages.
      if (source.retryOnDisconnect) {
        startOutage();
      }
    });

    source.on('MSG', (data: ChatMessage) => {
      hasRealDataRef.current = true;
      setMessages(prev => [...prev.slice(-(MAX_MESSAGES - 1)), data]);
    });
    source.on('PRIVMSG', (data: ChatMessage) => {
      hasRealDataRef.current = true;
      setMessages(prev => [...prev.slice(-(MAX_MESSAGES - 1)), data]);
    });
    source.on('VIEWERSTATE', applyViewerState);
    // The server pings, not us (chat-gui's chat.js: `source.on("PING", data
    // => source.send("PONG", data))`) — chat.strims.gg is Cloudflare-proxied
    // (confirmed via response headers), which silently drops idle WebSocket
    // connections after ~100s, so this is almost certainly what keeps the
    // Cloudflare-side connection alive. An earlier client-initiated ping
    // here (which the server never replies to, since it's not the real
    // protocol) was forcing a bogus reconnect roughly every 15s.
    source.on('PING', (data: unknown) => source.send('PONG', data));

    // Reconnecting means we likely missed messages during the gap — refetch
    // history the same way the web client does on initial load.
    source.on('OPEN', () => {
      runCatchUp();
    });

    // Connect the socket immediately rather than waiting on catch-up to
    // finish first — the REST history fetch (several seconds sometimes,
    // unlike the website's own near-instant reload) has no bearing on the
    // websocket handshake; gating one on the other was pure added latency
    // before the first live message could arrive. The 'OPEN' listener above
    // still re-runs catch-up once connected, so history isn't lost — this
    // one and that one just race, and whichever resolves first paints.
    runCatchUp();
    startOutage();
    source.connect(DEFAULT_CONFIG.websocketUri, jwt);

    return () => {
      clearOutage();
      source.stopRetrying();
      // Supersedes any in-flight/retrying history fetch.
      catchUpRequests.current++;
      sourceRef.current = null;
    };
  }, [jwt, runCatchUp, applyViewerState, startOutage, clearOutage]);

  // Paints something real immediately on a cold start instead of a blank
  // list while catch-up/connect (above) are still in flight — see
  // messageCache.ts. Runs once, not per-jwt-change, since this is purely
  // about the very first paint; a login switch gets fresh real data soon
  // enough via the effect above that the stale cache isn't worth reloading.
  useEffect(() => {
    loadCachedMessages().then(cached => {
      if (!hasRealDataRef.current && cached.length > 0) {
        setMessages(cached);
      }
    });
  }, []);

  // Debounced rather than on every single message: a busy chat can add
  // several messages a second, and persisting after each one is wasted
  // I/O when only the latest write ever matters (see loadCachedMessages).
  useEffect(() => {
    if (messages.length === 0) {
      return;
    }
    const id = setTimeout(() => saveCachedMessages(messages), 2000);
    return () => clearTimeout(id);
  }, [messages]);

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
        if (source && !source.isConnected() && !source.isConnecting()) {
          clearOutage();
          startOutage();
          source.reconnect(DEFAULT_CONFIG.websocketUri, jwt);
        }
      } else if (source) {
        // A backgrounded app has no UI to reflect live messages into, so an
        // open socket there is pure cost — RN doesn't suspend a live
        // WebSocket just because the app is backgrounded, meaning it'd sit
        // connected (and, on Android, block full Doze-mode power savings)
        // for however long the OS lets the process live. Disconnecting
        // outright (with retryOnDisconnect off, so the normal reconnect
        // backoff doesn't immediately try to redial while backgrounded) and
        // resuming fresh on foreground — same catch-up path as a cold
        // start — is simpler and cheaper than trying to keep a background
        // connection alive.
        clearOutage();
        source.stopRetrying();
        // No point retrying history in the background; resume restarts it.
        catchUpRequestId.current++;
      }
    };
    const sub = AppState.addEventListener('change', onAppStateChange);
    return () => sub.remove();
  }, [jwt, runCatchUp, startOutage, clearOutage]);

  const sendMessage = useCallback((text: string) => {
    const whisper = parseWhisper(text);
    if (whisper) {
      sourceRef.current?.send('PRIVMSG', whisper);
      return;
    }
    sourceRef.current?.send('MSG', { data: text });
  }, []);

  // The banner's retry button: fresh outage clock, short backoff, dial now.
  const reconnect = useCallback(() => {
    const source = sourceRef.current;
    if (!source) {
      return;
    }
    clearOutage();
    startOutage();
    runCatchUp();
    source.reconnect(DEFAULT_CONFIG.websocketUri, jwt);
  }, [jwt, runCatchUp, startOutage, clearOutage]);

  return {
    messages,
    me,
    connection,
    reconnect,
    sendMessage,
    catchUpCount,
    viewerStates,
    historyStale,
    reloadHistory: runCatchUp,
  };
}
