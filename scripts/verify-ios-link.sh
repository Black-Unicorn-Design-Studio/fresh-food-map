#!/usr/bin/env bash
# Catches the one iOS failure that builds cleanly and then crashes on launch.
#
# React Native decides at `pod install` time whether to use its prebuilt core, and it
# decides by running `curl` against Maven. Any answer that is not literally "200" — a DNS
# blip, a proxy, a CDN hiccup, a redirect it did not follow — and it falls back to building
# from source as static libraries, prints one yellow line, and exits 0.
#
# Expo's precompiled-modules path does not follow it down. It gates on the *request*
# (`ENV['RCT_USE_PREBUILT_RNCORE'] == '1'`), never the outcome, so it goes on vendoring
# dynamic xcframeworks that were compiled against the prebuilt `React.framework`. Its own
# xcframeworks ship inside npm and need no network, so the two halves fail apart.
#
# The result is an app whose Expo frameworks load `@rpath/React.framework/React` and
# `@rpath/ReactNativeDependencies.framework/ReactNativeDependencies` while nothing in the
# graph builds either. Xcode reports "Build Succeeded, 0 errors" — the static linker
# resolves the app's own symbols and never chases a framework's transitive load commands —
# and dyld aborts with signal 6 the instant the app launches. On a device that reads as
# "the app just doesn't open", with no stack trace and nothing in the build log.
#
# So this checks the disagreement itself rather than one of its symptoms: Expo shipping
# precompiled frameworks while the prebuilt React core is absent from the lockfile. It is
# offline, takes milliseconds, and turns a silent crash-on-launch into a line of text
# before Xcode starts.
set -euo pipefail

cd "$(dirname "$0")/.."

LOCK=ios/Podfile.lock
[ -f "$LOCK" ] || { echo "verify-ios-link: no $LOCK yet — nothing to check."; exit 0; }

# Do the Expo modules expect a dynamically linked React?
expo_precompiled=$(find ios/Pods -maxdepth 2 -name 'ExpoModules*.xcframework' 2>/dev/null | head -1 || true)

# Did React Native actually install the prebuilt core those frameworks link against?
core_prebuilt=$(grep -c 'React-Core-prebuilt' "$LOCK" || true)
deps_prebuilt=$(grep -c 'ReactNativeDependencies' "$LOCK" || true)

if [ -n "$expo_precompiled" ] && { [ "$core_prebuilt" = "0" ] || [ "$deps_prebuilt" = "0" ]; }; then
  cat >&2 <<'MSG'
verify-ios-link: iOS pods are in the split state that builds fine and crashes on launch.

  Expo installed precompiled xcframeworks, which link @rpath/React.framework/React and
  @rpath/ReactNativeDependencies.framework/ReactNativeDependencies — but React Native's
  prebuilt core is missing from ios/Podfile.lock, so nothing builds either one. The app
  will compile with 0 errors and die at startup with:

      dyld: Library not loaded: @rpath/React.framework/React
      App terminated due to signal 6.

  React Native fell back to building from source because its Maven probe did not return
  200. Confirm it can now:

      curl -o /dev/null -sIw '%{http_code}\n' -L \
        https://repo1.maven.org/maven2/com/facebook/react/react-native-artifacts/0.86.0/react-native-artifacts-0.86.0-reactnative-core-debug.tar.gz

  Then reinstall and look for "[ReactNativeCore] Building from source: false":

      cd ios && rm -rf Pods Podfile.lock && pod install

  If the probe keeps failing, break the coupling instead — add expo-build-properties with
  ios.usePrecompiledModules: false and re-run `expo prebuild --platform ios --clean`, which
  builds the Expo modules from source so they reference no dynamic React at all.
MSG
  exit 1
fi

echo "verify-ios-link: ok (React core prebuilt: ${core_prebuilt} refs, deps: ${deps_prebuilt} refs)"
