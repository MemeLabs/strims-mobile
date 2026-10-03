import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export type TabKey = 'chat' | 'streams';

interface Tab {
  key: TabKey;
  label: string;
}

const TABS: Tab[] = [
  { key: 'chat', label: 'Chat' },
  { key: 'streams', label: 'Streams' },
];

interface Props {
  active: TabKey;
  onChange: (key: TabKey) => void;
  // Chat socket is open: a small dot next to "Chat".
  chatConnected: boolean;
}

// Styled to match the strims-live-extension settings panel's tab strip
// (style/app.css .tab-strip / .tab-btn): flat buttons, no background, an
// accent-colored underline on the active tab.
export default function TabBar({ active, onChange, chatConnected }: Props) {
  return (
    <View style={styles.strip}>
      {TABS.map(tab => {
        const isActive = tab.key === active;
        return (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, isActive && styles.tabActive]}
            onPress={() => onChange(tab.key)}
          >
            <View style={styles.labelRow}>
              <Text style={[styles.label, isActive && styles.labelActive]}>{tab.label}</Text>
              {tab.key === 'chat' && chatConnected && <View style={styles.connectedDot} />}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const ACCENT = '#e45e07';
// Same muted green as chat greentext (ChatScreen.tsx greenText).
const CONNECTED = '#6ab04c';

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    backgroundColor: '#121212',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: ACCENT,
  },
  label: {
    color: '#999',
    fontSize: 13,
    fontWeight: '600',
  },
  labelActive: {
    color: ACCENT,
  },
  labelRow: { flexDirection: 'row', alignItems: 'center' },
  connectedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginLeft: 6,
    backgroundColor: CONNECTED,
  },
});
