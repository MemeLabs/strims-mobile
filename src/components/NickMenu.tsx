import React from 'react';
import { Linking, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { DEFAULT_CONFIG } from '../config/env';
import { viewerChannelColor } from '../chat/viewerColor';
import type { ViewerChannel } from '../chat/types';

interface Props {
  // null hides the menu.
  nick: string | null;
  // Stream they're watching, from viewer states; null if none / unknown.
  watching: ViewerChannel | null;
  nickColor: string | undefined;
  ignored: boolean;
  highlighted: boolean;
  onMention: () => void;
  onWhisper: () => void;
  onToggleIgnore: () => void;
  onToggleHighlight: () => void;
  onSetColor: () => void;
  onDismiss: () => void;
}

// strims.gg page for a viewer state, same as the links batbot posts:
// `path` when the stream has a named page (e.g. "batstream"), else
// service/channel (channel may itself be a URL for "advanced").
function streamPageUrl(watching: ViewerChannel): string {
  const page = watching.path || `${watching.service}/${watching.channel}`;
  return `${DEFAULT_CONFIG.rustlaUrl}/${page}`;
}

function streamLabel(watching: ViewerChannel): string {
  return watching.path || `${watching.service}/${watching.channel}`;
}

export default function NickMenu({
  nick,
  watching,
  nickColor,
  ignored,
  highlighted,
  onMention,
  onWhisper,
  onToggleIgnore,
  onToggleHighlight,
  onSetColor,
  onDismiss,
}: Props) {
  const items: { label: string; onPress: () => void; danger?: boolean }[] = [
    { label: 'Mention', onPress: onMention },
    { label: 'Whisper', onPress: onWhisper },
    { label: highlighted ? 'Stop highlighting' : 'Highlight messages', onPress: onToggleHighlight },
    { label: 'Set name color', onPress: onSetColor },
    { label: ignored ? 'Unignore' : 'Ignore', onPress: onToggleIgnore, danger: !ignored },
  ];
  return (
    <Modal visible={nick !== null} transparent animationType="fade" onRequestClose={onDismiss}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onDismiss}>
        {/* Swallow taps so they don't bubble to the backdrop's onPress */}
        <TouchableOpacity activeOpacity={1} style={styles.card} onPress={() => {}}>
          <Text style={[styles.nick, nickColor ? { color: nickColor } : null]}>{nick}</Text>
          {watching ? (
            <TouchableOpacity
              style={styles.watching}
              onPress={() => {
                onDismiss();
                Linking.openURL(streamPageUrl(watching));
              }}
            >
              <View style={[styles.watchingBar, { backgroundColor: viewerChannelColor(watching) }]} />
              <Text style={styles.watchingText} numberOfLines={1}>
                Watching <Text style={styles.watchingStream}>{streamLabel(watching)}</Text>
              </Text>
              <Text style={styles.watchingOpen}>Open ›</Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.notWatching}>Not watching a stream</Text>
          )}
          {items.map(item => (
            <TouchableOpacity key={item.label} style={styles.item} onPress={item.onPress}>
              <Text style={[styles.itemText, item.danger && styles.itemDanger]}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  card: {
    width: '80%',
    backgroundColor: '#1d1f27',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#333',
    paddingVertical: 8,
  },
  nick: { color: '#fff', fontSize: 17, fontWeight: '700', paddingHorizontal: 16, paddingTop: 8 },
  watching: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  watchingBar: { width: 4, height: 18, borderRadius: 2, marginRight: 8 },
  watchingText: { flex: 1, color: '#999', fontSize: 13 },
  watchingStream: { color: '#e6e8f0', fontWeight: '600' },
  watchingOpen: { color: '#e45e07', fontSize: 13, fontWeight: '600', marginLeft: 8 },
  notWatching: {
    color: '#666',
    fontSize: 13,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  item: { paddingHorizontal: 16, paddingVertical: 12 },
  itemText: { color: '#e6e8f0', fontSize: 15 },
  itemDanger: { color: '#ff6b6b' },
});
