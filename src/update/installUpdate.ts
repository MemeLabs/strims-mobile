import { Linking } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { makeLogger } from '../log';
import type { AvailableUpdate } from './checkForUpdate';

const log = makeLogger('update-install');

// Downloads the release APK to cache and hands it to the OS package
// installer via a content:// URI (react-native-blob-util ships its own
// FileProvider for this, declared in its AndroidManifest — see
// REQUEST_INSTALL_PACKAGES in android/app/src/main/AndroidManifest.xml for
// the other half of what this needs). Falls back to just opening the
// release page — e.g. if the release has no .apk asset attached, or this
// ever runs on iOS, where side-loading isn't a thing.
export async function installUpdate(update: AvailableUpdate): Promise<void> {
  if (!update.apkUrl) {
    await Linking.openURL(update.releaseUrl);
    return;
  }

  try {
    const { path } = await ReactNativeBlobUtil.config({
      fileCache: true,
      appendExt: 'apk',
    }).fetch('GET', update.apkUrl);

    await ReactNativeBlobUtil.android.actionViewIntent(path(), 'application/vnd.android.package-archive');
  } catch (err) {
    log.warn('apk download/install failed, falling back to release page', err);
    await Linking.openURL(update.releaseUrl);
  }
}
