import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getEmoteIndexUpdatedAt } from '../chat/emotes';
import pkg from '../../package.json';

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

export default function SettingsScreen({ onClose, onLogout, onRefreshEmotes }: Props) {
  const [refreshing, setRefreshing] = useState(false);
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
          <TouchableOpacity style={styles.refreshButton} onPress={handleRefresh} disabled={refreshing}>
            <Text style={styles.refreshText}>{refreshing ? 'Refreshing…' : 'Refresh'}</Text>
          </TouchableOpacity>
        </View>

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
