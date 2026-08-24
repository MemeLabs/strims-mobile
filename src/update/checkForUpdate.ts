import AsyncStorage from '@react-native-async-storage/async-storage';
import { version as APP_VERSION } from '../../package.json';
import { makeLogger } from '../log';

const log = makeLogger('update-check');

const RELEASES_API_URL = 'https://api.github.com/repos/nom-d-plume/strims-mobile/releases/latest';
const LAST_CHECK_KEY = 'gg.strims.mobile.update-check.last-checked-at';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface AvailableUpdate {
  version: string;
  // Direct link to the release's .apk asset, for installUpdate.ts. Absent if
  // the release has no such asset attached (falls back to the release page).
  apkUrl: string | null;
  releaseUrl: string;
  // Release body (markdown) rendered as plain text in UpdateModal.
  notes: string;
}

interface GithubAsset {
  name: string;
  browser_download_url: string;
}

interface GithubRelease {
  tag_name?: string;
  html_url?: string;
  body?: string;
  assets?: GithubAsset[];
}

function normalizeTag(tag: string): string {
  return tag.startsWith('v') ? tag.slice(1) : tag;
}

// Bare string comparison of dot-separated numeric parts — releases here are
// plain semver (see CHANGELOG.md), no pre-release suffixes to worry about.
function isNewer(latest: string, current: string): boolean {
  const a = latest.split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

async function fetchLatestRelease(): Promise<GithubRelease> {
  const res = await fetch(RELEASES_API_URL, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) {
    throw new Error(`releases API returned ${res.status}`);
  }
  return (await res.json()) as GithubRelease;
}

// Called once at app startup (see App.tsx). Only hits the network once per
// CHECK_INTERVAL_MS, tracked via a persisted timestamp so it stays a
// once-a-day check across app restarts, not just within a single session.
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  try {
    const lastCheckedRaw = await AsyncStorage.getItem(LAST_CHECK_KEY);
    const lastCheckedAt = lastCheckedRaw ? Number(lastCheckedRaw) : 0;
    if (Date.now() - lastCheckedAt < CHECK_INTERVAL_MS) {
      return null;
    }

    const release = await fetchLatestRelease();
    await AsyncStorage.setItem(LAST_CHECK_KEY, String(Date.now()));

    if (!release.tag_name || !release.html_url) {
      return null;
    }
    const latest = normalizeTag(release.tag_name);
    if (!isNewer(latest, APP_VERSION)) {
      return null;
    }

    log.info(`update available: ${latest} (current ${APP_VERSION})`);
    const apkAsset = release.assets?.find(a => a.name.endsWith('.apk'));
    return {
      version: latest,
      apkUrl: apkAsset?.browser_download_url ?? null,
      releaseUrl: release.html_url,
      notes: release.body?.trim() || 'No release notes provided.',
    };
  } catch (err) {
    log.warn('update check failed', err);
    return null;
  }
}
