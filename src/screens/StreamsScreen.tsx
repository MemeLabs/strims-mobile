import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Image,
  Linking,
  Modal,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import GoogleCast, { CastButton, useRemoteMediaClient } from 'react-native-google-cast';
import { viewerChannelColor } from '../chat/viewerColor';
import { fetchStreamList } from '../streams/api';
import { ANGELTHUMP_REGIONS, resolveAngelThumpHls } from '../streams/hlsResolver';
import { followKey, loadFollows, toggleFollow } from '../streams/follows';
import { ensureNotificationPermission } from '../streams/notifications';
import { checkForNewlyLiveFollows } from '../streams/liveTracking';
import { DEFAULT_CONFIG } from '../config/env';
import { makeLogger } from '../log';
import type { Stream } from '../streams/types';

const log = makeLogger('streams-screen');

// Matches strims-live-extension's default refresh cadence
// (Background.js startPolling, default 2 minutes).
const POLL_INTERVAL_MS = 2 * 60 * 1000;

function sortStreams(streams: Stream[]): Stream[] {
  // rustlers (strims-side viewer count) is what the extension sorts and
  // displays by, not the raw upstream `viewers` count.
  return [...streams].sort((a, b) => b.rustlers - a.rustlers);
}

// The classic Chromecast glyph — a screen outline with wifi-style signal
// arcs in the bottom-left corner — built from plain Views rather than an
// icon font/SVG library, since CastButton's native tap handling can't be
// intercepted for our per-card resolve-then-load flow (see onCast above),
// so we can't reuse its built-in icon.
// `active` (currently casting) fills the screen solid instead of just
// outlining it — same convention the real Cast icon uses to distinguish
// "connected/casting" from "idle".
function ChromecastIcon({ color, active }: { color: string; active?: boolean }) {
  return (
    <View style={styles.castIconBox}>
      <View
        style={[styles.castIconScreen, { borderColor: color }, active && { backgroundColor: color }]}
      />
      <View
        style={[styles.castIconArc, styles.castIconArcOuter, { borderBottomColor: color, borderLeftColor: color }]}
      />
      <View
        style={[styles.castIconArc, styles.castIconArcInner, { borderBottomColor: color, borderLeftColor: color }]}
      />
      <View style={[styles.castIconDot, { backgroundColor: color }]} />
    </View>
  );
}

interface StreamCardProps {
  stream: Stream;
  following: boolean;
  onToggleFollow: (stream: Stream) => void;
  onCast: (stream: Stream) => void;
  casting: boolean;
  castActive: boolean;
}

