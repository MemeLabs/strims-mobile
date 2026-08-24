import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import pkg from '../../package.json';

interface Props {
  onClose: () => void;
  onLogout: () => void;
}

export default function SettingsScreen({ onClose, onLogout }: Props) {
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
  content: { flex: 1, alignItems: 'center', paddingTop: 32, paddingHorizontal: 20 },
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
