import React, { useEffect, useState } from 'react';
import {
  Platform,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { getEmoteIndexUpdatedAt } from '../chat/emotes';
import {
  setPreference,
  usePreference,
  type TimestampFormat,
} from '../storage/preferences';
import pkg from '../../package.json';
import { ANGELTHUMP_SERVER_CHOICES } from '../streams/hlsResolver';

interface Props {
  onClose: () => void;
  onLogout: () => void;
  onRefreshEmotes: () => Promise<void>;
}

function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
}

const TIMESTAMP_OPTIONS: { value: TimestampFormat; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'hm', label: '12:34' },
  { value: 'hms', label: '12:34:56' },
];

const STREAM_DELAY_OPTIONS = [4, 6, 8, 10];

export default function SettingsScreen({
  onClose,
  onLogout,
  onRefreshEmotes,
}: Props) {
  const [refreshing, setRefreshing] = useState(false);
  const animateForever = usePreference('animateEmotesForever');
  const timestampFormat = usePreference('timestampFormat');
  const ignoredNicks = usePreference('ignoredNicks');
  const streamDelaySeconds = usePreference('streamDelaySeconds');
  const angelThumpRegion = usePreference('angelThumpRegion');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    getEmoteIndexUpdatedAt().then(setUpdatedAt);
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefreshEmotes();
      setUpdatedAt(await getEmoteIndexUpdatedAt());
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} hitSlop={12}>
          <Text style={styles.back}>{'‹ Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
        <View style={styles.headerSpacer} />
      </View>
      <View style={styles.content}>
        {/* Emotes are fetched and cropped once, ever, and cached (see
            emotes.ts / emoteFrames.ts) — this row is the only way that
            cache ever gets forced to refresh, so it doubles as the only
            place that matters to show when it last actually happened. */}
        <View style={styles.emotesRow}>
          <Text style={styles.emotesLabel}>
            Emotes last updated: {updatedAt ? formatDate(updatedAt) : '—'}
          </Text>
          <TouchableOpacity
            style={styles.refreshButton}
            onPress={handleRefresh}
            disabled={refreshing}
          >
            <Text style={styles.refreshText}>
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Only the Android (native WebP) emote path has a finite loop
            count to override; the iOS frame path already loops forever. */}
        {Platform.OS === 'android' && (
          <View style={styles.emotesRow}>
            <Text style={styles.emotesLabel}>Animate emotes forever</Text>
            <Switch
              value={animateForever}
              onValueChange={value =>
                setPreference('animateEmotesForever', value)
              }
            />
          </View>
        )}

        <View style={styles.emotesRow}>
          <Text style={styles.emotesLabel}>Timestamps</Text>
          <View style={styles.segmented}>
            {TIMESTAMP_OPTIONS.map(option => {
              const selected = option.value === timestampFormat;
              return (
                <TouchableOpacity
                  key={option.value}
                  style={[styles.segment, selected && styles.segmentSelected]}
                  onPress={() => setPreference('timestampFormat', option.value)}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      selected && styles.segmentTextSelected,
                    ]}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* In-app AngelThump playback only: Twitch's embed player manages
            its own buffering and servers. */}
        <View style={styles.emotesRow}>
          <Text style={styles.emotesLabel}>Stream delay</Text>
          <View style={styles.segmented}>
            {STREAM_DELAY_OPTIONS.map(seconds => {
              const selected = seconds === streamDelaySeconds;
              return (
                <TouchableOpacity
                  key={seconds}
                  style={[styles.segment, selected && styles.segmentSelected]}
                  onPress={() => setPreference('streamDelaySeconds', seconds)}
                >
                  <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{seconds}s</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={[styles.emotesRow, styles.ignoredRow]}>
          <Text style={styles.emotesLabel}>AngelThump server</Text>
          <View style={[styles.segmented, styles.segmentedBelow]}>
            {ANGELTHUMP_SERVER_CHOICES.map(option => {
              const selected = option.code === angelThumpRegion;
              return (
                <TouchableOpacity
                  key={option.label}
                  style={[styles.segment, selected && styles.segmentSelected]}
                  onPress={() => setPreference('angelThumpRegion', option.code)}
                >
                  <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{option.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Ignored users' messages are hidden, so this is the only place to
            find them again. */}
        {ignoredNicks.length > 0 && (
          <View style={[styles.emotesRow, styles.ignoredRow]}>
            <Text style={styles.emotesLabel}>Ignored users</Text>
            <View style={styles.ignoredList}>
              {ignoredNicks.map(nick => (
                <TouchableOpacity
                  key={nick}
                  style={styles.ignoredChip}
                  onPress={() =>
                    setPreference(
                      'ignoredNicks',
                      ignoredNicks.filter(n => n !== nick),
                    )
                  }
                >
                  <Text style={styles.ignoredChipText}>{nick} ✕</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        <TouchableOpacity style={styles.logoutButton} onPress={onLogout}>
          <Text style={styles.logoutText}>Log out</Text>
        </TouchableOpacity>

        <Text style={styles.version}>strims-mobile v{pkg.version}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#15161c' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#121212',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  back: { color: '#e45e07', fontSize: 15, fontWeight: '600' },
  title: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  // Balances the "‹ Back" label so the title stays visually centered.
  headerSpacer: { width: 50 },
  content: { paddingTop: 24, paddingHorizontal: 20, alignItems: 'center' },
  emotesRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
    marginBottom: 24,
  },
  emotesLabel: { color: '#ccc', fontSize: 14 },
  refreshButton: {
    backgroundColor: '#132a3a',
    borderWidth: 1,
    borderColor: '#2f5c7a',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  refreshText: { color: '#7fc4f7', fontSize: 14, fontWeight: '600' },
  ignoredRow: { flexDirection: 'column', alignItems: 'flex-start' },
  ignoredList: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  ignoredChip: {
    borderWidth: 1,
    borderColor: '#444',
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 10,
    marginRight: 6,
    marginBottom: 6,
  },
  ignoredChipText: { color: '#ccc', fontSize: 13 },
  segmented: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#2f5c7a',
    borderRadius: 8,
    overflow: 'hidden',
  },
  segmentedBelow: { marginTop: 8 },
  segment: { paddingVertical: 6, paddingHorizontal: 10 },
  segmentSelected: { backgroundColor: '#132a3a' },
  segmentText: { color: '#888', fontSize: 13 },
  segmentTextSelected: { color: '#7fc4f7', fontWeight: '600' },
  logoutButton: {
    backgroundColor: '#3a1414',
    borderWidth: 1,
    borderColor: '#7a2727',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 32,
  },
  logoutText: { color: '#ff6b6b', fontSize: 15, fontWeight: '600' },
  version: { color: '#666', fontSize: 13, marginTop: 24 },
});
