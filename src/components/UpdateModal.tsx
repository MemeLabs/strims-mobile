import React from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { AvailableUpdate } from '../update/checkForUpdate';

interface Props {
  update: AvailableUpdate | null;
  onClose: () => void;
  onConfirm: () => void;
}

export default function UpdateModal({ update, onClose, onConfirm }: Props) {
  return (
    <Modal visible={update !== null} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        {/* Swallow taps so they don't bubble to the backdrop's onPress */}
        <TouchableOpacity activeOpacity={1} style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>{`Update available: ${update?.version}`}</Text>
          <ScrollView style={styles.notesScroll}>
            <Text style={styles.notes}>{update?.notes}</Text>
          </ScrollView>
          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.laterButton} onPress={onClose}>
              <Text style={styles.laterText}>Later</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.updateButton} onPress={onConfirm}>
              <Text style={styles.updateText}>Update</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
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
    padding: 24,
  },
  card: {
    backgroundColor: '#1c1d24',
    borderRadius: 12,
    padding: 16,
    width: '100%',
    maxHeight: '70%',
  },
  title: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  notesScroll: {
    marginBottom: 16,
  },
  notes: {
    color: '#c3c6cf',
    fontSize: 14,
    lineHeight: 20,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  laterButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  laterText: {
    color: '#8291b2',
    fontSize: 15,
    fontWeight: '600',
  },
  updateButton: {
    backgroundColor: '#2ea043',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  updateText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
