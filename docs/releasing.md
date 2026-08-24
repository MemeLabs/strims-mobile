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
   cd android && ./gradlew assembleRelease
   ```
   Output: `android/app/build/outputs/apk/release/app-release.apk`. Debug-signed by default
   (see the README's Android install section) — fine for now, but note that switching to a
   real release keystore later will break update compatibility with anything installed under
   the debug signature, so that switch should happen deliberately, not as a side effect of an
   unrelated release.
6. **iOS**: [.github/workflows/ios-build.yml](../.github/workflows/ios-build.yml) verifies the
   app *builds* on every push (simulator target, unsigned) — that is not the same as producing
   a distributable `.ipa`. A real device/sideload build needs code signing, which needs a Mac
   (see the README's iOS sideload section and [gotchas.md](gotchas.md)'s "iOS is unverified"
   note) — until that's set up, iOS releases either skip the artifact (Android-only release) or
   get built manually on a Mac and attached by hand.
7. **Create the GitHub Release**:
   ```sh
   gh release create vX.Y.Z \
     android/app/build/outputs/apk/release/app-release.apk \
     --title "vX.Y.Z" \
     --notes-file <(sed -n '/^## \[X.Y.Z\]/,/^## \[/p' CHANGELOG.md | sed '1d;$d')
   ```
   (that `sed` pulls just this version's section out of `CHANGELOG.md` for the release notes
   body — adjust `X.Y.Z` to match; simplest to just copy that section by hand into
   `--notes` if the one-liner is fiddly.) Attach the `.ipa` too with a second path argument if
   one was built for this release.

## Future automation

Worth doing once this has happened manually a couple of times and the process is settled:
a tag-triggered GitHub Actions workflow that builds the Android APK and drafts the GitHub
Release automatically (mirroring [.github/workflows/ios-build.yml](../.github/workflows/ios-build.yml)'s
pattern) — not set up yet since automating a process before it's been done manually at least
once tends to bake in the wrong assumptions.
