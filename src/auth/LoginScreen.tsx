import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import WebView, { WebViewNavigation } from 'react-native-webview';
import CookieManager from '@preeternal/react-native-cookie-manager';
import { DEFAULT_CONFIG, JWT_COOKIE_NAME } from '../config/env';
import { saveSession } from '../storage/session';

interface Props {
  onLoggedIn: (jwt: string) => void;
}

// Twitch OAuth is handled entirely by Rustla2 server-side (redirects through
// id.twitch.tv and back to /oauth), which then sets the `jwt` session cookie
// on the rustla.gg / strims.gg domain. We just need to watch for that cookie
// to appear after each navigation and grab it — there's no token in the URL.

// Twitch/Google's login pages reject RN WebView's default user-agent
// ("...wv...") with a "browser not supported" page — they specifically
// block generic embedded webviews. Spoofing a normal mobile Chrome UA is
// the standard workaround third-party apps use for this exact block.
const SPOOFED_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/126.0.0.0 Mobile Safari/537.36';

export default function LoginScreen({ onLoggedIn }: Props) {
  const [loading, setLoading] = useState(true);
  const resolvedRef = useRef(false);

  const checkForSession = useCallback(async () => {
    if (resolvedRef.current) {
      return;
    }
    const cookies = await CookieManager.get(DEFAULT_CONFIG.rustlaUrl, true);
    const jwtCookie = cookies[JWT_COOKIE_NAME];
    if (jwtCookie?.value) {
      resolvedRef.current = true;
      await saveSession({
        jwt: jwtCookie.value,
        cookieDomain: DEFAULT_CONFIG.rustlaUrl,
      });
      onLoggedIn(jwtCookie.value);
    }
  }, [onLoggedIn]);

  const handleNavigationChange = useCallback(
    (navState: WebViewNavigation) => {
      setLoading(navState.loading);
      if (!navState.loading) {
        checkForSession();
      }
    },
    [checkForSession],
  );

  return (
    <View style={styles.container}>
      <WebView
        source={{ uri: DEFAULT_CONFIG.loginUri }}
        onNavigationStateChange={handleNavigationChange}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        incognito={false}
        userAgent={SPOOFED_USER_AGENT}
      />
      {loading && (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator size="large" color="#8291b2" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#15161c' },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
