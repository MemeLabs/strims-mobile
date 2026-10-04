import React, { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, StatusBar, StyleSheet, View } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';
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
import { refreshEmoteWebps } from './src/chat/emoteWebp';
import { setEmoteAnimationsActive } from './src/chat/emoteClock';
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
  const [chatConnected, setChatConnected] = useState(false);

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

  // Navigation is plain state, so Android's back button has no native stack
  // to pop — map it onto that state ourselves: Settings → close it, other
  // tab → back to chat, otherwise fall through and let the app exit.
  // (Modals handle back themselves via onRequestClose.)
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (settingsVisible) {
        setSettingsVisible(false);
        return true;
      }
      if (tab !== 'chat') {
        setTab('chat');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [settingsVisible, tab]);

  // Emote animations only run while chat is actually on screen.
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => setAppActive(state === 'active'));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    setEmoteAnimationsActive(appActive && !!jwt && tab === 'chat' && !settingsVisible);
  }, [appActive, jwt, tab, settingsVisible]);

  const onLogout = async () => {
    await clearSession();
    setSettingsVisible(false);
    setJwt(null);
  };

  const onRefreshEmotes = async () => {
    await refreshEmoteFrames();
    await refreshEmoteWebps();
    await refreshEmoteIndex();
    setEmoteRefreshKey(k => k + 1);
  };

  return (
    <KeyboardProvider>
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" />
        <View style={styles.root}>
          {booting ? (
            <ActivityIndicator size="large" color="#8291b2" />
          ) : jwt ? (
            // Top inset is handled once here, above the title bar — the
            // screens below no longer apply their own top safe-area edge.
            <SafeAreaView style={styles.root} edges={['top']}>
              {settingsVisible && (
                <SettingsScreen
                  onClose={() => setSettingsVisible(false)}
                  onLogout={onLogout}
                  onRefreshEmotes={onRefreshEmotes}
                />
              )}
              {/* Chat and streams stay mounted under Settings too, not just
                  across tab swaps — unmounting chat for Settings meant a fresh
                  socket + catch-up and a forced scroll-to-end on every return. */}
              <View style={settingsVisible ? styles.hidden : styles.flexVisible}>
                <TitleBar
                  onPressSettings={() => setSettingsVisible(true)}
                  updateAvailable={updateAvailable}
                  onPressUpdate={() => setUpdateModalVisible(true)}
                />
                <TabBar active={tab} onChange={setTab} chatConnected={chatConnected} />
                <View style={tab === 'chat' ? styles.flexVisible : styles.hidden}>
                  <ChatScreen jwt={jwt} emoteRefreshKey={emoteRefreshKey} onConnectedChange={setChatConnected} />
                </View>
                <View style={tab === 'streams' ? styles.flexVisible : styles.hidden}>
                  <StreamsScreen />
                </View>
              </View>
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
    </KeyboardProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#15161c' },
  flexVisible: { flex: 1 },
  hidden: { display: 'none' },
});
