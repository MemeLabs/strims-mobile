import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Image,
  Linking,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { viewerChannelColor } from '../chat/viewerColor';
import { fetchAngelThumpStartTimes, fetchStreamList } from '../streams/api';
import { useCast } from '../streams/cast';
import { followKey, loadFollows, toggleFollow } from '../streams/follows';
import { ensureNotificationPermission } from '../streams/notifications';
import { checkForNewlyLiveFollows } from '../streams/liveTracking';
import { canPlayInApp } from '../components/StreamPlayer';
import ChromecastIcon from '../components/ChromecastIcon';
import { DEFAULT_CONFIG } from '../config/env';
import { makeLogger } from '../log';
import type { Stream } from '../streams/types';

const log = makeLogger('streams-screen');

// Matches strims-live-extension's default refresh cadence
// (Background.js startPolling, default 2 minutes).
const POLL_INTERVAL_MS = 2 * 60 * 1000;

// Thumbnail URLs are stable per channel (e.g.
// thumbnail.angelthump.com/thumbnails/batpearson.jpeg) — same URL every
// poll — so without a cache-buster, Image would happily keep showing
// whatever frame it first cached instead of ever fetching a newer one.
// Deliberately no dedicated timer for this: the bucket below is just
// computed fresh at render time, so it only ever advances as a side effect
// of the screen re-rendering while the user's actually looking at it (e.g.
// the existing 2-minute poll) — nothing keeps ticking or fetching in the
// background just to keep thumbnails warm.
const THUMBNAIL_TTL_MS = 30 * 60 * 1000;

function withThumbnailCacheBust(url: string): string {
  const bucket = Math.floor(Date.now() / THUMBNAIL_TTL_MS);
  return `${url}${url.includes('?') ? '&' : '?'}_=${bucket}`;
}

function sortStreams(streams: Stream[]): Stream[] {
  // rustlers (strims-side viewer count) is what the extension sorts and
  // displays by, not the raw upstream `viewers` count.
  return [...streams].sort((a, b) => b.rustlers - a.rustlers);
}

// "Live for" — days/hours truncated (not rounded), matching how every other
// "time ago" style label on the site behaves. Below an hour, minutes alone
// are precise enough that seconds would just be noise.
function formatUptime(startTime: number): string {
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - startTime) / 60000));
  const days = Math.floor(elapsedMinutes / 1440);
  const hours = Math.floor((elapsedMinutes % 1440) / 60);
  const minutes = elapsedMinutes % 60;
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

interface StreamCardProps {
  stream: Stream;
  following: boolean;
  onToggleFollow: (stream: Stream) => void;
  onCast: (stream: Stream) => void;
  onPlay: (stream: Stream) => void;
  casting: boolean;
  castActive: boolean;
  // AngelThump-only (see fetchAngelThumpStartTimes) — no other service this
  // app lists exposes a public per-stream start time.
  liveSince?: number;
}

