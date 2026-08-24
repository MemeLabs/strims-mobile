import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface Props {
  onPressSettings: () => void;
}

// Sits above TabBar — just a "strims" wordmark and a settings entry point,
// there's no equivalent bar in chat-gui/strims-live-extension (they use the
// browser chrome + an in-page settings panel instead) so this is mobile-only.
export default function TitleBar({ onPressSettings }: Props) {
  return (
    <View style={styles.bar}>
      <Text style={styles.title}>strims</Text>
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
  title: {
    color: '#e45e07',
    fontSize: 18,
    fontWeight: '700',
  },
  gear: {
    color: '#999',
    fontSize: 20,
  },
});
