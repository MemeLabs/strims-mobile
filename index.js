/**
 * @format
 */

import { AppRegistry } from 'react-native';
import BackgroundFetch from 'react-native-background-fetch';
import App from './App';
import { name as appName } from './app.json';
import { backgroundFetchHeadlessTask } from './src/streams/backgroundFetch';

AppRegistry.registerComponent(appName, () => App);

// [Android only] Must be registered at the top level like this (not inside
// a component) — it runs in its own JS context after the app is fully
// terminated, so it can't rely on anything set up by App.tsx.
BackgroundFetch.registerHeadlessTask(backgroundFetchHeadlessTask);
