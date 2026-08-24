import BackgroundFetch from 'react-native-background-fetch';
import { fetchStreamList } from './api';
import { loadFollows } from './follows';
import { checkForNewlyLiveFollows } from './liveTracking';
import { makeLogger } from '../log';

const log = makeLogger('background-fetch');

// 15 minutes is the practical floor for both platforms, not a value we
// chose — iOS's BGAppRefreshTask and the underlying library both enforce it
// as a minimum, and neither guarantees the interval exactly: the OS may
// space events out further based on battery state and usage patterns. This
// is meant for "notice a followed stream went live within ~15-30 minutes
// even with the app closed", not a live/real-time signal — the app's own
// foreground poll (2 minutes, see StreamsScreen.tsx) is what backs the
// "live-ish" view whenever the app is actually open.
const MINIMUM_FETCH_INTERVAL_MINUTES = 15;

async function runCheck(taskId: string): Promise<void> {
  try {
    const [list, follows] = await Promise.all([fetchStreamList(), loadFollows()]);
    const newlyLive = await checkForNewlyLiveFollows(list, follows);
    log.info(`background fetch ok (${newlyLive.length} newly live)`);
  } catch (err) {
    log.warn('background fetch failed', err);
  } finally {
    BackgroundFetch.finish(taskId);
  }
}

// Called once at app startup (see App.tsx) — configures and starts the
// default background-fetch event for as long as the app process is alive
// (foregrounded or backgrounded-but-not-terminated).
export function configureBackgroundFetch(): void {
  BackgroundFetch.configure(
    {
      minimumFetchInterval: MINIMUM_FETCH_INTERVAL_MINUTES,
      stopOnTerminate: false,
      startOnBoot: true,
      enableHeadless: true,
      requiredNetworkType: BackgroundFetch.NETWORK_TYPE_ANY,
    },
    taskId => {
      runCheck(taskId);
    },
    taskId => {
      // OS says our time's up — don't start new work, just acknowledge.
      log.warn(`background fetch timeout, taskId=${taskId}`);
      BackgroundFetch.finish(taskId);
    },
  )
    .then(status => log.info(`configured, status=${status}`))
    .catch(err => log.warn('failed to configure background fetch', err));
}

// [Android only] Handles fetch events after the app has been fully
// terminated (stopOnTerminate: false above is what makes this reachable at
// all) — registered from index.js, at the top level, outside any component,
// per the library's requirement that this run in its own JS context
// separate from the main RN runtime.
export async function backgroundFetchHeadlessTask(event: { taskId: string; timeout: boolean }): Promise<void> {
  if (event.timeout) {
    BackgroundFetch.finish(event.taskId);
    return;
  }
  await runCheck(event.taskId);
}