function StreamCard({ stream, following, onToggleFollow, onCast, casting, castActive }: StreamCardProps) {
  const onPress = () => {
    Linking.openURL(`${DEFAULT_CONFIG.rustlaUrl}${stream.url}`);
  };
  // The cast HLS-resolution trick (see streams/hlsResolver.ts) is only
  // known to work for AngelThump — no equivalent has been found for other
  // services, so the button only appears where it can actually work.
  const canCast = stream.service === 'angelthump';
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      <Image source={{ uri: stream.thumbnail }} style={styles.thumbnail} resizeMode="cover" />
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
        <Text style={styles.viewers}>{stream.rustlers.toLocaleString()} watching</Text>
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

export default function StreamsScreen() {
  const [streams, setStreams] = useState<Stream[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [follows, setFollows] = useState<Set<string>>(new Set());
  const [castingKey, setCastingKey] = useState<string | null>(null);
  // The stream a region picker is currently showing for — set on cast tap,
  // cleared once a region's picked (or the picker's dismissed). Only the
  // "start casting" path needs this; stopping an active cast bypasses it.
  const [regionPickerStream, setRegionPickerStream] = useState<Stream | null>(null);
  // Which stream is actively loaded on the connected Cast device (distinct
  // from castingKey, which is only true transiently while resolving/
  // sending the load command) — drives the "currently casting" icon state
  // and lets a second tap stop it instead of reloading.
  const [activeCastKey, setActiveCastKey] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const client = useRemoteMediaClient();
  // A cast tap can happen before a device is connected yet (the user picks
  // one from the dialog we open) — stash what to load once the session
  // comes up, since `client` only becomes non-null after that happens.
  const pendingCast = useRef<{ hlsUrl: string; stream: Stream } | null>(null);

  useEffect(() => {
    loadFollows().then(setFollows);
  }, []);

  // The sender-side loadMedia() promise only confirms the receiver *got*
  // the command, not that playback actually started — surfacing real
  // player-state changes (and any idleReason on failure) needs this
  // separate subscription.
  useEffect(() => {
    if (!client) {
      // Session ended (disconnected/stopped from the device side, e.g. the
      // Cast notification's stop button) — nothing is casting anymore.
      setActiveCastKey(null);
      return;
    }
    const sub = client.onMediaStatusUpdated(status => {
      log.info(`media status: playerState=${status?.playerState} idleReason=${status?.idleReason ?? 'none'}`);
      if (status?.playerState === 'idle') {
        setActiveCastKey(null);
      }
    });
    return () => sub.remove();
  }, [client]);

  const loadMediaOnClient = async (hlsUrl: string, stream: Stream) => {
    log.info(`loading media: ${hlsUrl}`);
    await client!.loadMedia({
      mediaInfo: {
        contentUrl: hlsUrl,
        contentType: 'application/x-mpegURL',
        streamType: 'live',
        // AngelThump serves fMP4/CMAF segments (.m4s + an EXT-X-MAP init
        // segment), not classic MPEG2-TS. The Default Media Receiver needs
        // this hint to decode fMP4 HLS — without it, loadMedia is
        // acknowledged but the receiver silently never actually plays
        // anything (no error surfaced back to the sender at all).
        hlsVideoSegmentFormat: 'FMP4',
        metadata: { type: 'generic', title: stream.title, images: [{ url: stream.thumbnail }] },
      },
    });
    setActiveCastKey(followKey(stream.service, stream.channel));
  };

  useEffect(() => {
    if (client && pendingCast.current) {
      const { hlsUrl, stream } = pendingCast.current;
      pendingCast.current = null;
      loadMediaOnClient(hlsUrl, stream).catch(err => log.warn('failed to load media on cast device', err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

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
    } catch (err) {
      log.warn('failed to load stream list', err);
      setError('Failed to load streams');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const onCast = async (stream: Stream) => {
    const key = followKey(stream.service, stream.channel);

    if (key === activeCastKey && client) {
      try {
        await client.stop();
        setActiveCastKey(null);
      } catch (err) {
        log.warn(`failed to stop casting ${stream.channel}`, err);
      }
      return;
    }

    setRegionPickerStream(stream);
  };

  // Called once a region's been picked (see the Modal below) — the actual
  // resolve-and-load, previously the second half of onCast.
  const onConfirmCastRegion = async (stream: Stream, regionCode: string) => {
    setRegionPickerStream(null);
    const key = followKey(stream.service, stream.channel);
    setCastingKey(key);
    try {
      const hlsUrl = await resolveAngelThumpHls(stream.channel, regionCode);
      log.info(`resolved ${stream.channel} (${regionCode}) -> ${hlsUrl}`);
      if (client) {
        await loadMediaOnClient(hlsUrl, stream);
      } else {
        pendingCast.current = { hlsUrl, stream };
        await GoogleCast.showCastDialog();
      }
    } catch (err) {
      log.warn(`failed to cast ${stream.channel}`, err);
    } finally {
      setCastingKey(null);
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
    <>
      {/* Android's Cast SDK requires at least one CastButton mounted
          somewhere for showCastDialog() to work — this one is invisible;
          our own cast icon per-card drives the actual UI. */}
      <CastButton style={styles.hiddenCastButton} />
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
              onCast={onCast}
              casting={castingKey === key}
              castActive={activeCastKey === key}
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
      <Modal visible={regionPickerStream !== null} transparent animationType="fade" onRequestClose={() => setRegionPickerStream(null)}>
        <TouchableOpacity
          style={styles.regionPickerBackdrop}
          activeOpacity={1}
          onPress={() => setRegionPickerStream(null)}
        >
          <View style={styles.regionPickerCard}>
            <Text style={styles.regionPickerTitle}>Cast from</Text>
            {ANGELTHUMP_REGIONS.map(region => (
              <TouchableOpacity
                key={region.code}
                style={styles.regionOption}
                onPress={() => regionPickerStream && onConfirmCastRegion(regionPickerStream, region.code)}
              >
                <Text style={styles.regionOptionText}>{region.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.regionCancel} onPress={() => setRegionPickerStream(null)}>
              <Text style={styles.regionCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
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
  regionPickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  regionPickerCard: {
    backgroundColor: '#1c1d24',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    width: 220,
  },
  regionPickerTitle: {
    color: '#8291b2',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: 8,
  },
  regionOption: {
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#2a2b33',
  },
  regionOptionText: { color: '#fff', fontSize: 16, textAlign: 'center' },
  regionCancel: {
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#2a2b33',
    marginTop: 4,
  },
  regionCancelText: { color: '#e45e07', fontSize: 15, fontWeight: '600', textAlign: 'center' },
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
  hiddenCastButton: { width: 0, height: 0 },
  // Taller box with a shorter screen than earlier attempts, specifically so
  // the arcs below (up to 9px tall) have clearance to sit under the screen
  // without overlapping it — that overlap was the bug in earlier attempts.
  castIconBox: { width: 22, height: 20 },
  castIconScreen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 11,
    borderWidth: 1.5,
    borderRadius: 2,
  },
  castIconDot: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: 3,
    height: 3,
    borderRadius: 1.5,
  },
  // Standard wifi-icon CSS trick: a circle with only its bottom+left border
  // colored (rest transparent) — that quadrant's visible stroke passes
  // right through the bounding box's bottom-left corner, so anchoring the
  // box at the same corner as the dot makes the arc read as radiating from
  // it, bowing up and to the right.
  castIconArc: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    borderColor: 'transparent',
    borderRadius: 50,
  },
  castIconArcOuter: { width: 9, height: 9, borderBottomWidth: 1.3, borderLeftWidth: 1.3 },
  castIconArcInner: { width: 5, height: 5, borderBottomWidth: 1.3, borderLeftWidth: 1.3 },
});
