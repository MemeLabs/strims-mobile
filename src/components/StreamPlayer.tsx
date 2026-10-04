import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Video from 'react-native-video';
import WebView from 'react-native-webview';
import ChromecastIcon from './ChromecastIcon';
import { useCast } from '../streams/cast';
import { followKey } from '../streams/follows';
import { resolveAngelThumpHls } from '../streams/hlsResolver';
import type { Stream } from '../streams/types';
import { usePreference } from '../storage/preferences';
import { makeLogger } from '../log';

const log = makeLogger('stream-player');
// media3 PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW.
const BEHIND_LIVE_WINDOW = '21002';

// No LIVE badge over the picture. (react-native-video 6.19's Android player
// ignores the other controlsStyles hide* options, so they aren't set.)
const LIVE_CONTROLS = { hideLiveBadge: true };

// The services that can play inside the app. Anything else on the list
// still opens strims.gg in the browser.
export function canPlayInApp(stream: Stream): boolean {
  return stream.service === 'angelthump' || stream.service === 'twitch';
}

interface Props {
  stream: Stream;
  onClose: () => void;
}

export default function StreamPlayer({ stream, onClose }: Props) {
  const { castingKey, activeCastKey, toggleCast } = useCast();
  const key = followKey(stream.service, stream.channel);
  // Casting works for AngelThump only (see streams/hlsResolver.ts).
  const canCast = stream.service === 'angelthump';
  const castingHere = activeCastKey === key;
  return (
    <View style={styles.container}>
      {castingHere ? (
        // Unmounting the local player stops it, so it isn't playing (and
        // downloading) a second copy behind the TV.
        <View style={styles.centered}>
          <ChromecastIcon color="#e45e07" active />
          <Text style={styles.message}>Playing on Chromecast</Text>
        </View>
      ) : stream.service === 'angelthump' ? (
        <AngelThumpPlayer channel={stream.channel} />
      ) : (
        <TwitchPlayer channel={stream.channel} />
      )}
      <View style={styles.topButtons}>
        {canCast && (
          <TouchableOpacity
            style={styles.roundButton}
            onPress={() => toggleCast(stream)}
            disabled={castingKey === key}
            hitSlop={8}
            accessibilityLabel={castingHere ? 'Stop casting' : 'Cast'}
          >
            {castingKey === key ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <ChromecastIcon color="#fff" active={castingHere} />
            )}
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.roundButton} onPress={onClose} hitSlop={8} accessibilityLabel="Close stream">
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// Native HLS playback (ExoPlayer / AVPlayer) of the manifest the cast flow
// already resolves. The token in that URL is short-lived, so a playback
// error re-resolves once before giving up; Retry starts over.
function AngelThumpPlayer({ channel }: { channel: string }) {
  const region = usePreference('angelThumpRegion');
  const delaySeconds = usePreference('streamDelaySeconds');
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const retriedRef = useRef(false);

  const resolve = useCallback(() => {
    setUri(null);
    setFailed(false);
    resolveAngelThumpHls(channel, region ?? undefined)
      .then(setUri)
      .catch(err => {
        log.warn(`could not resolve ${channel}`, err);
        setFailed(true);
      });
  }, [channel, region]);

  // AngelThump's playlists hold only the last 12s (6 x 2s segments) and the
  // newest segment is often not fully on the edge server yet, so playing at
  // the live edge stalls. ExoPlayer starts `delaySeconds` behind live and
  // nudges playback speed to hold it: never closer than that, and never so
  // far back (10s) that the playlist slides past the playhead, which is a
  // BEHIND_LIVE_WINDOW error. (Android only; AVPlayer has no equivalent.)
  const source = useMemo(() => {
    if (!uri) {
      return null;
    }
    const targetOffsetMs = delaySeconds * 1000;
    return {
      uri,
      bufferConfig: {
        live: { targetOffsetMs, minOffsetMs: targetOffsetMs, maxOffsetMs: Math.max(targetOffsetMs, 10_000) },
      },
    };
  }, [uri, delaySeconds]);
  // Remounts the player on the same URL: a stall that let the playlist slide
  // past the playhead is recovered by starting again at the target delay.
  const [playerKey, setPlayerKey] = useState(0);

  useEffect(() => {
    retriedRef.current = false;
    resolve();
  }, [resolve]);

  if (failed) {
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>Couldn't load this stream</Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => {
            retriedRef.current = false;
            resolve();
          }}
        >
          <Text style={styles.retryText}>↻ Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (!source) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#e45e07" />
      </View>
    );
  }
  return (
    <Video
      key={playerKey}
      source={source}
      style={styles.fill}
      resizeMode="contain"
      controls
      controlsStyles={LIVE_CONTROLS}
      onError={e => {
        log.warn(`playback error for ${channel}: ${e.error.errorString}`);
        if (e.error.errorCode === BEHIND_LIVE_WINDOW) {
          setPlayerKey(k => k + 1);
          return;
        }
        if (retriedRef.current) {
          setFailed(true);
          return;
        }
        retriedRef.current = true;
        resolve();
      }}
    />
  );
}

// Twitch has no native player SDK; its embed player is the supported way
// to play a channel. The embed refuses to load unless the page it's on is
// one of the `parent` domains, so the page is served as if from strims.gg.
function TwitchPlayer({ channel }: { channel: string }) {
  const src = `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=strims.gg&autoplay=true`;
  const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;height:100%;background:#000;overflow:hidden}iframe{border:0;width:100%;height:100%}</style></head><body><iframe src="${src}" allow="autoplay; fullscreen" allowfullscreen></iframe></body></html>`;
  return (
    <WebView
      style={styles.webView}
      source={{ html, baseUrl: 'https://strims.gg' }}
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      // Fullscreen is the app's own landscape layout (see App.tsx).
      allowsFullscreenVideo={false}
      scrollEnabled={false}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  fill: { flex: 1 },
  webView: { flex: 1, backgroundColor: '#000' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10 },
  message: { color: '#c6c9d4', fontSize: 14 },
  retryButton: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: '#262833' },
  retryText: { color: '#e6e8f0', fontSize: 13, fontWeight: '600' },
  topButtons: { position: 'absolute', top: 8, right: 8, flexDirection: 'row', gap: 8 },
  roundButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeText: { color: '#fff', fontSize: 16 },
});
