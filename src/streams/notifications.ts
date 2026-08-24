import notifee, { AndroidImportance, AuthorizationStatus } from '@notifee/react-native';
import { makeLogger } from '../log';
import type { Stream } from './types';

const log = makeLogger('notifications');

const CHANNEL_ID = 'stream-live';
let channelReady: Promise<void> | null = null;

async function ensureChannel(): Promise<void> {
  if (!channelReady) {
    channelReady = notifee
      .createChannel({ id: CHANNEL_ID, name: 'Followed streams going live', importance: AndroidImportance.HIGH })
      .then(() => undefined);
  }
  return channelReady;
}

// Only asks once — Android's permission dialog is a one-shot; if the user
// denies it, re-prompting on every notify() attempt would be annoying, so
// callers should only need to call this once (e.g. when they first follow
// a channel) rather than before every notification.
export async function ensureNotificationPermission(): Promise<boolean> {
  const settings = await notifee.requestPermission();
  return settings.authorizationStatus >= AuthorizationStatus.AUTHORIZED;
}

export async function notifyStreamLive(stream: Stream): Promise<void> {
  try {
    await ensureChannel();
    await notifee.displayNotification({
      title: `${stream.channel} is live`,
      body: stream.title,
      android: {
        channelId: CHANNEL_ID,
        largeIcon: stream.thumbnail,
        pressAction: { id: 'default' },
      },
    });
  } catch (err) {
    log.warn('failed to display live notification', err);
  }
}
