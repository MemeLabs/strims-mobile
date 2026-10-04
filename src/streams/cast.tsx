import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import GoogleCast, {
  CastButton,
  MediaHlsVideoSegmentFormat,
  MediaStreamType,
  useRemoteMediaClient,
} from 'react-native-google-cast';
import { followKey } from './follows';
import { ANGELTHUMP_REGIONS, resolveAngelThumpHls } from './hlsResolver';
import { makeLogger } from '../log';
import type { Stream } from './types';

const log = makeLogger('cast');

export interface CastState {
  // followKey of the stream being resolved/sent to the device right now.
  castingKey: string | null;
  // followKey of the stream loaded on the connected Cast device.
  activeCastKey: string | null;
  // Stops the stream if it's the one casting, otherwise asks for a region
  // and casts it.
  toggleCast: (stream: Stream) => void;
}

const CastContext = createContext<CastState | null>(null);

export function useCast(): CastState {
  const cast = useContext(CastContext);
  if (!cast) {
    throw new Error('useCast outside CastProvider');
  }
  return cast;
}

// Owns the Cast session state so the Streams list and the in-app player
// share it: casting from either shows as active in both.
export function CastProvider({ children }: { children: React.ReactNode }) {
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
  const client = useRemoteMediaClient();
  // A cast tap can happen before a device is connected yet (the user picks
  // one from the dialog we open) — stash what to load once the session
  // comes up, since `client` only becomes non-null after that happens.
  const pendingCast = useRef<{ hlsUrl: string; stream: Stream } | null>(null);

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
        streamType: MediaStreamType.LIVE,
        // AngelThump serves fMP4/CMAF segments (.m4s + an EXT-X-MAP init
        // segment), not classic MPEG2-TS. The Default Media Receiver needs
        // this hint to decode fMP4 HLS — without it, loadMedia is
        // acknowledged but the receiver silently never actually plays
        // anything (no error surfaced back to the sender at all).
        hlsVideoSegmentFormat: MediaHlsVideoSegmentFormat.FMP4,
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

  const toggleCast = async (stream: Stream) => {
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

  const onConfirmRegion = async (stream: Stream, regionCode: string) => {
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

  return (
    <CastContext.Provider value={{ castingKey, activeCastKey, toggleCast }}>
      {children}
      {/* Android's Cast SDK requires at least one CastButton mounted
          somewhere for showCastDialog() to work — this one is invisible;
          our own cast icons drive the actual UI. */}
      <CastButton style={styles.hiddenCastButton} />
      <Modal
        visible={regionPickerStream !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setRegionPickerStream(null)}
      >
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
                onPress={() => regionPickerStream && onConfirmRegion(regionPickerStream, region.code)}
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
    </CastContext.Provider>
  );
}

const styles = StyleSheet.create({
  hiddenCastButton: { width: 0, height: 0 },
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
});
