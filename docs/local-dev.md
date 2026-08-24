# Local development & testing

This app has been developed and tested exclusively against a **physical Android
device** from **WSL2** (Windows host, Linux dev environment) — there's no emulator in this
loop, and iOS hasn't been build-tested at all yet (see [gotchas.md](gotchas.md)). This doc
covers that specific setup, plus the day-to-day dev/test loop regardless of platform.

## Connecting a physical device from WSL2

WSL2 has no direct USB access — a Windows-side USB device (the phone, plugged into a
Windows USB port) has to be explicitly attached to the Linux VM via
[`usbipd-win`](https://github.com/dorssel/usbipd-win).

**One-time setup (Windows host):**
1. Install `usbipd-win` on Windows.
2. Enable USB debugging on the phone (Developer Options) and plug it in.
3. In an **elevated (Administrator) PowerShell** on Windows — this step cannot be run from
   inside WSL/Linux:
   ```powershell
   usbipd list                     # find the phone's BUSID
   usbipd bind --busid <BUSID>     # one-time; persists across reboots
   ```

**Every session (after the phone's plugged in):**
```powershell
# Elevated PowerShell on Windows
usbipd attach --wsl --busid <BUSID>
```
Then, from WSL:
```sh
adb devices    # should list the phone
```
If it drops out (phone sleeps, USB re-enumerates, WSL restarts), just re-run `usbipd attach`
from Windows — the Linux side doesn't need anything re-run.

`adb` in this environment lives at `~/Library/Android/sdk/platform-tools/adb` — not
necessarily on `PATH`, so reference it by full path or add that directory to `PATH`.

## Day-to-day dev loop

```sh
npm start                    # Metro bundler
npm run android               # build, install, launch on the attached device
```

Metro serves JS over `adb reverse tcp:8081 tcp:8081` (set up automatically by the CLI on
launch) — if the app shows "Unable to load script," Metro either isn't running or the
`adb reverse` mapping got dropped (common after a `usbipd attach`/reconnect); re-run:
```sh
adb reverse tcp:8081 tcp:8081
```

**Fast Refresh works for most JS-only edits, but has a real limitation worth knowing:**
adding a new hook (`useState`, `useRef`, etc.) to an already-mounted component reliably
produces `Rendered more hooks than during the previous render` under Fast Refresh. After any
change that adds/removes a hook, do a full restart rather than trusting Fast Refresh:
```sh
adb shell am force-stop com.strimsmobile
adb shell am start -n com.strimsmobile/.MainActivity
```
(Same binary works for testing a `release` build after `cd android && ./gradlew
assembleRelease` — install with `adb install -r android/app/build/outputs/apk/release/app-release.apk`,
then launch the same way. A release build does *not* connect to Metro; it's fully
self-contained.)

## Verifying UI changes

There's no interactive device access beyond adb in this loop — screenshots are the only
visual feedback channel. The pattern used throughout this project:
```sh
adb shell screencap -p /sdcard/check.png
adb pull /sdcard/check.png <local path>
```
then read the pulled image directly. For interaction (tapping a button, scrolling), `adb shell
input tap <x> <y>` / `input swipe <x1> <y1> <x2> <y2>` use **device pixel coordinates** — if
you're eyeballing coordinates off a screenshot that got downscaled for display, scale up by
`device_width / displayed_width` first (e.g. `1080 / 899 ≈ 1.2` was the ratio on the Pixel
used for this project's testing) or you'll consistently tap the wrong spot.

For anything JS-observable (state changes, event firing, network calls), prefer reading logs
over guessing from screenshots:
```sh
adb logcat -d | grep -i "ReactNativeJS"
```
This project's own logs are tagged `[strims/<module>]` (see `src/log.ts`) specifically so
they're easy to grep out from RN's own framework noise.

## Testing background behavior

Chat/streams background handling (see [architecture.md](architecture.md)) and
`react-native-background-fetch` can't be triggered on demand in the normal dev loop — Android
won't fire a real background-fetch event just because you back out of the app; it's scheduled
by the OS on its own timetable (~15min floor, see `src/streams/backgroundFetch.ts`). To force
one for testing:
```sh
adb shell cmd jobscheduler run -f com.strimsmobile <job-id>
```
(finding the right `<job-id>` requires `adb shell dumpsys jobscheduler | grep -A5
com.strimsmobile` to locate the job react-native-background-fetch registered — this is
finicky and worth confirming against the library's own troubleshooting docs if it's not
showing up.) Simpler for most purposes: just background the app (`adb shell input keyevent
3` to hit Home) and rely on the app's own foreground-return catch-up path, which is
exercised on every normal background/foreground cycle without any special tooling.
