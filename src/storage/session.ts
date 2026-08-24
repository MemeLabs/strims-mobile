import * as Keychain from 'react-native-keychain';
import CookieManager from '@preeternal/react-native-cookie-manager';

const SERVICE = 'gg.strims.mobile.session';

export interface StoredSession {
  jwt: string;
  cookieDomain: string;
}

export async function saveSession(session: StoredSession): Promise<void> {
  await Keychain.setGenericPassword('jwt', JSON.stringify(session), {
    service: SERVICE,
  });
}

export async function loadSession(): Promise<StoredSession | null> {
  const result = await Keychain.getGenericPassword({ service: SERVICE });
  if (!result) {
    return null;
  }
  try {
    return JSON.parse(result.password) as StoredSession;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  await Keychain.resetGenericPassword({ service: SERVICE });
  // The keychain only holds our own copy of the jwt — the OAuth WebView has
  // its own separate cookie jar (sharedCookiesEnabled/thirdPartyCookiesEnabled
  // in LoginScreen), which still has a live `jwt` cookie for strims.gg after
  // this. Without clearing it too, the next login WebView load silently
  // re-authenticates from that cookie before the user ever sees the login
  // form — "logging out" would just reconnect a moment later.
  await CookieManager.clearAll();
}
