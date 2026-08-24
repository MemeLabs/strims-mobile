import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface Props {
  onPressSettings: () => void;
  // Set when checkForUpdate finds a newer release than the running version;
  // omitted/undefined otherwise.
  updateAvailable?: { version: string } | null;
  // Downloads and prompts to install updateAvailable — only ever called
  // while updateAvailable is set, since the badge is what's tapped.
  onPressUpdate?: () => void;
}

// Sits above TabBar — just a "strims" wordmark and a settings entry point,
// there's no equivalent bar in chat-gui/strims-live-extension (they use the
// browser chrome + an in-page settings panel instead) so this is mobile-only.
export default function TitleBar({ onPressSettings, updateAvailable, onPressUpdate }: Props) {
  return (
    <View style={styles.bar}>
      <View style={styles.titleGroup}>
        <Text style={styles.title}>strims</Text>
        {updateAvailable && (
          <TouchableOpacity onPress={onPressUpdate} hitSlop={8}>
            <Text style={styles.updateBadge}>{`update ${updateAvailable.version} available`}</Text>
          </TouchableOpacity>
        )}
      </View>
      <TouchableOpacity onPress={onPressSettings} hitSlop={12} accessibilityLabel="Settings">
        <Text style={styles.gear}>{'⚙'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#121212',
  },
  titleGroup: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  title: {
    color: '#e45e07',
    fontSize: 18,
    fontWeight: '700',
  },
  updateBadge: {
    color: '#999',
    fontSize: 12,
    textDecorationLine: 'underline',
  },
  gear: {
    color: '#999',
    fontSize: 20,
  },
});
