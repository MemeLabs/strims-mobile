# Releasing

There's no App Store / Play Store distribution — releases are GitHub Releases with
downloadable Android/iOS build artifacts attached, per the README's install instructions.

## Versioning

[Semantic versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`), with `package.json`'s
`version` field as the single source of truth. **Three separate files currently need bumping
together for every release** — there's no automation keeping them in sync yet, so this is the
step most likely to be forgotten:

| File | Field(s) |
| --- | --- |
| `package.json` | `version` |
| `android/app/build.gradle` | `versionName` (string, e.g. `"1.2.0"`) **and** `versionCode` (integer, increment by 1 every release — this is what Android uses to decide "is this an update," not `versionName`) |
| `ios/StrimsMobile.xcodeproj/project.pbxproj` | `MARKETING_VERSION` (both the Debug and Release entries) **and** `CURRENT_PROJECT_VERSION` (build number, increment by 1) |

As of this writing these three are already out of sync with each other (a preexisting drift,
not caused by any single release) — reconciling them is part of cutting the *next* release,
not a blocker to writing this doc.

## Changelog

Kept in [`CHANGELOG.md`](../CHANGELOG.md) at the repo root, [Keep a Changelog](https://keepachangelog.com/)
style: an `[Unreleased]` section at the top that entries get added to as they land (not
batched up right before a release — do it in the same PR/commit as the change, while the
"why" is still fresh), which becomes that version's section once tagged.

## Cutting a release

1. **Move `[Unreleased]` entries under a new version heading** in `CHANGELOG.md`, dated today.
   Leave a fresh empty `[Unreleased]` section above it for whatever comes next.
2. **Bump the version** in all three places from the table above. Decide MAJOR/MINOR/PATCH
   from the changelog content (breaking change → MAJOR, new features → MINOR, fixes only →
   PATCH — MAJOR is unlikely to come up before this app has any external users to break).
3. **Commit**: `git commit -m "Release vX.Y.Z"` (the version bump + changelog move, nothing
   else — keep it a clean, isolated commit).
4. **Tag and push**:
   ```sh
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin main
   git push origin vX.Y.Z
   ```
5. **Build the Android release APK**:
   ```sh
   cd android && ./gradlew clean assembleRelease
   ```
   `clean` matters: Gradle doesn't count a `package.json`-only change as a reason to rebuild
   the JS bundle, so after a version bump an incremental build ships the *previous* version
   string, and the in-app update check then keeps offering the release you just installed
   (v0.3.1 shipped like that). Check with
   `unzip -p android/app/build/outputs/apk/release/app-release.apk assets/index.android.bundle | grep -acF X.Y.Z`
   (should print 1).
   Output: `android/app/build/outputs/apk/release/app-release.apk`. Debug-signed by default
   (see the README's Android install section) — fine for now, but note that switching to a
   real release keystore later will break update compatibility with anything installed under
   the debug signature, so that switch should happen deliberately, not as a side effect of an
   unrelated release.
6. **iOS**: `StrimsMobile-unsigned.ipa` is built and attached to the GitHub Release
   **automatically** by [.github/workflows/ios-release.yml](../.github/workflows/ios-release.yml)
   once the release is published (step 7 below triggers the workflow).  No Apple credentials
   are required on the CI side — code signing is disabled; the resulting `.ipa` is unsigned.
   See [Installing the iOS artifact](#installing-the-ios-artifact) below for how users
   install it.  The separate [ios-build.yml](../.github/workflows/ios-build.yml) per-push
   simulator build is unchanged. For a release published before the workflow existed, or a
   failed run: `gh workflow run ios-release.yml -f tag=vX.Y.Z` builds that tag and attaches it.
7. **Create the GitHub Release** (this triggers the iOS workflow in step 6):
   ```sh
   gh release create vX.Y.Z \
     android/app/build/outputs/apk/release/app-release.apk \
     --title "vX.Y.Z" \
     --notes-file <(sed -n '/^## \[X.Y.Z\]/,/^## \[/p' CHANGELOG.md | sed '1d;$d')
   ```
   (that `sed` pulls just this version's section out of `CHANGELOG.md` for the release notes
   body — adjust `X.Y.Z` to match; simplest to just copy that section by hand into
   `--notes` if the one-liner is fiddly.)  The `.ipa` is uploaded automatically by CI; do
   **not** attach it by hand unless the workflow failed.

## Installing the iOS artifact

`StrimsMobile-unsigned.ipa` on each release is a **device-arch, Release-configuration build
with code signing disabled**.  It cannot be installed directly from Finder or iTunes — it
must be re-signed by a sideloading tool that uses your own Apple ID as the certificate:

| Tool | Platform | Notes |
| --- | --- | --- |
| [AltStore](https://altstore.io) | macOS / Windows (AltServer companion app) | Installs and auto-refreshes over Wi-Fi |
| [Sideloadly](https://sideloadly.io) | macOS / Windows | Simpler one-shot install; no auto-refresh |

**Steps (AltStore example):**
1. Install AltServer on your Mac or PC.
2. Connect your iPhone/iPad via USB (or Wi-Fi once paired).
3. In AltStore on your device, tap **+** and choose the downloaded `.ipa`.
4. Sign in with your Apple ID when prompted — AltServer re-signs and installs the app.

**Limitations of the unsigned/free-Apple-ID approach:**
- **7-day expiry**: Apple's free personal development certificates expire after 7 days.
  AltStore can refresh automatically in the background over Wi-Fi while AltServer is running.
  A paid Apple Developer Program membership ($99/year) extends the certificate to 365 days.
- **3-app limit**: A free Apple ID can have at most 3 sideloaded apps active at a time.
- **Not App Store distributable**: the `.ipa` is not signed with a distribution certificate
  and cannot be submitted to TestFlight or the App Store.

These constraints are imposed by Apple, not by this project.

## Future automation

Worth doing once this has happened manually a couple of times and the process is settled:
a tag-triggered GitHub Actions workflow that builds the Android APK and drafts the GitHub
Release automatically — not set up yet since automating a process before it's been done
manually at least once tends to bake in the wrong assumptions.  (The iOS unsigned `.ipa`
is already automated via [ios-release.yml](../.github/workflows/ios-release.yml); Android
is the remaining manual step.)
