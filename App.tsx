import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import LoginScreen from './src/auth/LoginScreen';
import ChatScreen from './src/screens/ChatScreen';
import StreamsScreen from './src/screens/StreamsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import TabBar, { type TabKey } from './src/components/TabBar';
import TitleBar from './src/components/TitleBar';
import UpdateModal from './src/components/UpdateModal';
import { clearSession, loadSession } from './src/storage/session';
import { configureBackgroundFetch } from './src/streams/backgroundFetch';
import { refreshEmoteIndex } from './src/chat/emotes';
import { refreshEmoteFrames } from './src/chat/emoteFrames';
import { checkForUpdate, type AvailableUpdate } from './src/update/checkForUpdate';
import { installUpdate } from './src/update/installUpdate';

export default function App() {
  const [booting, setBooting] = useState(true);
  const [jwt, setJwt] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('chat');
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState<AvailableUpdate | null>(null);
  const [updateModalVisible, setUpdateModalVisible] = useState(false);
  // Bumped by the Settings "Refresh emotes" button — passed to ChatScreen
  // so it knows to re-fetch the (otherwise never-expiring, see emotes.ts)
  // emote index instead of only ever loading it once on mount.
  const [emoteRefreshKey, setEmoteRefreshKey] = useState(0);

  useEffect(() => {
    loadSession()
      .then(session => setJwt(session?.jwt ?? null))
      .finally(() => setBooting(false));
    // Not gated on being logged in — a logged-out user has no follows to
    // notify about anyway (checkForNewlyLiveFollows would just find none),
    // so there's no harm configuring it unconditionally, and it means
    // background fetch is already running by the time login completes.
    configureBackgroundFetch();
    // Not gated on login either — the version check needs no auth, and
    // checkForUpdate itself no-ops unless a day has passed since the last
    // check, so this is cheap to call unconditionally on every launch.
    checkForUpdate().then(setUpdateAvailable);
  }, []);

  const onLogout = async () => {
    await clearSession();
    setSettingsVisible(false);
    setJwt(null);
  };

  const onRefreshEmotes = async () => {
    await refreshEmoteFrames();
    await refreshEmoteIndex();
    setEmoteRefreshKey(k => k + 1);
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
              <SettingsScreen
                onClose={() => setSettingsVisible(false)}
                onLogout={onLogout}
                onRefreshEmotes={onRefreshEmotes}
              />
            ) : (
              <>
                <TitleBar
                  onPressSettings={() => setSettingsVisible(true)}
                  updateAvailable={updateAvailable}
                  onPressUpdate={() => setUpdateModalVisible(true)}
                />
                <TabBar active={tab} onChange={setTab} />
                {/* Both screens stay mounted once loaded — switching tabs
                    only toggles visibility, so chat's socket/catch-up state
                    and the streams list survive tab swaps instead of
                    reloading from scratch each time. */}
                <View style={tab === 'chat' ? styles.flexVisible : styles.hidden}>
                  <ChatScreen jwt={jwt} emoteRefreshKey={emoteRefreshKey} />
                </View>
                <View style={tab === 'streams' ? styles.flexVisible : styles.hidden}>
                  <StreamsScreen />
                </View>
              </>
            )}
          </SafeAreaView>
        ) : (
          // Needs the same top-inset treatment as the authed view above —
          // without it, the WebView's content (Twitch's own page, which has
          // no notion of our status bar) starts right at y=0 and its header
          // collides with the status bar.
          <SafeAreaView style={styles.root} edges={['top']}>
            <LoginScreen onLoggedIn={setJwt} />
          </SafeAreaView>
        )}
      </View>
      <UpdateModal
        update={updateModalVisible ? updateAvailable : null}
        onClose={() => setUpdateModalVisible(false)}
        onConfirm={() => {
          setUpdateModalVisible(false);
          updateAvailable && installUpdate(updateAvailable);
        }}
      />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#15161c' },
  flexVisible: { flex: 1 },
  hidden: { display: 'none' },
});
