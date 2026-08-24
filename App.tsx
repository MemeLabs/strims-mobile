import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import LoginScreen from './src/auth/LoginScreen';
import ChatScreen from './src/screens/ChatScreen';
import StreamsScreen from './src/screens/StreamsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import TabBar, { type TabKey } from './src/components/TabBar';
import TitleBar from './src/components/TitleBar';
import { clearSession, loadSession } from './src/storage/session';

export default function App() {
  const [booting, setBooting] = useState(true);
  const [jwt, setJwt] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('chat');
  const [settingsVisible, setSettingsVisible] = useState(false);

  useEffect(() => {
    loadSession()
      .then(session => setJwt(session?.jwt ?? null))
      .finally(() => setBooting(false));
  }, []);

  const onLogout = async () => {
    await clearSession();
    setSettingsVisible(false);
    setJwt(null);
  };

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <View style={styles.root}>
        {booting ? (
          <ActivityIndicator size="large" color="#8291b2" />
        ) : jwt ? (
          // Top inset is handled once here, above the title bar — the
          // screens below no longer apply their own top safe-area edge.
          <SafeAreaView style={styles.root} edges={['top']}>
            {settingsVisible ? (
              <SettingsScreen onClose={() => setSettingsVisible(false)} onLogout={onLogout} />
            ) : (
              <>
                <TitleBar onPressSettings={() => setSettingsVisible(true)} />
                <TabBar active={tab} onChange={setTab} />
                {/* Both screens stay mounted once loaded — switching tabs
                    only toggles visibility, so chat's socket/catch-up state
                    and the streams list survive tab swaps instead of
                    reloading from scratch each time. */}
                <View style={tab === 'chat' ? styles.flexVisible : styles.hidden}>
                  <ChatScreen jwt={jwt} />
                </View>
                <View style={tab === 'streams' ? styles.flexVisible : styles.hidden}>
                  <StreamsScreen />
                </View>
              </>
            )}
          </SafeAreaView>
        ) : (
          <LoginScreen onLoggedIn={setJwt} />
        )}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#15161c' },
  flexVisible: { flex: 1 },
  hidden: { display: 'none' },
});