function StreamCard({ stream, following, onToggleFollow, onCast, onPlay, casting, castActive, liveSince }: StreamCardProps) {
  const openInBrowser = () => {
    Linking.openURL(`${DEFAULT_CONFIG.rustlaUrl}${stream.url}`);
  };
  // The cast HLS-resolution trick (see streams/hlsResolver.ts) is only
  // known to work for AngelThump — no equivalent has been found for other
  // services, so the button only appears where it can actually work.
  const canCast = stream.service === 'angelthump';
  return (
    <TouchableOpacity
      style={styles.card}
      // Twitch and AngelThump play in the app; long-press (or any other
      // service) opens the strims.gg page instead.
      onPress={() => (canPlayInApp(stream) ? onPlay(stream) : openInBrowser())}
      onLongPress={openInBrowser}
      activeOpacity={0.8}
    >
      <Image source={{ uri: withThumbnailCacheBust(stream.thumbnail) }} style={styles.thumbnail} resizeMode="cover" />
      <View style={styles.cardMeta}>
        <Text style={styles.title} numberOfLines={1}>
          {stream.title}
        </Text>
        {/* Same color a viewer's nick gets tagged with in chat while
            watching this stream (see viewerColor.ts) — lets you spot at a
            glance what color someone's name will show up as. */}
        <Text style={styles.channel} numberOfLines={1}>
          <Text style={{ color: viewerChannelColor({ channel: stream.channel, service: stream.service }) }}>
            {stream.channel}
          </Text>{' '}
          · {stream.service}
        </Text>
        <Text style={styles.viewers}>
          {stream.rustlers.toLocaleString()} watching{liveSince !== undefined ? ` · live for ${formatUptime(liveSince)}` : ''}
        </Text>
      </View>
      {stream.nsfw && (
        <View style={styles.nsfwBadge}>
          <Text style={styles.nsfwBadgeText}>NSFW</Text>
        </View>
      )}
      <View style={styles.cardActions}>
        {canCast && (
          <TouchableOpacity
            style={styles.actionButton}
            onPress={e => {
              e.stopPropagation();
              onCast(stream);
            }}
            disabled={casting}
          >
            {casting ? (
              <Text style={styles.actionIcon}>…</Text>
            ) : (
              <ChromecastIcon color="#e45e07" active={castActive} />
            )}
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.actionButton}
          onPress={e => {
            e.stopPropagation();
            onToggleFollow(stream);
          }}
        >
          <Text style={[styles.actionIcon, following && styles.actionIconActive]}>{following ? '★' : '☆'}</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

interface Props {
  onPlay: (stream: Stream) => void;
}

export default function StreamsScreen({ onPlay }: Props) {
  const [streams, setStreams] = useState<Stream[]>([]);
  const [angelThumpStartTimes, setAngelThumpStartTimes] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [follows, setFollows] = useState<Set<string>>(new Set());
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const { castingKey, activeCastKey, toggleCast } = useCast();

  useEffect(() => {
    loadFollows().then(setFollows);
  }, []);

  const load = useCallback(async (isRefresh: boolean) => {
    if (isRefresh) {
      setRefreshing(true);
    }
    try {
      const list = await fetchStreamList();
      setStreams(sortStreams(list));
      setError(null);
      // Shared with the background-fetch task (see streams/backgroundFetch.ts)
      // — both read/write the same persisted "previously live" snapshot, so
      // a channel going live while the app is backgrounded doesn't also
      // re-notify the moment the app comes back to the foreground and polls.
      await checkForNewlyLiveFollows(list, follows);
      // Only worth the extra request if there's actually an AngelThump card
      // to show "live for" on. A failure here shouldn't blank out uptime on
      // cards that already had it from a previous successful poll, so it's
      // a separate try/catch rather than folding into the block above.
      if (list.some(s => s.service === 'angelthump')) {
        try {
          setAngelThumpStartTimes(await fetchAngelThumpStartTimes());
        } catch (err) {
          log.warn('failed to load AngelThump start times', err);
        }
      }
    } catch (err) {
      log.warn('failed to load stream list', err);
      setError('Failed to load streams');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [follows]);

  const startPolling = useCallback(() => {
    if (pollTimer.current) {
      return;
    }
    pollTimer.current = setInterval(() => load(false), POLL_INTERVAL_MS);
  }, [load]);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  useEffect(() => {
    load(false);
    startPolling();
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  // Backgrounded: stop polling — react-native-background-fetch's periodic
  // task (~15min floor, see backgroundFetch.ts) covers the "did a followed
  // channel go live" case while we're not in the foreground; a 2-minute
  // poll timer serves no purpose there and just costs battery. Foreground:
  // resume and refresh immediately rather than waiting out whatever's left
  // of the interval, so the list isn't stale from however long we were away.
  useEffect(() => {
    const sub = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') {
        stopPolling();
        load(false);
        startPolling();
      } else {
        stopPolling();
      }
    });
    return () => sub.remove();
  }, [load, startPolling, stopPolling]);

  const onToggleFollow = async (stream: Stream) => {
    const key = followKey(stream.service, stream.channel);
    const wasFollowing = follows.has(key);
    setFollows(prev => toggleFollow(prev, key));
    if (!wasFollowing) {
      await ensureNotificationPermission();
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#8291b2" />
      </View>
    );
  }

  if (error && streams.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => load(false)}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      data={streams}
      keyExtractor={s => followKey(s.service, s.channel)}
      renderItem={({ item }) => {
        const key = followKey(item.service, item.channel);
        return (
          <StreamCard
            stream={item}
            following={follows.has(key)}
            onToggleFollow={onToggleFollow}
            onCast={toggleCast}
            onPlay={onPlay}
            casting={castingKey === key}
            castActive={activeCastKey === key}
            liveSince={item.service === 'angelthump' ? angelThumpStartTimes.get(item.channel.toLowerCase()) : undefined}
          />
        );
      }}
      contentContainerStyle={styles.listContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor="#e45e07" />}
      ListEmptyComponent={
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No one's streaming right now</Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#15161c' },
  centered: { flex: 1, backgroundColor: '#15161c', alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { color: '#5c6273', fontSize: 14 },
  errorText: { color: '#e0c080', fontSize: 14, marginBottom: 12 },
  retryButton: {
    backgroundColor: '#e45e07',
    borderRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  retryButtonText: { color: '#fff', fontWeight: '600' },
  listContent: { padding: 8 },
  card: {
    flexDirection: 'row',
    backgroundColor: '#1c1e27',
    borderRadius: 8,
    marginBottom: 8,
    overflow: 'hidden',
  },
  thumbnail: { width: 130, height: 84, backgroundColor: '#262833' },
  cardMeta: { flex: 1, padding: 10, justifyContent: 'center', gap: 4 },
  title: { color: '#e45e07', fontSize: 15, fontWeight: '700' },
  channel: { color: '#e0a370', fontSize: 13, fontStyle: 'italic' },
  viewers: { color: '#e0a370', fontSize: 13 },
  nsfwBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: '#c0392b',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  nsfwBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  cardActions: { justifyContent: 'space-evenly', alignItems: 'center', paddingHorizontal: 10 },
  actionButton: { padding: 4 },
  actionIcon: { fontSize: 18, color: '#5c6273' },
  actionIconActive: { color: '#e45e07' },
});
