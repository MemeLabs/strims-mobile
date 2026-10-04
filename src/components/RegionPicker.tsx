import React from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export interface RegionOption {
  // ANGELTHUMP_REGIONS code; null = AngelThump's own routing.
  code: string | null;
  label: string;
}

interface Props {
  visible: boolean;
  title: string;
  options: RegionOption[];
  // Highlighted as the current choice, if any.
  selected?: string | null;
  onPick: (code: string | null) => void;
  onDismiss: () => void;
}

// AngelThump server list, shown before casting and from the player's
// server button.
export default function RegionPicker({ visible, title, options, selected, onPick, onDismiss }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss} supportedOrientations={['portrait', 'landscape']}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onDismiss}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          {options.map(option => (
            <TouchableOpacity key={option.label} style={styles.option} onPress={() => onPick(option.code)}>
              <Text style={[styles.optionText, option.code === selected && styles.optionTextSelected]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.cancel} onPress={onDismiss}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    backgroundColor: '#1c1d24',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    width: 220,
  },
  title: {
    color: '#8291b2',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: 8,
  },
  option: {
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#2a2b33',
  },
  optionText: { color: '#fff', fontSize: 16, textAlign: 'center' },
  optionTextSelected: { color: '#e45e07', fontWeight: '600' },
  cancel: {
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#2a2b33',
    marginTop: 4,
  },
  cancelText: { color: '#e45e07', fontSize: 15, fontWeight: '600', textAlign: 'center' },
});
